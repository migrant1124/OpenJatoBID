const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getBidAnalysisTaskDefinitions,
  isBidAnalysisTaskResultValid,
  normalizeProcurementAnalysisResult,
  runBidAnalysisPromptTask,
  runBidAnalysisTask,
} = require('./bidAnalysisTask.cjs');

function buildProcurementResult() {
  return {
    schema_version: 1,
    extraction_status: {
      procurement_items: 'found',
      quotation_rules: 'found',
    },
    procurement_items: [{
      item_name: '服务器',
      quantity: '2',
      unit: '台',
      attributes: [{ name: '处理器', value: '不少于 16 核' }],
      applicable_scope: '第一标包',
      delivery_or_acceptance_requirements: ['到货后 30 日内验收'],
    }],
    quotation_rules: {
      pricing_method: ['按分项报价表总价报价'],
      price_limits: [],
      tax_and_invoice: [],
      cost_scope: [],
      calculation_and_rounding: [],
      quote_documents_and_attachments: [],
      submission_method_or_platform: [],
      consistency_and_priority: [],
      invalid_or_abnormal_price: [],
      settlement_and_payment: [],
      other_explicit_rules: [],
    },
  };
}

test('采购与报价使用全量结构化 JSON 固定 schema', () => {
  const task = getBidAnalysisTaskDefinitions().find((item) => item.id === 'procurementList');
  assert.equal(task.output, 'json');
  assert.equal(task.schema_version, 1);
  assert.deepEqual(normalizeProcurementAnalysisResult(buildProcurementResult()), buildProcurementResult());
  assert.equal(isBidAnalysisTaskResultValid(task, { status: 'success', content: JSON.stringify(buildProcurementResult()) }), true);
  assert.equal(isBidAnalysisTaskResultValid(task, { status: 'success', content: '| 采购项 | 数量 |\n| --- | --- |' }), false);
  assert.equal(isBidAnalysisTaskResultValid(task, {
    status: 'success',
    content: JSON.stringify({ ...buildProcurementResult(), procurement_items: [{}] }),
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
