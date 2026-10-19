'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const research = require('./projectUnderstandingResearch.cjs');

function loadPreparation(runResearch) {
  const researchFile = require.resolve('./projectUnderstandingResearch.cjs');
  const preparationFile = require.resolve('./contentResearchPreparation.cjs');
  const oldResearch = require.cache[researchFile].exports;
  const oldPreparation = require.cache[preparationFile];
  require.cache[researchFile].exports = { ...research, runProjectUnderstandingResearchTask: runResearch };
  delete require.cache[preparationFile];
  try { return require(preparationFile).prepareContentProjectResearch; }
  finally {
    require.cache[researchFile].exports = oldResearch;
    if (oldPreparation) require.cache[preparationFile] = oldPreparation;
    else delete require.cache[preparationFile];
  }
}

function fixture(payload = {}) {
  let state = {
    outlineData: { outline: [{ id: '1', title: '技术方案', children: [
      { id: '1.1', title: '项目理解', feature_role: 'project-understanding' },
      { id: '1.2', title: '实施方案', content: '员工已编写的正文' },
    ] }] },
    projectOverview: '公共文化宣传服务', globalFactsTask: { status: 'success' },
    contentGenerationTask: { status: 'paused' },
  };
  let modelCalls = 0;
  const options = {
    payload, previousState: structuredClone(state),
    configStore: { load: () => ({ project_research: { provider: 'baidu', baidu_api_key: 'fixture-key' } }) },
    aiService: { requestJson: async () => { modelCalls++; return ['公共文化 服务政策', '公共文化 主管部门职责']; } },
    workspaceStore: {
      loadTechnicalPlan: () => structuredClone(state),
      updateTechnicalPlan: (partial) => { state = { ...state, ...structuredClone(partial) }; return structuredClone(state); },
    },
    taskControl: { isPauseRequested: () => false },
    updateTask: (partial) => partial,
  };
  return { options, state: () => state, modelCalls: () => modelCalls };
}

test('缺证据时自动规划公开主题并研究官网，衔接正文且保留旧正文', async () => {
  const f = fixture();
  let calls = 0;
  const prepare = loadPreparation(async ({ payload, workspaceStore }) => {
    calls++;
    assert.equal(payload.official_only, true);
    assert.deepEqual(payload.topics, ['公共文化 服务政策 site:gov.cn', '公共文化 主管部门职责 site:gov.cn']);
    const state = workspaceStore.loadTechnicalPlan();
    workspaceStore.updateTechnicalPlan({ projectUnderstanding: { ...state.projectUnderstanding, active_version_id: 'v1', versions: [{ version_id: 'v1', evidence: [{ evidence_id: 'e1' }] }] } });
  });
  const prepared = await prepare(f.options);
  assert.equal(calls, 1);
  assert.equal(f.modelCalls(), 1);
  assert.equal(prepared.previousState.projectUnderstanding.active_version_id, 'v1');
  assert.equal(prepared.previousState.outlineData.outline[0].children[1].content, '员工已编写的正文');
  assert.equal(f.state().projectUnderstandingTask.status, 'success');
});

test('已有证据、普通单节及仅配图入口均不重复研究', async () => {
  const prepare = loadPreparation(async () => { assert.fail('不应联网研究'); });
  for (const payload of [{ targetItemId: '1.2' }, { rerunIllustrations: true }, { retryContentCorrection: true }]) {
    const f = fixture(payload);
    assert.deepEqual(await prepare(f.options), {});
    assert.equal(f.modelCalls(), 0);
  }
  const f = fixture();
  f.options.workspaceStore.updateTechnicalPlan({ projectUnderstanding: { active_version_id: 'v1', versions: [{ version_id: 'v1', evidence: [{}] }] } });
  assert.deepEqual(await prepare(f.options), {});
  assert.equal(f.modelCalls(), 0);
});

test('继续已暂停的普通单节时按 runtime 目标判断，不触发全项目研究', async () => {
  const f = fixture({ resume: true });
  f.options.previousState.contentGenerationRuntime = { phase: 'generating', target_item_id: '1.2' };
  f.options.workspaceStore.updateTechnicalPlan({ contentGenerationRuntime: f.options.previousState.contentGenerationRuntime });
  const prepare = loadPreparation(async () => { assert.fail('普通单节继续不应联网研究'); });
  assert.deepEqual(await prepare(f.options), {});
  assert.equal(f.modelCalls(), 0);
});

