const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getBidAnalysisTaskDefinitions,
  getBidAnalysisTaskById,
  isBidAnalysisTaskResultValid,
  normalizeProcurementAnalysisResult,
  runBidAnalysisPromptTask,
  runBidAnalysisTask,
} = require('./bidAnalysisTask.cjs');

function buildProcurementResult() {
  return {
    schema_version: 2,
    procurement_summary: {
      target_name: '2026-2028 年变电站安健环标识',
      package_name: '2026-2028 年变电站安健环标识',
      package_amount: '1300 万元',
      procurement_scope: '安健环标识制作及施工',
      delivery_period: '订单发出之日起 15 日历天内',
      delivery_location: '甲方指定地点',
      implementation_scope: '海口、三亚变电运检分公司及建设分公司',
    },
    quotation_summary: {
      pricing_method: '固定金额报单价',
      price_evaluation_method: '按单价乘以单价权重后的含权投标价合计计算评标价格分',
      price_limit_rule: '超过单价最高限价的投标报价视为无效报价',
      settlement_method: '单价包干，订单金额=单价×数量',
      platform_or_transaction_requirements: '中标后在南网商城履行',
      tax_and_fee_requirements: '税率按照国家发布的最新政策执行',
      invalid_quote_rules: ['超过最高限价视为无效报价'],
      other_explicit_rules: ['平台服务费按订单金额 8‰ 收取'],
    },
    quotation_table: {
      exists: true,
      table_name: '分项报价表',
      item_count_or_range: '序号 1-126',
      columns: ['名称', '技术规范', '规格', '单位', '数量', '权重', '单价最高限价'],
      representative_item_categories: ['禁止、警告、指令标志', '设备标示牌'],
      source_note: '只提取报价表概况，不逐行展开明细。',
    },
    quote_documents: ['分项报价表', '成本分析报告（如有）'],
  };
}

test('采购与报价使用摘要结构化 JSON 固定 schema', () => {
  const task = getBidAnalysisTaskDefinitions().find((item) => item.id === 'procurementList');
  assert.equal(task.output, 'json');
  assert.equal(task.schema_version, 2);
  assert.deepEqual(normalizeProcurementAnalysisResult(buildProcurementResult()), buildProcurementResult());
  assert.equal(isBidAnalysisTaskResultValid(task, { status: 'success', content: JSON.stringify(buildProcurementResult()) }), true);
  assert.equal(isBidAnalysisTaskResultValid(task, { status: 'success', content: '| 采购项 | 数量 |\n| --- | --- |' }), false);
  assert.equal(isBidAnalysisTaskResultValid(task, {
    status: 'success',
    content: JSON.stringify({ ...buildProcurementResult(), quotation_table: { exists: true } }),
  }), false);
});

test('分段招标解析会报告每段完成及合并阶段', async () => {
  const events = [];
  const result = await runBidAnalysisPromptTask({
    aiService: {
      requestJson: async () => ({ result: 'segment' }),
      chat: async () => JSON.stringify({ result: 'merged' }),
      parseJsonResponseContent: async () => ({ result: 'merged' }),
    },
    fileContent: '招标原文',
    fileSegments: ['第一段', '第二段'],
    task: {
      label: '分段解析测试',
      output: 'json',
      prompt: () => '请输出 json',
    },
    jsonNormalizer: (value) => value,
    onSegmentProgress: (event) => events.push(event),
  });

  assert.deepEqual(JSON.parse(result), { result: 'merged' });
  assert.equal(events.filter((event) => event.phase === 'segment-started').length, 2);
  assert.equal(events.filter((event) => event.phase === 'segment-completed').length, 2);
  assert.deepEqual(events.at(-1), { phase: 'merging', totalSegments: 2, completedSegments: 2 });
});

