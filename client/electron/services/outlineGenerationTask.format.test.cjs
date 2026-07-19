const test = require('node:test');
const assert = require('node:assert/strict');

const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
const { runOutlineGenerationTask } = require('./outlineGenerationTask.cjs');

function successState(task, content) {
  return { id: task.id, label: task.label, status: 'success', content: content ?? (task.output === 'json' ? '{}' : `${task.label}结果`) };
}

function createState(formatContent) {
  const required = getBidAnalysisTasks('key');
  return {
    workflowKind: 'technical-plan',
    projectOverview: '脱敏项目概述',
    techRequirements: '## 技术评分项\n服务实施方案，10分。',
    bidAnalysisTasks: Object.fromEntries(required.map((task) => [task.id, successState(
      task,
      task.id === 'responseFileRequirements' ? formatContent : undefined,
    )])),
    requirementResponseMatrix: {
      revision: 'format-test',
      scoring_points: [{
        scoring_point_id: 'R1.P1',
        group_requirement_id: 'R1',
        title: '服务实施方案',
        requirement_text: '响应服务实施评分要求',
        scoring_rule: '完整响应得分',
        source_refs: [],
        mandatory_level: 'normal',
        expected_response_types: ['content'],
        high_score_conditions: ['人员和流程'],
        mapped_node_ids: [],
        status: 'unmapped',
      }],
      rejection_risks: [],
      hidden_requirements: [],
      value_anchors: [],
    },
    referenceKnowledgeDocumentIds: [],
    tenderFile: null,
  };
}

function createWorkspace(formatContent) {
  let state = createState(formatContent);
  return {
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    getState: () => state,
  };
}

function createUpdateTask() {
  let background = {};
  return (partial) => {
    background = { ...background, ...partial };
    return background;
  };
}

function createAi(responses, calls) {
  const aiService = {
    collectJsonResponse: async (options) => {
      calls.push(options.progressLabel);
      const raw = responses[options.progressLabel];
      if (!raw) throw new Error(`unexpected AI request: ${options.progressLabel || 'unknown'}`);
      const value = options.normalizer ? options.normalizer(structuredClone(raw)) : structuredClone(raw);
      if (options.validator) options.validator(value);
      return value;
    },
    requestJson: async (options) => aiService.collectJsonResponse(options),
    getConfig: () => ({}),
  };
  return aiService;
}

const groupsResponse = {
  groups: [{ requirement_id: 'R1', title: '服务实施方案', description: '响应服务实施评分要求', detail_points: ['人员', '流程'] }],
};

test('explicit format owns all top-level directories and scoring is mapped only below them', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：明确\n\n# 技术文件\n\n## 实施方案\n## 服务承诺函（固定格式）');
  const calls = [];
  const aiService = createAi({
    格式目录骨架: {
      outline: [{
        id: '1',
        title: '技术文件',
        description: '技术文件固定一级目录',
        children: [
          { id: '1.1', title: '实施方案', description: '编制实施方案' },
          { id: '1.2', title: '服务承诺函', description: '人工填写固定承诺函', manual_input_required: true },
        ],
      }],
    },
    技术评分大类: groupsResponse,
    目录下级补充: {
      outline: [{
        id: '1',
        title: '技术文件',
        description: '技术文件固定一级目录',
        children: [
          {
            id: '1.1',
            title: '实施方案',
            description: '编制实施方案',
            source_requirement_id: 'R1',
            mapped_scoring_point_ids: ['R1.P1'],
            children: [{ id: '1.1.1', title: '人员与流程', description: '覆盖评分细项' }],
          },
          { id: '1.2', title: '服务承诺函', description: '人工填写固定承诺函', manual_input_required: true },
        ],
      }],
    },
  }, calls);
  await runOutlineGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    updateTask: createUpdateTask(),
    payload: { reference_knowledge_document_ids: [] },
  });

  const state = workspaceStore.getState();
  assert.deepEqual(calls, ['格式目录骨架', '技术评分大类', '目录下级补充']);
  assert.deepEqual(state.outlineData.outline.map((item) => item.title), ['技术文件']);
  assert.equal(state.outlineData.outline[0].source_requirement_id, undefined);
  assert.equal(state.outlineData.outline[0].children[0].source_requirement_id, 'R1');
  assert.equal(state.outlineData.outline[0].children[1].manual_input_required, true);
  assert.equal(state.outlineGenerationTask.status, 'success');
});

test('unspecified format uses only selected knowledge document headings for top-level directories', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：未明确\n\n未找到明确技术文件目录格式。');
  const calls = [];
  const aiService = createAi({
    知识库目录骨架: {
      outline: [
        { id: '1', title: '项目理解', description: '参考文档一级目录' },
        { id: '2', title: '实施方案', description: '参考文档一级目录' },
      ],
    },
    技术评分大类: groupsResponse,
    目录下级补充: {
      outline: [
        {
          id: '1', title: '项目理解', description: '参考文档一级目录',
          children: [{ id: '1.1', title: '需求分析', description: '项目需求', children: [{ id: '1.1.1', title: '目标分析', description: '项目目标' }] }],
        },
        {
          id: '2', title: '实施方案', description: '参考文档一级目录',
          children: [{ id: '2.1', title: '服务实施', description: '评分响应', source_requirement_id: 'R1', mapped_scoring_point_ids: ['R1.P1'], children: [{ id: '2.1.1', title: '人员与流程', description: '覆盖评分细项' }] }],
        },
      ],
    },
  }, calls);
  const readIds = [];

  await runOutlineGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {
      readMarkdown: (documentId) => {
        readIds.push(documentId);
        return '# 项目理解\n## 需求分析\n# 实施方案';
      },
    },
    updateTask: createUpdateTask(),
    payload: { reference_knowledge_document_ids: ['kb-selected'] },
  });

  assert.deepEqual(readIds, ['kb-selected']);
  assert.deepEqual(calls, ['知识库目录骨架', '技术评分大类', '目录下级补充']);
  assert.deepEqual(workspaceStore.getState().outlineData.outline.map((item) => item.title), ['项目理解', '实施方案']);
});

