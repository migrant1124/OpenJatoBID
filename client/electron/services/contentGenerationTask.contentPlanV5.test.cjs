'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { __contentPlanContractRuntime, __developerContentExpansionPatchRuntime } = require('./contentGenerationTask.cjs');
const { CONTENT_PLAN_PROMPT_VERSION } = require('./sectionWritingContract.cjs');

function contract() {
  return {
    writing_profile: 'deep',
    section_role: '承担实施方案的闭环说明',
    scoring_point_ids: ['R1.P1'], value_anchor_ids: ['A1'],
    must_answer_questions: ['如何形成实施闭环'], key_claims: ['按项目实际资料执行'],
    implementation_steps: ['启动', '执行', '验收'], quantitative_details: ['阈值待确认'],
    deliverables: ['实施记录'], acceptance_criteria: ['验收确认'], evidence_requirements: ['待提供证明材料'],
    cross_section_boundaries: { owns: ['实施闭环'], excludes: ['售后服务'], related_node_ids: ['1.1.1'] },
    knowledge: { item_ids: ['K1'] }, facts: { titles: ['项目地点'] },
    table: { needed: true, purpose: '展示实施步骤' },
    table_briefs: [{ title: '实施步骤表', purpose: '展示阶段和产物', columns: ['阶段', '产物'] }],
    illustration_briefs: [{ title: '实施闭环图', purpose: '展示闭环', visual_role: '流程说明' }],
    target_words: { min: 300, preferred: 500, max: 800 }, forbidden_repetition: ['售后服务细则'],
  };
}

test('Content Plan v5 保留完整章节写作合同并拒绝 v4 复用', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan(contract(), new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  assert.doesNotThrow(() => __contentPlanContractRuntime.validateContentPlan(plan));
  const stored = __contentPlanContractRuntime.createStoredContentPlan(plan, 'moderate', { prompt_version: 'content-plan-v5' });
  assert.equal(stored.plan_version, 5);
  assert.equal(__contentPlanContractRuntime.normalizeStoredContentPlan(stored).plan.writing_profile, 'deep');
  assert.equal(__contentPlanContractRuntime.normalizeStoredContentPlan({ plan_version: 4, plan }), null);
  assert.equal(CONTENT_PLAN_PROMPT_VERSION, 'content-plan-v5-writing-1.7.3');
});

test('旧策略计划保持结构可读并保留原方案来源映射', () => {
  const stored = __contentPlanContractRuntime.createStoredContentPlan({
    ...contract(),
    original_material: { restored: true, optimized: false, source_ids: ['S1'], source_titles: ['原方案章节'], source_hashes: ['H1'], restored_chars: 320 },
  }, 'moderate', { prompt_version: 'content-plan-v5' });
  const normalized = __contentPlanContractRuntime.normalizeStoredContentPlan(stored);
  assert.equal(normalized.plan.original_material.restored, true);
  assert.deepEqual(__contentPlanContractRuntime.originalMaterialFromStoredPlan(stored).source_ids, ['S1']);
});

test('深度写作合同进入正文提示词，编排提示词要求完整合同', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan(contract(), new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  const contentPrompt = __contentPlanContractRuntime.buildChapterContentMessages({
    chapter: { id: '1.1.1', title: '实施步骤', description: '实施闭环' }, projectOverview: '', selectedFactsText: '', regenerateRequirement: '', contentPlan: plan, knowledgeContents: [],
  }).map((message) => message.content).join('\n');
  assert.match(contentPrompt, /深度写作/);
  assert.match(contentPrompt, /实施闭环/);
  const planningPrompt = __contentPlanContractRuntime.buildChapterContentPlanMessages({
    chapter: { id: '1.1.1', title: '实施步骤', description: '实施闭环' }, parentChapters: [], siblingChapters: [], projectOverview: '', bidAnalysisFactsText: '', globalFactTitlesText: '', regenerateRequirement: '', tableRequirement: 'moderate', maxTables: 2, tableTotalSections: 1, knowledgeItems: [], writingProfile: 'deep', chapterWritingTask: { chapter_node_id: '1.1' },
  }).map((message) => message.content).join('\n');
  assert.match(planningPrompt, /SectionWritingContract/);
  assert.match(planningPrompt, /"writing_profile": "deep"/);
  assert.match(planningPrompt, /不适用的数组保持为空/);
  assert.doesNotMatch(planningPrompt, /"quantitative_details": \["[^"\]]*待确认/);
});