test('采购与报价解析仅发送采购报价相关片段', async () => {
  const unrelated = '无关技术条款。'.repeat(2000);
  const fileContent = `${unrelated}

2.6 标的物清单及分包情况：
标的名称：2026-2028 年变电站安健环标识
报价方式：固定金额报单价。
本项目设单价最高限价，详见《分项报价表》。

${unrelated}

分项报价表
招标项目名称：测试项目
序号名称技术规范规格单位数量权重单价最高限价含权投标价
1 禁止、警告、指令标志 500*400 件 1 1.00% 121.5 0
填写说明：
投标文件开标一览表中投标报价须按照《分项报价表》含权投标价合计值填写。

${unrelated}`;
  let contextMessage = '';

  await runBidAnalysisPromptTask({
    aiService: {
      getConfig: () => ({ context_length_limit: 1000000 }),
      requestJson: async ({ messages }) => {
        contextMessage = messages.find((message) => message.role === 'user')?.content || '';
        return buildProcurementResult();
      },
    },
    fileContent,
    task: getBidAnalysisTaskById('procurementList'),
    jsonNormalizer: normalizeProcurementAnalysisResult,
  });

  assert.match(contextMessage, /筛选出的采购、报价、限价、结算、报价表和报价文件相关片段/u);
  assert.match(contextMessage, /报价方式：固定金额报单价/u);
  assert.match(contextMessage, /分项报价表/u);
  assert.ok(contextMessage.length < fileContent.length / 2);
});

test('技术评分要求解析完成后自动识别重点编写项，失败前不阻断解析任务', async () => {
  const state = { bidAnalysisTasks: {} };
  let focusInput = '';
  const focusMatrix = {
    schema_version: 1,
    revision: 'focus-writing-v1',
    scoring_points: [],
    rejection_risks: [],
    hidden_requirements: [],
    value_anchors: [],
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  const workspaceStore = {
    readTenderMarkdown() {
      return '招标文件正文';
    },
    loadTechnicalPlan() {
      return state;
    },
    updateTechnicalPlan(patch) {
      Object.assign(state, patch);
      return state;
    },
  };
  const aiService = {
    getConfig() {
      return { context_length_limit: 100000 };
    },
    async requestJson({ progressLabel }) {
      return progressLabel === '采购与报价' ? buildProcurementResult() : { value: '已解析' };
    },
    async chat({ messages }) {
      const prompt = messages.at(-1).content;
      return prompt.includes('技术投标文件/技术响应文件')
        ? '【技术文件目录状态】：明确\n# 技术文件目录'
        : '已解析';
    },
  };

  await runBidAnalysisTask({
    aiService,
    workspaceStore,
    payload: { run_id: 'bid-analysis-test', mode: 'key' },
    updateTask(patch) {
      return { task_id: 'bid-analysis-test', ...patch };
    },
    waitForWarmup: async () => {},
    runFocusWritingTask: async ({ techRequirements }) => {
      focusInput = techRequirements;
      return focusMatrix;
    },
  });

  assert.equal(focusInput, '已解析');
  assert.equal(state.requirementResponseMatrix, focusMatrix);
  assert.equal(state.bidAnalysisTask.status, 'success');
});

test('重点编写项识别失败时按普通目录流程完成招标文件解析', async () => {
  const state = { bidAnalysisTasks: {} };
  const workspaceStore = {
    readTenderMarkdown() {
      return '招标文件正文';
    },
    loadTechnicalPlan() {
      return state;
    },
    updateTechnicalPlan(patch) {
      Object.assign(state, patch);
      return state;
    },
  };
  const aiService = {
    getConfig() {
      return { context_length_limit: 100000 };
    },
    async requestJson({ progressLabel }) {
      return progressLabel === '采购与报价' ? buildProcurementResult() : { value: '已解析' };
    },
    async chat({ messages }) {
      return messages.at(-1).content.includes('技术投标文件/技术响应文件')
        ? '【技术文件目录状态】：明确\n# 技术文件目录'
        : '已解析';
    },
  };

  await runBidAnalysisTask({
    aiService,
    workspaceStore,
    payload: { run_id: 'bid-analysis-focus-failure', mode: 'key' },
    updateTask(patch) {
      return { task_id: 'bid-analysis-focus-failure', ...patch };
    },
    waitForWarmup: async () => {},
    runFocusWritingTask: async () => {
      throw new Error('模型不可用');
    },
  });

  assert.equal(state.requirementResponseMatrix, undefined);
  assert.equal(state.bidAnalysisTask.status, 'success');
});
