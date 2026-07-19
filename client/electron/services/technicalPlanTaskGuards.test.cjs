'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGuardedOutlineRunner,
  normalizeAndValidateOutline,
} = require('./outlineGenerationGuard.cjs');
const { createGuardedContentRunner } = require('./contentGenerationGuard.cjs');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStore(initial) {
  let state = clone(initial);
  return {
    loadTechnicalPlan() {
      return clone(state);
    },
    updateTechnicalPlan(partial = {}) {
      state = { ...state, ...clone(partial) };
      return clone(state);
    },
    get state() {
      return clone(state);
    },
  };
}

function createUpdateTask(store, field) {
  let task = store.loadTechnicalPlan()[field] || { status: 'running', progress: 0, logs: [] };
  const events = [];
  const updateTask = (partial = {}, _workspaceState, eventPatch) => {
    task = { ...task, ...clone(partial) };
    store.updateTechnicalPlan({ [field]: task });
    events.push({ task: clone(task), eventPatch: clone(eventPatch) });
    return clone(task);
  };
  updateTask.events = events;
  return updateTask;
}

function sourceOutline() {
  return {
    outline: [{
      id: 'source-root',
      title: '技术方案',
      description: '技术方案',
      required_in_outline: true,
      title_locked: true,
      children: [{
        id: 'source-child',
        title: '实施组织',
        description: '实施组织',
        children: [{
          id: 'source-leaf',
          title: '组织职责',
          description: '组织职责',
        }],
      }],
    }],
  };
}

function requirementGroups() {
  return [{ requirement_id: 'R1', title: '实施组织评分', description: '组织职责', detail_points: ['职责清晰'] }];
}

function createOutlineAi(candidate, { reviewPassed = true } = {}) {
  return {
    async collectJsonResponse(options) {
      if (options.progressLabel === '格式目录骨架') {
        const raw = sourceOutline();
        return options.normalizer ? options.normalizer(raw) : raw;
      }
      if (options.progressLabel === '技术评分大类') {
        const raw = { groups: requirementGroups() };
        return options.normalizer ? options.normalizer(raw) : raw;
      }
      if (options.progressLabel === '目录下级补充') {
        const raw = candidate;
        return options.normalizer ? options.normalizer(raw) : raw;
      }
      if (options.progressLabel === '目录最终安全审核') {
        const raw = { passed: reviewPassed, suggestions: reviewPassed ? [] : ['评分映射错位'] };
        const normalized = options.normalizer ? options.normalizer(raw) : raw;
        options.validator?.(normalized);
        return normalized;
      }
      throw new Error(`unexpected label: ${options.progressLabel}`);
    },
  };
}

function stripOutlineExtras(payload) {
  function strip(items) {
    return (items || []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      ...(item.manual_input_required !== undefined ? { manual_input_required: item.manual_input_required } : {}),
      ...(item.children?.length ? { children: strip(item.children) } : {}),
    }));
  }
  return { outline: strip(payload?.outline || []) };
}

function createOutlineBaseRunner(candidate, { fail = false, oldOutline = null } = {}) {
  return async ({ aiService, workspaceStore, updateTask }) => {
    await aiService.collectJsonResponse({ progressLabel: '格式目录骨架', messages: [], normalizer: stripOutlineExtras });
    await aiService.collectJsonResponse({ progressLabel: '技术评分大类', messages: [], normalizer: (value) => value });
    const messages = [{
      role: 'user',
      content: `原方案目录（仅补充下级）：\n${JSON.stringify(oldOutline || { outline: [] })}\n\n参考知识库目录（仅补充下级）：\n未提供`,
    }];
    const outline = await aiService.collectJsonResponse({ progressLabel: '目录下级补充', messages, normalizer: (value) => value });
    workspaceStore.updateTechnicalPlan({
      outlineData: null,
      contentGenerationSections: {},
      contentGenerationPlans: {},
    });
    if (fail) throw new Error('generation failed');
    const stagedState = workspaceStore.updateTechnicalPlan({ outlineData: outline });
    updateTask({ status: 'success', progress: 100, logs: ['目录生成完成。'] }, stagedState);
  };
}