test('正文消息使用 1.7.3 共用政策并移除机械短句硬规则', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan(contract(), new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  const prompt = __contentPlanContractRuntime.buildChapterContentMessages({
    chapter: { id: '1.1.1', title: '实施步骤', description: '实施闭环' },
    projectOverview: '项目由采购人组织实施。', selectedFactsText: '项目地点：广州', regenerateRequirement: '', contentPlan: plan, knowledgeContents: [],
    sectionContextText: '同级章节职责：售后章节负责售后服务。',
  }).map((message) => message.content).join('\n');
  assert.match(prompt, /writing-v1\.7\.3/);
  assert.match(prompt, /句长由语义决定/);
  assert.match(prompt, /不要求逐项写入/);
  assert.doesNotMatch(prompt, /每句话不超过30个汉字|全文主语必须|词汇替换映射表|强制禁用以下AI高频词/);
});

test('正文计划格式化保留排除边界并省略无意义空字段', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan({
    ...contract(), scoring_point_ids: [], value_anchor_ids: [], quantitative_details: [], deliverables: [], acceptance_criteria: [], evidence_requirements: [],
  }, new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  const formatted = __contentPlanContractRuntime.formatContentPlanForPrompt(plan);
  assert.match(formatted, /其他章节负责，本节避免完整展开：售后服务/);
  assert.match(formatted, /相关章节ID：1\.1\.1/);
  assert.doesNotMatch(formatted, /评分点：无|量化细节：无|证据要求：无/);
});

test('纯正文和 JSON 修订路径选择适用政策且保留协议', () => {
  const restoredMessages = __contentPlanContractRuntime.buildRestoredChapterContentMessages({
    chapter: { id: '1.1.1', title: '实施' }, projectOverview: '', selectedFactsText: '', regenerateRequirement: '',
    contentPlan: { ...contract(), table: { needed: false, purpose: '' } }, knowledgeContents: [],
    restoredContent: '正文\n\n| 参数 | 值 |\n| --- | --- |\n| 工期 | 30日 |\n\n![示意图](asset://example.png)',
  }).map((message) => message.content).join('\n');
  const restoredPrompt = __contentPlanContractRuntime.buildAgentRestoredChapterContentPrompt();
  const tablePrompt = __contentPlanContractRuntime.buildTableCleanupMessages({ chapter: { id: '1.1.1', title: '实施' }, tables: [{ id: 'T001', text: '|A|B|' }] }).map((message) => message.content).join('\n');
  const coveragePrompt = __contentPlanContractRuntime.buildOriginalCoverageRepairMessages({
    target: { item: { id: '1.1.1', title: '实施' }, sources: [] }, coverageItems: [], currentContent: '现有正文', attempt: 1, failures: [],
  }).map((message) => message.content).join('\n');
  assert.match(restoredPrompt, /writing-v1\.7\.3/);
  assert.match(restoredMessages, /表格必须原样保留/);
  assert.match(restoredMessages, /图片 Markdown 或 HTML img 标签必须原样保留/);
  assert.match(restoredPrompt, /已有的 Markdown\/HTML 表格、图片 Markdown 和 HTML img 标签必须原样保留/);
  assert.match(tablePrompt, /"replacements"/);
  assert.match(tablePrompt, /省略对应 table_id/);
  assert.doesNotMatch(tablePrompt, /也要用一句普通文字概括/);
  assert.match(coveragePrompt, /"operation": "insert"/);
  assert.match(coveragePrompt, /局部正文修订规则/);
  assert.doesNotMatch(tablePrompt, /直接返回章节内容/);
});

