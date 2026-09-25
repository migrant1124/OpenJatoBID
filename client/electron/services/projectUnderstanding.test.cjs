const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');
const { buildDocxBuffer, resolveTechnicalPlanExportPayload } = require('./exportService.cjs');
const {
  buildProjectUnderstandingSubtree,
  formatEvidencePackage,
  planProjectUnderstandingPlacement,
  prepareProjectUnderstandingExport,
  stableHash,
  validateProjectUnderstandingContent,
  validateProjectUnderstandingOutlineContent,
} = require('./projectUnderstanding.cjs');
const { assertPublicTopics, buildResearchScopeHash, commitResearchVersionState, extractEvidence, getInternalSourceLimit, htmlToText, isPrivateAddress, loadInternalSources, readLimitedBody, runProjectUnderstandingResearchTask, waitForResearchOperation } = require('./projectUnderstandingResearch.cjs');
const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
const { createConfigStore } = require('./configStore.cjs');
const { __aiServiceRuntime } = require('./aiService.cjs');

function outline(children = []) {
  return {
    project_name: '测试项目',
    outline: [{ id: '1', title: '综合技术方案', description: '总体响应', children }],
  };
}

const completeResearch = {
  schema_version: 1,
  placement: { status: 'added', node_id: '1-project-understanding', reason: '测试' },
  reference_date: '2026-09-25',
  active_version_id: 'v1',
  versions: [{
    version_id: 'v1',
    status: 'complete',
    reference_date: '2026-09-25',
    topics: ['行业政策'],
    sources: [
      { source_id: 'pu-a', title: '权威来源A', publisher: '主管部门', url: 'https://example.gov.cn/a', published_at: '2026-09-01' },
      { source_id: 'pu-b', title: '权威来源B', publisher: '上级单位', url: 'https://example.gov.cn/b', published_at: '' },
    ],
    evidence: [
      { evidence_id: 'pu-e-a', source_id: 'pu-a', excerpt: '原文片段A', location: '正文字符 10-15', claim: '宏观背景', theme: '宏观背景', layer: 'macro', relationship: 'background', event_date: '2026-09-01', speaker: '负责人', occasion: '工作会议' },
      { evidence_id: 'pu-e-b', source_id: 'pu-b', excerpt: '原文片段B', claim: '项目落点', theme: '项目落点', layer: 'project', relationship: 'direct' },
    ],
    relations: [],
    gaps: [],
  }],
  content_review: { status: 'passed', issues: [] },
  human_review: { status: 'reviewed', version_id: 'v1' },
  audit_log: [],
};

test('项目理解位置计划器在合法父节点内幂等补全', () => {
  const first = planProjectUnderstandingPlacement(outline([{ id: '1.1', title: '项目概况', description: '项目名称与范围' }]));
  assert.equal(first.placement.status, 'added');
  assert.equal(first.outlineData.outline[0].children[0].feature_role, 'project-understanding');
  const second = planProjectUnderstandingPlacement(first.outlineData, { placement: first.placement });
  assert.equal(second.placement.status, 'reused');
  assert.equal(second.outlineData.outline[0].children.filter((item) => item.feature_role === 'project-understanding').length, 1);
});

test('项目概况不误判为项目理解，但真实分析章节可复用', () => {
  const result = planProjectUnderstandingPlacement(outline([
    { id: '1.1', title: '项目概况', description: '项目名称、地点与预算' },
    { id: '1.2', title: '对项目的理解', description: '分析国家战略、行业部署、采购人职责与项目需求' },
  ]));
  assert.equal(result.placement.status, 'reused');
  assert.equal(result.placement.node_id, '1.2');
});

test('无安全位置和用户排除时不擅自新增一级章', () => {
  const source = { outline: [{ id: '1', title: '固定响应表', title_locked: true, allow_ai_children: false, response_mode: 'fixed-markdown-table' }] };
  assert.equal(planProjectUnderstandingPlacement(source).placement.status, 'review-required');
  assert.equal(planProjectUnderstandingPlacement(outline(), { placement: { status: 'excluded', reason: '用户排除' } }).placement.status, 'excluded');
});

test('正文引用校验拒绝孤儿标记和无标记事实', () => {
  assert.equal(validateProjectUnderstandingContent('背景与本项目相关〔PU:pu-e-a〕', completeResearch).status, 'passed');
  assert.equal(validateProjectUnderstandingContent('引用错误〔PU:missing〕', completeResearch).status, 'issues');
  assert.equal(validateProjectUnderstandingContent('只有结论没有出处', completeResearch).status, 'issues');
  assert.equal(validateProjectUnderstandingContent('“被篡改的直接引语内容”〔PU:pu-e-a〕', completeResearch).status, 'issues');
});