test('outline generation keeps previous data when the base runner fails after destructive writes', async () => {
  const baseline = {
    workflowKind: 'technical-plan',
    outlineData: { outline: [{ id: '1', title: '旧目录', description: '旧目录', content: '旧正文' }] },
    contentGenerationSections: { 1: { id: '1', status: 'success', content: '旧正文' } },
    contentGenerationPlans: { 1: { plan_version: 4, plan: {} } },
    outlineGenerationTask: { status: 'running', progress: 0, logs: [] },
  };
  const store = createStore(baseline);
  const updateTask = createUpdateTask(store, 'outlineGenerationTask');
  const wrapped = createGuardedOutlineRunner(createOutlineBaseRunner(sourceOutline(), { fail: true }));

  await assert.rejects(() => wrapped({
    aiService: createOutlineAi(sourceOutline()),
    agentService: {},
    workspaceStore: store,
    updateTask,
    payload: {},
  }), /generation failed/);

  assert.deepEqual(store.state.outlineData, baseline.outlineData);
  assert.deepEqual(store.state.contentGenerationSections, baseline.contentGenerationSections);
  assert.deepEqual(store.state.contentGenerationPlans, baseline.contentGenerationPlans);
});

test('outline generation commits deterministic IDs and preserves source constraints after final review', async () => {
  const candidate = {
    outline: [{
      id: '',
      title: '技术方案',
      description: '',
      children: [{
        id: 'duplicate',
        title: '实施组织',
        description: '',
        children: [{
          id: 'duplicate',
          title: '组织职责',
          description: '',
          source_requirement_id: 'R1',
        }],
      }],
    }],
  };
  const store = createStore({
    workflowKind: 'technical-plan',
    outlineData: { outline: [{ id: '1', title: '旧目录', description: '旧目录' }] },
    contentGenerationSections: {},
    contentGenerationPlans: {},
    outlineGenerationTask: { status: 'running', progress: 0, logs: [] },
  });
  const updateTask = createUpdateTask(store, 'outlineGenerationTask');
  const wrapped = createGuardedOutlineRunner(createOutlineBaseRunner(candidate));

  await wrapped({
    aiService: createOutlineAi(candidate),
    agentService: {},
    workspaceStore: store,
    updateTask,
    payload: {},
  });

  const root = store.state.outlineData.outline[0];
  assert.equal(root.id, '1');
  assert.equal(root.required_in_outline, true);
  assert.equal(root.title_locked, true);
  assert.equal(root.children[0].id, '1.1');
  assert.equal(root.children[0].children[0].id, '1.1.1');
  assert.equal(root.children[0].children[0].source_requirement_title, '实施组织评分');
  assert.equal(store.state.outlineGenerationTask.status, 'success');
});

test('original-only mode rejects invented lower-level titles and leaves old outline untouched', async () => {
  const candidate = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案', children: [
        {
          id: '1.1', title: '实施组织', description: '实施组织', children: [{
            id: '1.1.1', title: '组织职责', description: '组织职责', source_requirement_id: 'R1',
          }],
        },
        {
          id: '1.2', title: 'AI虚构目录', description: 'AI虚构目录', children: [{
            id: '1.2.1', title: '虚构细项', description: '虚构细项',
          }],
        },
      ],
    }],
  };
  const oldOutline = { outline: [{ id: '1', title: '原方案根', description: '原方案根', children: [{ id: '1.1', title: '实施组织', description: '实施组织', children: [{ id: '1.1.1', title: '组织职责', description: '组织职责' }] }] }] };
  const baselineOutline = { outline: [{ id: '1', title: '旧目录', description: '旧目录' }] };
  const store = createStore({
    workflowKind: 'existing-plan-expansion',
    outlineData: baselineOutline,
    contentGenerationSections: {},
    contentGenerationPlans: {},
    outlineGenerationTask: { status: 'running', progress: 0, logs: [] },
  });
  const updateTask = createUpdateTask(store, 'outlineGenerationTask');
  const wrapped = createGuardedOutlineRunner(createOutlineBaseRunner(candidate, { oldOutline }));

  await assert.rejects(() => wrapped({
    aiService: createOutlineAi(candidate),
    agentService: {},
    workspaceStore: store,
    updateTask,
    payload: { outline_expansion_mode: 'original-only' },
  }), /不允许新增/);
  assert.deepEqual(store.state.outlineData, baselineOutline);
});

test('strict outline validation rejects unknown requirement IDs', () => {
  assert.throws(() => normalizeAndValidateOutline({
    outline: [{ title: '技术方案', description: '技术方案', children: [{ title: '实施组织', description: '实施组织', children: [{ title: '组织职责', description: '组织职责', source_requirement_id: 'R999' }] }] }],
  }, {
    sourceOutline: sourceOutline(),
    groups: requirementGroups(),
    outlineExpansionMode: 'ai-complement',
  }), /未知技术评分项/);
});

function contentOutline(contentA = '', contentB = '') {
  return {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案', children: [{
        id: '1.1', title: '实施组织', description: '实施组织', children: [
          { id: '1.1.1', title: '组织职责', description: '组织职责', content: contentA },
          { id: '1.1.2', title: '人员安排', description: '人员安排', content: contentB },
        ],
      }],
    }],
  };
}