test('活动任务查询不把正文内联研究误标为应用关闭中断', async () => {
  const { createTaskService } = require('./taskService.cjs');
  const f = fixture();
  f.options.workspaceStore.updateTechnicalPlan({ contentGenerationTask: undefined });
  let releaseTopics;
  const service = createTaskService({
    ...f.options,
    aiService: { requestJson: () => new Promise((resolve) => { releaseTopics = resolve; }) },
    technicalPlanStore: f.options.workspaceStore,
    rejectionCheckStore: { loadRejectionCheck: () => ({}) },
    duplicateCheckStore: { loadDuplicateCheck: () => ({}) },
  });
  let resolvePaused;
  const paused = new Promise((resolve) => { resolvePaused = resolve; });
  service.subscribe({ isDestroyed: () => false, once: () => {}, send: (_channel, event) => { if (event.task.type === 'content-generation' && event.task.status === 'paused') resolvePaused(); } });
  service.startContentGeneration({});
  try {
    assert.equal(f.state().projectUnderstandingTask.status, 'running');
    service.getActiveTasks();
    assert.equal(f.state().projectUnderstandingTask.status, 'running');
    assert.equal(f.state().projectUnderstandingTask.error, undefined);
  } finally {
    service.pauseContentGeneration();
    releaseTopics(['公共文化政策']);
    await paused;
  }
});

test('缺 Key 时不调用模型，明确失败原因并允许其他正文继续', async () => {
  const f = fixture();
  f.options.configStore = { load: () => ({ project_research: { provider: 'baidu' } }) };
  const prepared = await loadPreparation(async () => { assert.fail('不应联网'); })(f.options);
  assert.equal(prepared.paused, undefined);
  assert.equal(f.modelCalls(), 0);
  assert.match(f.state().projectUnderstandingTask.error, /未配置百度 AI 搜索 API Key/);
  assert.equal(f.state().outlineData.outline[0].children[1].content, '员工已编写的正文');
});

test('额度耗尽后不更换搜索源，并保留失败状态与旧正文', async () => {
  const f = fixture();
  let calls = 0;
  await loadPreparation(async () => { calls++; throw Object.assign(new Error('免费额度已用尽，不转付费'), { code: 'SEARCH_FREE_QUOTA_EXHAUSTED' }); })(f.options);
  assert.equal(calls, 1);
  assert.equal(f.state().projectUnderstandingTask.status, 'error');
  assert.match(f.state().projectUnderstandingTask.error, /免费额度/);
  assert.equal(f.state().outlineData.outline[0].children[1].content, '员工已编写的正文');
});

test('自动研究暂停后持久化原重新生成请求，恢复时保留操作意图', async () => {
  const f = fixture({ regenerate: true, requirement: '保持原有承诺' });
  let paused = false;
  f.options.taskControl.isPauseRequested = () => paused;
  const first = loadPreparation(async () => { paused = true; throw Object.assign(new Error('已取消'), { code: 'TASK_CANCELED' }); });
  assert.deepEqual(await first(f.options), { paused: true });
  assert.equal(f.state().contentGenerationRuntime.phase, 'researching');
  assert.equal(f.state().contentGenerationRuntime.research_request.regenerate, true);
  assert.equal(f.state().contentGenerationTask.status, 'paused');
  paused = false;
  const restored = await loadPreparation(async () => {} )({ ...f.options, payload: { resume: true }, previousState: f.state() });
  assert.equal(restored.payload.regenerate, true);
  assert.equal(restored.payload.requirement, '保持原有承诺');
  assert.equal(restored.payload.resume, undefined);
});

test('主题规划返回时已请求暂停，不再发起搜索', async () => {
  const f = fixture();
  let paused = false;
  f.options.taskControl.isPauseRequested = () => paused;
  f.options.aiService.requestJson = async () => { paused = true; return ['公共文化政策']; };
  const prepare = loadPreparation(async () => { assert.fail('暂停后不应搜索'); });
  assert.deepEqual(await prepare(f.options), { paused: true });
  assert.equal(f.state().contentGenerationTask.status, 'paused');
});