test('项目理解子树只按归并后的独立 theme 自然拆分并聚合审核', () => {
  const placed = planProjectUnderstandingPlacement(outline()).outlineData;
  const state = { ...completeResearch, placement: { status: 'added', node_id: '1-project-understanding', reason: '测试' } };
  const split = buildProjectUnderstandingSubtree(placed, state.placement, [
    { theme: '行业发展背景', claim: '证据一' },
    { theme: '行业发展背景', claim: '证据二' },
    { theme: '本项目响应落点', claim: '证据三' },
  ]);
  const children = split.outline[0].children[0].children;
  assert.deepEqual(children.map((item) => item.title), ['行业发展背景', '本项目响应落点']);
  children[0].content = '背景事实〔PU:pu-e-a〕';
  assert.equal(validateProjectUnderstandingOutlineContent(split, state).status, 'issues');
  children[1].content = '项目事实〔PU:pu-e-b〕';
  assert.equal(validateProjectUnderstandingOutlineContent(split, state).status, 'passed');
  const keptAsLeaf = buildProjectUnderstandingSubtree(placed, state.placement, [
    { theme: '行业发展背景' },
    { theme: '行业发展背景分析' },
  ]);
  assert.equal(keptAsLeaf.outline[0].children[0].children, undefined);
});

test('刷新产生 pending 版本时不使当前正文审核失效', () => {
  const next = commitResearchVersionState(completeResearch, {
    ...completeResearch.versions[0],
    version_id: 'v2',
    reference_date: '2026-09-25',
  });
  assert.equal(next.active_version_id, 'v1');
  assert.equal(next.pending_version_id, 'v2');
  assert.equal(next.content_review.status, 'passed');
  assert.equal(next.human_review.status, 'reviewed');
});

test('相同输入缓存命中会落盘成功任务，强制刷新会绕过缓存', async () => {
  const outlineData = outline();
  const topics = ['行业政策'];
  const referenceDate = '2026-09-25';
  const scopeHash = buildResearchScopeHash({ outlineData });
  const inputHash = stableHash(JSON.stringify({ topics, referenceDate, outlineRevision: stableHash(JSON.stringify(outlineData)), scopeHash, promptVersion: 'project-understanding-v1.7.4-1', provider: 'brave', internal: [] }));
  let plan = {
    outlineData,
    projectUnderstanding: {
      ...completeResearch,
      versions: [{ ...completeResearch.versions[0], input_hash: inputHash, completed_at: new Date().toISOString() }],
    },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => plan,
    updateTechnicalPlan: (patch) => (plan = { ...plan, ...patch }),
  };
  const updateTask = (patch, state) => {
    const task = { type: 'project-understanding-research', ...patch };
    if (state) plan = { ...plan, projectUnderstandingTask: task };
    return task;
  };
  const base = {
    app: {},
    configStore: { load: () => ({ project_research: {} }) },
    aiService: {},
    workspaceStore,
    updateTask,
    taskControl: { isPauseRequested: () => false },
    payload: { topics, reference_date: referenceDate },
  };
  await runProjectUnderstandingResearchTask(base);
  assert.equal(plan.projectUnderstandingTask.status, 'success');
  await assert.rejects(runProjectUnderstandingResearchTask({ ...base, payload: { ...base.payload, force_refresh: true } }), /未配置 Brave Search API Key/);
});

test('授权知识库条目转为内部来源时不泄漏本地路径', () => {
  const result = loadInternalSources({
    getOutlineReferences: () => ({ items: [{ id: 'doc-1::item-1', title: '内部制度', resume: '摘要' }] }),
    readItems: () => [{ id: 'item-1', title: '适用范围', content: '内部制度正文内容，适用于本项目的授权分析。', source_file: 'C:\\Secret\\内部制度.docx' }],
  }, ['doc-1'], 8);
  assert.equal(result.sources[0].source_type, 'internal');
  assert.match(result.sources[0].internal_location, /内部制度\.docx/u);
  assert.doesNotMatch(result.sources[0].internal_location, /C:|Secret/u);
});