function createContentBaseRunner({ planningFailure = false, throwAfterClear = false, runExpansion = false, restoreResult = null } = {}) {
  return async ({ aiService, workspaceStore, updateTask }) => {
    if (planningFailure) {
      try {
        await aiService.collectJsonResponse({
          progressLabel: '正文编排决策',
          messages: [{ role: 'user', content: '章节ID: 1.1.1\n章节标题: 组织职责' }],
        });
      } catch {}
    }
    if (runExpansion) {
      const result = await aiService.collectJsonResponse({ progressLabel: '最低字数补目录', messages: [] });
      assert.deepEqual(result.additions.map((item) => item.parent_id), ['1.1.2']);
    }
    if (restoreResult) {
      await aiService.collectJsonResponse({
        progressLabel: '原方案还原',
        messages: [{ role: 'user', content: restoreResult.sources }],
      });
    }
    workspaceStore.updateTechnicalPlan({
      outlineData: contentOutline('', '新正文B'),
      contentGenerationSections: {
        '1.1.1': { id: '1.1.1', title: '组织职责', status: 'success', content: '无约束新正文' },
        '1.1.2': { id: '1.1.2', title: '人员安排', status: 'success', content: '新正文B' },
      },
      contentGenerationPlans: restoreResult ? {
        '1.1.1': { plan_version: 4, plan: { original_material: { source_ids: restoreResult.assigned } } },
      } : {},
    });
    if (throwAfterClear) throw new Error('content crashed');
    const state = workspaceStore.loadTechnicalPlan();
    updateTask({ status: 'success', progress: 100, logs: ['正文生成完成。'], stats: { content: {} } }, state);
  };
}

function createContentAi({ planningFailure = false, runExpansion = false, restoreResult = null } = {}) {
  return {
    async collectJsonResponse(options) {
      if (options.progressLabel === '正文编排决策' && planningFailure) throw new Error('plan invalid');
      if (options.progressLabel === '最低字数补目录' && runExpansion) {
        return { additions: [
          { parent_id: '1.1.1', title: '受保护子目录', description: '受保护子目录' },
          { parent_id: '1.1.2', title: '可新增子目录', description: '可新增子目录' },
        ] };
      }
      if (options.progressLabel === '原方案还原' && restoreResult) return { assignments: [{ node_id: '1.1.1', source_ids: restoreResult.assigned }] };
      return {};
    },
  };
}

test('content full regeneration restores the previous version after a thrown failure', async () => {
  const baseline = {
    workflowKind: 'technical-plan',
    outlineData: contentOutline('旧正文A', '旧正文B'),
    contentGenerationSections: {
      '1.1.1': { id: '1.1.1', title: '组织职责', status: 'success', content: '旧正文A' },
      '1.1.2': { id: '1.1.2', title: '人员安排', status: 'success', content: '旧正文B' },
    },
    contentGenerationPlans: { old: { plan_version: 4, plan: {} } },
    contentGenerationTask: { status: 'running', progress: 0, logs: [] },
  };
  const store = createStore(baseline);
  const updateTask = createUpdateTask(store, 'contentGenerationTask');
  const wrapped = createGuardedContentRunner(createContentBaseRunner({ throwAfterClear: true }));
  await assert.rejects(() => wrapped({
    aiService: createContentAi(), agentService: {}, workspaceStore: store, updateTask,
    payload: { regenerate: true }, previousState: baseline,
  }), /content crashed/);
  assert.deepEqual(store.state.outlineData, baseline.outlineData);
  assert.deepEqual(store.state.contentGenerationSections, baseline.contentGenerationSections);
});

test('content planning failure cannot silently persist unconstrained generated text', async () => {
  const baseline = {
    workflowKind: 'technical-plan',
    outlineData: contentOutline('人工修订正文', ''),
    contentGenerationSections: {
      '1.1.1': { id: '1.1.1', title: '组织职责', status: 'success', content: '人工修订正文' },
    },
    contentGenerationPlans: {},
    contentGenerationTask: { status: 'running', progress: 0, logs: [] },
  };
  const store = createStore(baseline);
  const updateTask = createUpdateTask(store, 'contentGenerationTask');
  const wrapped = createGuardedContentRunner(createContentBaseRunner({ planningFailure: true }));
  await wrapped({
    aiService: createContentAi({ planningFailure: true }), agentService: {}, workspaceStore: store, updateTask,
    payload: {}, previousState: baseline,
  });
  assert.equal(store.state.contentGenerationTask.status, 'error');
  assert.equal(store.state.contentGenerationSections['1.1.1'].content, '人工修订正文');
  assert.match(store.state.contentGenerationSections['1.1.1'].error, /阻止无约束正文落库/);
});