test('评分价值扩写提示词保留章节合同而非只按字数扩写', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan(contract(), new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  const prompt = __developerContentExpansionPatchRuntime.buildContentExpansionMessages({
    outlineData: { outline: [{ id: '1', title: '技术方案', children: [{ id: '1.1', title: '实施方案', children: [{ id: '1.1.1', title: '实施步骤' }] }] }] },
    context: { item: { id: '1.1.1', title: '实施步骤', description: '实施闭环' }, parentChapters: [{ id: '1', title: '技术方案' }, { id: '1.1', title: '实施方案' }], siblingChapters: [] },
    projectOverview: '', selectedFactsText: '', currentContent: '现有正文', currentWords: 4, targetWords: 500, contentPlan: plan,
  }).map((message) => message.content).join('\n');
  assert.match(prompt, /章节写作合同/);
  assert.match(prompt, /实施闭环/);
  assert.match(prompt, /不得为了凑字数复述已有内容/);
});

test('正文扩写按多个精确锚点局部插入，不重写整节正文', () => {
  const source = '第一段：项目启动。\n\n第二段：实施执行。';
  const patch = __developerContentExpansionPatchRuntime.normalizeContentExpansionOperations({
    operations: [
      { operation: 'insert', anchor: '第一段：项目启动。', content: '补充：启动阶段完成职责分工与资料核验。' },
      { operation: 'insert', anchor: 'end', content: '补充：执行完成后形成验收记录。' },
    ],
  });
  assert.doesNotThrow(() => __developerContentExpansionPatchRuntime.validateContentExpansionOperations(patch));
  assert.equal(__developerContentExpansionPatchRuntime.applyContentExpansionOperations(source, patch), [
    '第一段：项目启动。',
    '补充：启动阶段完成职责分工与资料核验。',
    '第二段：实施执行。',
    '补充：执行完成后形成验收记录。',
  ].join('\n\n'));
});

test('正文扩写拒绝模糊、重复或受保护 Markdown 范围', () => {
  const runtime = __developerContentExpansionPatchRuntime;
  const duplicateAnchor = runtime.normalizeContentExpansionOperations({
    operations: [{ operation: 'insert', anchor: '重复段落。', content: '补充内容。' }],
  });
  assert.throws(() => runtime.applyContentExpansionOperations('重复段落。\n\n重复段落。', duplicateAnchor), /精确唯一命中/);

  const protectedAnchor = runtime.normalizeContentExpansionOperations({
    operations: [{ operation: 'insert', anchor: '![示意图](asset://example.png)', content: '补充内容。' }],
  });
  assert.throws(() => runtime.applyContentExpansionOperations('正文。\n\n![示意图](asset://example.png)', protectedAnchor), /不能在图片、代码块或表格内部插入/);
});

test('原方案补写复用精确锚点和受保护范围运行时', () => {
  const runtime = __developerContentExpansionPatchRuntime;
  const agentPatch = runtime.normalizeAgentOriginalCoverageOperations({
    operations: [{ section_id: '1.1.1', operation: 'insert', anchor: 'end', content: '补充内容。' }],
  }, new Set(['1.1.1']));
  assert.equal(runtime.applyContentExpansionOperations('第一段。', { operations: agentPatch.operations }), '第一段。\n\n补充内容。');
  assert.throws(
    () => runtime.normalizeAgentOriginalCoverageOperations({ operations: [{ section_id: '9.9.9', operation: 'insert', anchor: 'end', content: '补充内容。' }] }, new Set(['1.1.1'])),
    /section_id 无效/,
  );
  assert.throws(
    () => runtime.applyContentExpansionOperations('第一段。\n\n第二段。', { operations: [{ operation: 'insert', anchor: '第一 段。', content: '补充内容。' }] }),
    /精确唯一命中/,
  );
  assert.throws(
    () => runtime.applyContentExpansionOperations('| 参数 | 值 |\n| --- | --- |\n| 工期 | 30日 |', { operations: [{ operation: 'replace', target_text: '| 工期 | 30日 |', content: '工期为30日。' }] }),
    /不能修改图片、代码块或表格/,
  );
});