test('配置公开检索时为公开来源保留至少一个预算槽位', () => {
  assert.equal(getInternalSourceLimit(8, { api_key: 'configured' }), 7);
  assert.equal(getInternalSourceLimit(8, { api_key: '' }), 8);
  assert.equal(getInternalSourceLimit(1, { api_key: 'configured' }), 0);
});

test('讲话与适用性属性只有逐字存在于来源时才保留', async () => {
  const source = {
    source_id: 'pu-source', title: '来源', publisher: '主管部门',
    body: '2026年9月1日，张三在工作会议提出原文片段内容，适用于广东地区。',
  };
  const aiService = {
    requestJson: async () => ({ evidence: [{
      source_id: 'pu-source', excerpt: '张三在工作会议提出原文片段内容', claim: '工作部署', theme: '工作部署', layer: 'superior', relationship: 'direct',
      event_date: '2026-09-01', speaker: '张三', occasion: '工作会议', document_number: '虚构文号', region: '广东地区', effective_status: 'current', status_evidence: '虚构有效',
    }], gaps: [] }),
  };
  const result = await extractEvidence(aiService, [source], { referenceDate: '2026-09-25', topics: ['公开主题'] });
  assert.equal(result.evidence[0].relationship, 'direct');
  assert.equal(result.evidence[0].document_number, '');
  assert.equal(result.evidence[0].applicability.region, '广东地区');
  assert.equal(result.evidence[0].effective_status, 'unknown');
  assert.ok(result.gaps.length >= 2);
});

test('层层关联只接受模型明确返回且端点与支撑证据均存在的关系', async () => {
  const source = {
    source_id: 'pu-source', title: '来源', publisher: '主管部门',
    body: '国家战略明确推进数字化。上级单位部署提升服务能力。当前项目要求形成响应方案。',
  };
  let prompt = '';
  const aiService = {
    requestJson: async ({ messages }) => {
      prompt = messages[1].content;
      return {
        evidence: [
          { evidence_key: 'macro', source_id: 'pu-source', excerpt: '国家战略明确推进数字化', claim: '宏观背景', theme: '宏观背景', layer: 'macro', relationship: 'background' },
          { evidence_key: 'superior', source_id: 'pu-source', excerpt: '上级单位部署提升服务能力', claim: '上级部署', theme: '上级部署', layer: 'superior', relationship: 'direct' },
          { evidence_key: 'project', source_id: 'pu-source', excerpt: '当前项目要求形成响应方案', claim: '项目落点', theme: '项目落点', layer: 'project', relationship: 'direct' },
        ],
        relations: [
          { from_evidence_key: 'macro', to_evidence_key: 'superior', relation_type: 'background-context', relationship: 'background', support_evidence_keys: ['macro', 'superior'], support_source_id: 'pu-source', support_excerpt: '国家战略明确推进数字化', explanation: '背景关联' },
          { from_evidence_key: 'superior', to_evidence_key: 'project', relation_type: 'analytical-inference', relationship: 'inference', support_evidence_keys: ['superior', 'project'], support_source_id: 'pu-source', support_excerpt: '当前项目要求形成响应方案', explanation: '项目分析落点' },
        ],
        gaps: [],
      };
    },
  };
  const result = await extractEvidence(aiService, [source], { referenceDate: '2026-09-25', topics: ['公开主题'], projectContext: '当前标包：标包一' });
  assert.equal(result.relations.length, 2);
  assert.doesNotMatch(result.gaps.join('\n'), /缺少由明确证据关系支撑/u);
  assert.match(prompt, /当前标包：标包一/u);
  const packageText = formatEvidencePackage({
    ...completeResearch,
    versions: [{ ...completeResearch.versions[0], sources: [{ ...source, body: undefined }], evidence: result.evidence, relations: result.relations }],
  });
  assert.match(packageText, /已校验关联候选/u);
  assert.match(packageText, /background-context/u);

  const fabricatedDirect = await extractEvidence({ requestJson: async () => ({
    evidence: [
      { evidence_key: 'macro', source_id: 'pu-source', excerpt: '国家战略明确推进数字化', claim: '宏观背景', layer: 'macro', relationship: 'background' },
      { evidence_key: 'superior', source_id: 'pu-source', excerpt: '上级单位部署提升服务能力', claim: '上级部署', layer: 'superior', relationship: 'direct' },
      { evidence_key: 'project', source_id: 'pu-source', excerpt: '当前项目要求形成响应方案', claim: '项目落点', layer: 'project', relationship: 'direct' },
    ],
    relations: [
      { from_evidence_key: 'macro', to_evidence_key: 'superior', relation_type: 'group-control', relationship: 'direct', support_evidence_keys: ['macro'], support_source_id: 'pu-source', support_excerpt: '国家战略明确推进数字化', explanation: '虚构控制关系' },
      { from_evidence_key: 'superior', to_evidence_key: 'project', relation_type: 'policy-to-project', relationship: 'direct', support_evidence_keys: ['project'], support_source_id: 'pu-source', support_excerpt: '当前项目要求形成响应方案', explanation: '虚构落实关系' },
    ],
    gaps: [],
  }) }, [source], { referenceDate: '2026-09-25', topics: ['公开主题'] });
  assert.equal(fabricatedDirect.relations.length, 0);
  assert.match(fabricatedDirect.gaps.join('\n'), /关联候选，已拒绝/u);

  const withoutRelations = await extractEvidence({ requestJson: async () => ({ evidence: [
    { evidence_key: 'macro', source_id: 'pu-source', excerpt: '国家战略明确推进数字化', claim: '宏观背景', theme: '宏观背景', layer: 'macro', relationship: 'background' },
    { evidence_key: 'superior', source_id: 'pu-source', excerpt: '上级单位部署提升服务能力', claim: '上级部署', theme: '上级部署', layer: 'superior', relationship: 'direct' },
    { evidence_key: 'project', source_id: 'pu-source', excerpt: '当前项目要求形成响应方案', claim: '项目落点', theme: '项目落点', layer: 'project', relationship: 'direct' },
  ], relations: [], gaps: [] }) }, [source], { referenceDate: '2026-09-25', topics: ['公开主题'] });
  assert.equal(withoutRelations.relations.length, 0);
  assert.match(withoutRelations.gaps.join('\n'), /缺少由明确证据关系支撑/u);
});