test('minimum-word outline expansion cannot add children under nodes that already contain content', async () => {
  const baseline = {
    workflowKind: 'technical-plan',
    outlineData: contentOutline('已有正文A', ''),
    contentGenerationSections: {
      '1.1.1': { id: '1.1.1', title: '组织职责', status: 'success', content: '已有正文A' },
    },
    contentGenerationPlans: {},
    contentGenerationTask: { status: 'running', progress: 0, logs: [] },
  };
  const store = createStore(baseline);
  const updateTask = createUpdateTask(store, 'contentGenerationTask');
  const wrapped = createGuardedContentRunner(createContentBaseRunner({ runExpansion: true }));
  await wrapped({
    aiService: createContentAi({ runExpansion: true }), agentService: {}, workspaceStore: store, updateTask,
    payload: {}, previousState: baseline,
  });
  assert.deepEqual(store.state.contentGenerationTask.stats.content.blocked_outline_expansion_parent_ids, ['1.1.1']);
  assert.equal(store.state.contentGenerationTask.status, 'success');
});

test('existing-plan generation fails the safety gate when a substantive source segment remains unassigned', async () => {
  const restoreResult = {
    assigned: ['P001'],
    sources: `<source id="P001">\n标题路径：第一章\n字符数：120\n原文：\n这是第一段具有充分实质内容的技术路线和实施安排，包含人员职责、进度计划、验收方法和风险措施。\n</source>\n\n<source id="P002">\n标题路径：第二章\n字符数：140\n原文：\n这是第二段具有充分实质内容的设备参数、服务承诺、售后安排、响应时间和质量控制要求。\n</source>`,
  };
  const baseline = {
    workflowKind: 'existing-plan-expansion',
    outlineData: contentOutline('', ''),
    contentGenerationSections: {},
    contentGenerationPlans: {},
    contentGenerationTask: { status: 'running', progress: 0, logs: [] },
    contentGenerationOptions: {},
  };
  const store = createStore(baseline);
  const updateTask = createUpdateTask(store, 'contentGenerationTask');
  const wrapped = createGuardedContentRunner(createContentBaseRunner({ restoreResult }));
  await wrapped({
    aiService: createContentAi({ restoreResult }), agentService: {}, workspaceStore: store, updateTask,
    payload: {}, previousState: baseline,
  });
  assert.equal(store.state.contentGenerationTask.status, 'error');
  assert.deepEqual(store.state.contentGenerationTask.stats.content.original_restore_unassigned_source_ids, ['P002']);
  assert.match(store.state.contentGenerationTask.error, /P002/);
});

test('outline semantic review invokes one bounded Agent repair before commit', async () => {
  const candidate = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案', children: [{
        id: '1.1', title: '实施组织', description: '实施组织', children: [{
          id: '1.1.1', title: '组织职责', description: '组织职责', source_requirement_id: 'R1',
        }],
      }],
    }],
  };
  let reviewCount = 0;
  const aiService = createOutlineAi(candidate);
  const originalCollect = aiService.collectJsonResponse.bind(aiService);
  aiService.collectJsonResponse = async (options) => {
    if (options.progressLabel === '目录最终安全审核') {
      reviewCount += 1;
      const raw = reviewCount === 1
        ? { passed: false, suggestions: ['需要修复'] }
        : { passed: true, suggestions: [] };
      const normalized = options.normalizer ? options.normalizer(raw) : raw;
      options.validator?.(normalized);
      return normalized;
    }
    return originalCollect(options);
  };
  let agentCalls = 0;
  const agentService = {
    async runTask() {
      agentCalls += 1;
      return { output_content: JSON.stringify(candidate) };
    },
  };
  const store = createStore({
    workflowKind: 'technical-plan',
    outlineData: { outline: [{ id: '1', title: '旧目录', description: '旧目录' }] },
    contentGenerationSections: {},
    contentGenerationPlans: {},
    outlineGenerationTask: { status: 'running', progress: 0, logs: [] },
  });
  const updateTask = createUpdateTask(store, 'outlineGenerationTask');
  const wrapped = createGuardedOutlineRunner(createOutlineBaseRunner(candidate));
  await wrapped({ aiService, agentService, workspaceStore: store, updateTask, payload: {} });
  assert.equal(agentCalls, 1);
  assert.equal(reviewCount, 2);
  assert.equal(store.state.outlineGenerationTask.status, 'success');
});