test('原方案优化必须原样保留既有表格和图片引用', () => {
  const source = '正文。\n\n| 参数 | 值 |\n| --- | --- |\n| 工期 | 30日 |\n\n![示意图](asset://example.png)\n\n![示意图](asset://example.png)';
  const runtime = __developerContentExpansionPatchRuntime;
  assert.doesNotThrow(() => runtime.assertRestoredRichContentPreserved(source, `优化正文。\n\n${source.slice(source.indexOf('| 参数'))}`));
  assert.throws(() => runtime.assertRestoredRichContentPreserved(source, '优化正文。'), /缺少或改写了底稿中的表格或图片引用/);
  assert.throws(
    () => runtime.assertRestoredRichContentPreserved(source, source.replace('| 工期 | 30日 |', '| 工期 | 30日 |\n| 质保 | 1年 |')),
    /缺少或改写了底稿中的表格或图片引用/,
  );
  assert.throws(
    () => runtime.assertRestoredRichContentPreserved(source, source.replace('\n\n![示意图](asset://example.png)', '')),
    /缺少、增加或改写了底稿中的表格或图片引用/,
  );
});

test('最低字数补目录拒绝同一二级目录下六个模型新增的并列三级叶子', () => {
  const runtime = __developerContentExpansionPatchRuntime;
  const outline = [{
    id: '1', title: '技术方案', description: '技术方案说明', children: [{
      id: '1.1', title: '服务方案', description: '服务方案说明', focus_priority: 'service-plan', allow_ai_children: true,
    }],
  }];
  const patch = {
    additions: Array.from({ length: 6 }, (_item, index) => ({
      parent_id: '1.1', title: `模型新增事项${index + 1}`, description: `模型新增事项${index + 1}说明`,
    })),
  };

  assert.throws(
    () => runtime.applyOutlineExpansionAdditions(outline, patch),
    /同一二级目录下模型新增的无子节点三级目录不能超过 5 个/u,
  );
});

test('最低字数补目录仅允许重点章节新增五级叶子，且不拆分已有正文节点', () => {
  const runtime = __developerContentExpansionPatchRuntime;
  const focusOutline = [{
    id: '1', title: '技术方案', description: '技术方案说明', children: [{
      id: '1.1', title: '服务方案', description: '服务方案说明', focus_priority: 'service-plan', children: [{
        id: '1.1.1', title: '实施组织', description: '实施组织说明', allow_ai_children: true,
      }],
    }],
  }];
  const focusPatch = {
    additions: [{
      parent_id: '1.1.1', title: '人员配置', description: '人员配置说明', children: [
        { title: '项目经理职责', description: '项目经理职责说明' },
        { title: '专业人员分工', description: '专业人员分工说明' },
      ],
    }],
  };
  const result = runtime.applyOutlineExpansionAdditions(focusOutline, focusPatch);
  assert.equal(result.outline[0].children[0].children[0].children[0].children.length, 2);

  const protectedOutline = [{
    id: '1', title: '技术方案', description: '技术方案说明', children: [{
      id: '1.1', title: '服务方案', description: '服务方案说明', focus_priority: 'service-plan', allow_ai_children: true, content: '已生成正文',
    }],
  }];
  assert.throws(
    () => runtime.applyOutlineExpansionAdditions(protectedOutline, { additions: [{ parent_id: '1.1', title: '不应新增', description: '不应新增' }] }),
    /父节点不允许 AI 新增子目录/u,
  );
});