test('Word 导出按首次出现编号并只追加已使用的参考依据', () => {
  const data = outline([{
    id: '1-project-understanding',
    title: '项目理解',
    description: '宏观背景与项目需求',
    feature_role: 'project-understanding',
    children: [
      { id: '1.1', title: '宏观关联', description: '', content: '事实B〔PU:pu-e-b〕' },
      { id: '1.2', title: '项目落点', description: '', content: '事实A〔PU:pu-e-a〕，再次B〔PU:pu-e-b〕' },
    ],
  }]);
  const result = prepareProjectUnderstandingExport(data, completeResearch);
  const first = result.outlineData.outline[0].children[0].children[0].content;
  const last = result.outlineData.outline[0].children[0].children[1].content;
  assert.match(first, /〔PU-1〕/);
  assert.match(last, /〔PU-2〕/);
  assert.equal((last.match(/权威来源B/g) || []).length, 1);
  assert.equal(result.draft, false);
});

test('人工复核只能接受显式可确认缺口，阻断缺口仍输出待复核稿', () => {
  const data = outline([{ id: '1-project-understanding', title: '项目理解', feature_role: 'project-understanding', content: '事实〔PU:pu-e-a〕' }]);
  const reviewableGap = '[可人工确认]来源权威性待人工复核';
  const accepted = JSON.parse(JSON.stringify(completeResearch));
  accepted.versions[0].gaps = [reviewableGap];
  accepted.versions[0].accepted_gaps = [reviewableGap];
  assert.equal(prepareProjectUnderstandingExport(data, accepted).draft, false);
  const blocked = JSON.parse(JSON.stringify(accepted));
  blocked.versions[0].status = 'partial';
  blocked.versions[0].gaps.push('缺少项目需求层证据');
  assert.equal(prepareProjectUnderstandingExport(data, blocked).draft, true);
});

test('已安排项目理解但尚无研究版本时 Word 仍标记待复核', () => {
  const data = planProjectUnderstandingPlacement(outline()).outlineData;
  const result = prepareProjectUnderstandingExport(data, {
    schema_version: 1,
    placement: { status: 'added', node_id: '1-project-understanding', reason: '测试' },
    versions: [],
    audit_log: [],
  });
  assert.equal(result.draft, true);
  assert.match(result.warnings[0], /尚无可核验资料版本/u);
  assert.match(result.outlineData.outline[0].children[0].content, /待人工复核/u);
});