test('multiple selected knowledge documents are combined in one source-outline request', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：未明确\n\n未找到明确技术文件目录格式。');
  const calls = [];
  const aiService = createAi({
    知识库目录骨架: {
      outline: [
        { id: '1', title: '项目理解', description: '文档一一级目录' },
        { id: '2', title: '质量保障', description: '文档二一级目录' },
      ],
    },
    技术评分大类: groupsResponse,
    目录下级补充: {
      outline: [
        { id: '1', title: '项目理解', description: '文档一一级目录', children: [{ id: '1.1', title: '需求分析', description: '需求', source_requirement_id: 'R1', mapped_scoring_point_ids: ['R1.P1'], children: [{ id: '1.1.1', title: '人员与流程', description: '覆盖评分项' }] }] },
        { id: '2', title: '质量保障', description: '文档二一级目录' },
      ],
    },
  }, calls);
  const readIds = [];

  await runOutlineGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {
      readMarkdown: (documentId) => {
        readIds.push(documentId);
        return documentId === 'kb-a' ? '# 项目理解\n## 需求分析' : '# 质量保障';
      },
    },
    updateTask: createUpdateTask(),
    payload: { reference_knowledge_document_ids: ['kb-a', 'kb-b'] },
  });

  assert.deepEqual(readIds, ['kb-a', 'kb-b']);
  assert.equal(calls.filter((label) => label === '知识库目录骨架').length, 1);
  assert.deepEqual(workspaceStore.getState().outlineData.outline.map((item) => item.title), ['项目理解', '质量保障']);
});

test('unspecified format without selected knowledge blocks before every directory AI request', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：未明确\n\n未找到明确技术文件目录格式。');
  let aiCalls = 0;
  await assert.rejects(
    () => runOutlineGenerationTask({
      aiService: {
        collectJsonResponse: async () => { aiCalls += 1; return {}; },
        requestJson: async () => { aiCalls += 1; return {}; },
        getConfig: () => ({}),
      },
      agentService: {},
      workspaceStore,
      knowledgeBaseService: {},
      updateTask: createUpdateTask(),
      payload: { reference_knowledge_document_ids: [] },
    }),
    /招标文件未规定明确目录格式，请至少选择一份参考知识库文档后生成目录。/u,
  );
  assert.equal(aiCalls, 0);
});

test('a scoring item returned as a top-level directory is rejected', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：明确\n\n# 技术文件');
  const calls = [];
  const aiService = createAi({
    格式目录骨架: { outline: [{ id: '1', title: '技术文件', description: '固定一级目录' }] },
    技术评分大类: groupsResponse,
    目录下级补充: {
      outline: [{
        id: '1',
        title: '技术文件',
        description: '固定一级目录',
        source_requirement_id: 'R1',
        children: [{ id: '1.1', title: '实施', description: '实施', children: [{ id: '1.1.1', title: '人员', description: '人员' }] }],
      }],
    },
  }, calls);

  await assert.rejects(
    () => runOutlineGenerationTask({
      aiService,
      agentService: {},
      workspaceStore,
      knowledgeBaseService: {},
      updateTask: createUpdateTask(),
      payload: { reference_knowledge_document_ids: [] },
    }),
    /技术评分项不能创建或占用一级目录/u,
  );
});

test('existing-plan expansion keeps format-owned roots and uses the old plan only below them', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：明确\n\n# 技术文件');
  Object.assign(workspaceStore.getState(), {
    workflowKind: 'existing-plan-expansion',
    originalPlanFile: { fileName: '脱敏原方案.md' },
  });
  workspaceStore.readOriginalPlanMarkdown = () => '# 旧方案自定义一级目录\n## 旧实施内容';
  const calls = [];
  const aiService = createAi({
    旧方案目录提取: { outline: [{ id: '1', title: '旧方案自定义一级目录', description: '旧目录' }] },
    格式目录骨架: { outline: [{ id: '1', title: '技术文件', description: '格式一级目录' }] },
    技术评分大类: groupsResponse,
    目录下级补充: {
      outline: [{
        id: '1',
        title: '技术文件',
        description: '格式一级目录',
        children: [{ id: '1.1', title: '旧实施内容', description: '原方案下级补充', source_requirement_id: 'R1', mapped_scoring_point_ids: ['R1.P1'], children: [{ id: '1.1.1', title: '人员与流程', description: '覆盖评分项' }] }],
      }],
    },
  }, calls);
  aiService.getConfig = () => ({
    agent_mode_scenarios: { existing_plan_expansion_original_outline_extraction: false },
  });

  await runOutlineGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    updateTask: createUpdateTask(),
    payload: { reference_knowledge_document_ids: [], outline_expansion_mode: 'ai-complement' },
  });

  assert.deepEqual(workspaceStore.getState().outlineData.outline.map((item) => item.title), ['技术文件']);
  assert.equal(workspaceStore.getState().outlineData.outline[0].children[0].title, '旧实施内容');
  assert.ok(calls.includes('旧方案目录提取'));
});