test('项目理解出处进入真实 DOCX 文本与超链接关系', async () => {
  const data = outline([{
    id: '1-project-understanding',
    title: '项目理解',
    description: '',
    feature_role: 'project-understanding',
    content: '政策依据〔PU:pu-e-a〕',
  }]);
  const prepared = prepareProjectUnderstandingExport(data, completeResearch);
  const zip = new AdmZip(await buildDocxBuffer({ project_name: '项目理解引用测试', outline: prepared.outlineData.outline }));
  const xml = zip.readAsText('word/document.xml');
  const relations = zip.readAsText('word/_rels/document.xml.rels');
  assert.match(xml, /〔PU-1〕/u);
  assert.match(xml, /权威来源A/u);
  assert.match(xml, /正文字符 10-15/u);
  assert.match(xml, /负责人/u);
  assert.match(xml, /工作会议/u);
  assert.match(relations, /https:\/\/example\.gov\.cn\/a/u);
  assert.doesNotMatch(xml, /PU:pu-e-a/u);
});

test('局部 Word 导出只装配所选项目理解小节的引用', () => {
  const outlineData = outline([{
    id: '1-project-understanding', title: '项目理解', feature_role: 'project-understanding', children: [
      { id: 'pu-part-a', title: '背景', content: '事实A〔PU:pu-e-a〕' },
      { id: 'pu-part-b', title: '落点', content: '事实B〔PU:pu-e-b〕' },
    ],
  }]);
  const payload = resolveTechnicalPlanExportPayload({ source: 'technical-plan', nodeId: 'pu-part-b' }, {
    loadTechnicalPlan: () => ({ outlineData, projectUnderstanding: completeResearch }),
  });
  assert.equal(payload.outline.length, 1);
  assert.equal(payload.outline[0].id, 'pu-part-b');
  assert.match(payload.outline[0].content, /〔PU-1〕/u);
  assert.match(payload.outline[0].content, /权威来源B/u);
  assert.doesNotMatch(payload.outline[0].content, /权威来源A/u);
});

test('研究入口拒绝密钥、本地路径和过长查询', () => {
  assert.deepEqual(assertPublicTopics(['数字化转型国家战略', '上级单位公开部署']), ['数字化转型国家战略', '上级单位公开部署']);
  assert.throws(() => assertPublicTopics('API_KEY=secret'));
  assert.throws(() => assertPublicTopics('C:\\Users\\me\\tender.docx'));
  assert.throws(() => assertPublicTopics('合同报价 1200 万元'));
  assert.throws(() => assertPublicTopics('银行卡 6222020202020202020'));
  assert.throws(() => assertPublicTopics('x'.repeat(181)));
});

test('SSRF 地址检查覆盖 IPv4 映射 IPv6 与本地网段', () => {
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.2'), true);
  assert.equal(isPrivateAddress('100.100.100.200'), true);
  assert.equal(isPrivateAddress('224.0.0.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('无 Content-Length 的响应流在超过 2MB 时立即拒绝', async () => {
  async function* oversized() {
    yield Buffer.alloc(1024 * 1024);
    yield Buffer.alloc(1024 * 1024 + 1);
  }
  await assert.rejects(readLimitedBody(oversized()), /超过 2MB/);
});

test('整体研究预算和取消能结束业务等待并暂停当前 AI 队列 scope', async () => {
  let stops = 0;
  await assert.rejects(waitForResearchOperation(new Promise(() => {}), Date.now() + 10, undefined, () => { stops += 1; }), /超过整体任务预算/u);
  const controller = new AbortController();
  const canceled = waitForResearchOperation(new Promise(() => {}), Date.now() + 1000, controller.signal, () => { stops += 1; });
  controller.abort();
  await assert.rejects(canceled, (error) => error.code === 'TASK_CANCELED');
  assert.equal(stops, 2);
});

test('项目理解取消信号会中止模型传输且不触发重试', async () => {
  let requests = 0;
  let transportClosed = false;
  let received;
  const receivedRequest = new Promise((resolve) => { received = resolve; });
  const server = http.createServer((request, response) => {
    requests += 1;
    response.on('close', () => { transportClosed = true; });
    received();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    const port = server.address().port;
    const pending = __aiServiceRuntime.chatWithConfig({}, {
      api_key: 'test', model_name: 'test-model', base_url: `http://127.0.0.1:${port}/v1`, request_mode: 'normal', developer_mode: false,
    }, { messages: [{ role: 'user', content: 'json' }], signal: controller.signal }, undefined);
    await receivedRequest;
    controller.abort();
    await assert.rejects(pending, /AI 请求已取消/u);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(requests, 1);
    assert.equal(transportClosed, true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTML 正文提取忽略脚本并保留发布元数据', () => {
  const body = '<p>' + '权威正文内容。'.repeat(60) + '</p>';
  const parsed = htmlToText(Buffer.from(`<html><head><title>政策标题</title><meta property="og:site_name" content="主管部门"><meta property="article:published_time" content="2026-09-01"></head><body><script>secret</script><article>${body}</article></body></html>`));
  assert.equal(parsed.title, '政策标题');
  assert.equal(parsed.publisher, '主管部门');
  assert.equal(parsed.publishedAt, '2026-09-01');
  assert.doesNotMatch(parsed.text, /secret/);
});

test('HTML 正文提取支持政府站常见 GBK 编码', () => {
  const html = `<html><head><meta charset="gbk"><title>政策标题</title></head><body><article>${'政府公开正文。'.repeat(60)}</article></body></html>`;
  const parsed = htmlToText(iconv.encode(html, 'gb18030'), 'text/html; charset=gbk');
  assert.equal(parsed.title, '政策标题');
  assert.match(parsed.text, /政府公开正文/u);
});

test('Brave 检索配置保存在本地配置并限制预算范围', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-project-research-config-'));
  const store = createConfigStore({ getPath: () => userData });
  try {
    store.save({ project_research: { api_key: 'local-test-key', max_results_per_topic: 99, max_sources: 0, timeout_ms: 1000, overall_timeout_ms: 9999999 } });
    const config = store.load().project_research;
    assert.equal(config.api_key, 'local-test-key');
    assert.equal(config.max_results_per_topic, 20);
    assert.equal(config.max_sources, 8);
    assert.equal(config.timeout_ms, 5000);
    assert.equal(config.overall_timeout_ms, 900000);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('SQLite v25 持久化项目理解状态，用户删除节点后记录排除', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-project-understanding-'));
  const app = new EventEmitter();
  app.getPath = () => userData;
  let sqlite;
  try {
    sqlite = createSqliteDatabase(app);
  } catch (error) {
    fs.rmSync(userData, { recursive: true, force: true });
    if (error?.code === 'ERR_DLOPEN_FAILED') {
      t.skip(`better-sqlite3 当前与 Node ABI 不匹配：${error.message}`);
      return;
    }
    throw error;
  }
  const store = createTechnicalPlanStore({ app, db: sqlite.db, fileService: {} });
  try {
    const placed = planProjectUnderstandingPlacement(outline()).outlineData;
    store.updateTechnicalPlan({ outlineData: placed, projectUnderstanding: completeResearch });
    assert.equal(store.loadTechnicalPlan().outlineData.outline[0].children[0].feature_role, 'project-understanding');
    assert.ok(sqlite.db.prepare("PRAGMA table_info(technical_plan_meta)").all().some((column) => column.name === 'project_understanding_json'));
    const edited = JSON.parse(JSON.stringify(placed));
    edited.outline[0].children[0].children = [{ id: '1-project-understanding-child', title: '新增分析主题', description: '' }];
    store.saveOutline({ outlineData: edited, reason: 'add-child', affectedNodeIds: ['1-project-understanding'] });
    assert.equal(store.loadTechnicalPlan().projectUnderstanding.human_review.status, 'stale');
    const reviewable = JSON.parse(JSON.stringify(completeResearch));
    reviewable.versions[0].status = 'partial';
    reviewable.versions[0].gaps = ['[可人工确认]内部资料版本待复核', '缺少上级部署证据'];
    reviewable.human_review = { status: 'unreviewed' };
    store.updateTechnicalPlan({ projectUnderstanding: reviewable });
    store.updateProjectUnderstanding('mark-reviewed');
    assert.deepEqual(store.loadTechnicalPlan().projectUnderstanding.versions[0].accepted_gaps, ['[可人工确认]内部资料版本待复核']);
    assert.equal(store.loadTechnicalPlan().projectUnderstanding.versions[0].status, 'partial');
    store.saveOutline({ outlineData: outline(), reason: 'delete', affectedNodeIds: ['1-project-understanding'] });
    assert.equal(store.loadTechnicalPlan().projectUnderstanding.placement.status, 'excluded');
    store.switchWorkflowKind('existing-plan-expansion');
    assert.equal(store.loadTechnicalPlan().projectUnderstanding, undefined);
  } finally {
    sqlite.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
