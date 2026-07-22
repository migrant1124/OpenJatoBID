'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAndValidateOutline } = require('./outlineGenerationGuard.cjs');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
const { runOutlineGenerationTask } = require('./outlineGenerationTask.cjs');

test('目录生成保留招标文件规定的一级目录，并将全部节点默认设为 AI 编制', () => {
  const result = normalizeAndValidateOutline({
    outline: [{
      title: '技术方案',
      description: '技术方案的编制内容',
      source_requirement_id: 'R1',
      children: [{
        title: '实施方案',
        manual_input_required: true,
        response_mode: 'evidence-markdown',
        focus_scoring_point_ids: ['SP-1'],
        children: [{ title: '实施步骤' }],
      }],

  });

  const section = result.outline[0].children[0];
  assert.equal(result.outline[0].title, '技术方案');
  assert.equal(section.id, '1.1');
  assert.equal(section.description, '实施方案');
  assert.equal(section.manual_input_required, false);
  assert.equal(section.response_mode, undefined);
  assert.equal(section.source_requirement_id, undefined);
  assert.deepEqual(section.focus_scoring_point_ids, ['SP-1']);
});

test('目录生成不得改写招标文件规定的一级目录', () => {
  assert.throws(() => normalizeAndValidateOutline({
    outline: [{ title: '服务方案', description: '内容' }],
  }, {
    sourceOutline: { outline: [{ title: '技术方案' }] },
  }), /一级目录必须保持目录来源骨架/u);
});

test('目录生成实际流程会清除模型返回的人工和旧责任字段', async () => {
  const tasks = getBidAnalysisTasks('key');
  const taskContent = (task) => {
    if (task.id === 'responseFileRequirements') return '【技术文件目录状态】：明确\n\n# 技术方案\n## 实施方案';
    if (task.id === 'procurementList') return JSON.stringify({
      schema_version: 1,
      extraction_status: { procurement_items: 'not_found', quotation_rules: 'not_found' },
      procurement_items: [],
      quotation_rules: {
        pricing_method: [], price_limits: [], tax_and_invoice: [], cost_scope: [], calculation_and_rounding: [],
        quote_documents_and_attachments: [], submission_method_or_platform: [], consistency_and_priority: [],
        invalid_or_abnormal_price: [], settlement_and_payment: [], other_explicit_rules: [],
      },
    });
    if (task.id === 'projectInfo') return JSON.stringify({ project_name: '项目', project_number: '编号', project_type: '类型', project_budget: '预算', project_address: '地址' });
    if (task.id === 'partAInfo') return JSON.stringify({ company_name: '甲方', address: '地址', contact_person: '联系人', contact_phone: '电话' });
    if (task.id === 'deliveryAndServiceRequirements') return JSON.stringify({
      implementation_period: '周期', delivery_scope: '范围', delivery_location: '地点', acceptance_requirements: '验收',
      warranty_period: '质保', after_sales_service: '售后', response_time: '时限', training_requirements: '培训', documentation_requirements: '资料',
    });
    return '解析结果';
  };
  let state = {
    workflowKind: 'technical-plan',
    projectOverview: '项目概述',
    techRequirements: '技术评分要求',
    bidAnalysisTasks: Object.fromEntries(tasks.map((task) => [task.id, {
      id: task.id,
      label: task.label,
      status: 'success',
      content: taskContent(task),
    }])),
    requirementResponseMatrix: undefined,
    referenceKnowledgeDocumentIds: [],
  };
  const responses = {
    格式目录骨架: {
      outline: [{
        id: '1',
        title: '技术方案',
        description: '技术方案说明',
        children: [{ id: '1.1', title: '实施方案', description: '实施方案说明', manual_input_required: true }],
      }],
    },
    技术评分大类: { groups: [{ requirement_id: 'R1', title: '实施方案', description: '实施方案评分要求', detail_points: ['实施内容'] }] },
    目录下级补充: {
      outline: [{
        id: '1',
        title: '技术方案',
        description: '技术方案说明',
        source_requirement_id: 'R1',
        children: [{
          id: '1.1',
          title: '实施方案',
          description: '实施方案说明',
          manual_input_required: true,
          deep_writing: true,
          response_mode: 'evidence-markdown',
        }],
      }],
    },
  };
  const aiService = {
    getConfig: () => ({}),
    collectJsonResponse: async (options) => {
      const value = structuredClone(responses[options.progressLabel]);
      if (!value) throw new Error(`unexpected request: ${options.progressLabel}`);
      const normalized = options.normalizer ? options.normalizer(value) : value;
      options.validator?.(normalized);
      return normalized;
    },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => structuredClone(state),
    updateTechnicalPlan(partial) {
      state = { ...state, ...structuredClone(partial) };
      return structuredClone(state);
    },
  };

  await runOutlineGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    updateTask: () => undefined,
    payload: { reference_knowledge_document_ids: [] },
  });

  const generated = state.outlineData.outline[0].children[0];
  assert.equal(generated.manual_input_required, undefined);
  assert.equal(generated.source_requirement_id, undefined);
  assert.equal(generated.deep_writing, undefined);
  assert.equal(generated.response_mode, undefined);
});

test('forced Agent takes over when source-driven child generation loses network', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：明确\n\n# 技术文件\n\n## 固定承诺');
  const calls = [];
  const aiService = createAi({
    格式目录骨架: { outline: [{
      id: '1',
      title: '技术文件',
      description: '固定一级目录',
      children: [{ id: '1.1', title: '固定承诺', description: '人工填写', manual_input_required: true }],
    }] },
    技术评分大类: groupsResponse,
  }, calls);
  aiService.collectJsonResponse = async (options) => {
    calls.push(options.progressLabel);
    if (options.progressLabel === '目录下级补充') {
      assert.equal(options.max_retries, 0);
      throw new Error('文本模型服务连接失败（jlaudeapi.com，ECONNREFUSED）。请检查网络或代理状态以及 Base URL，恢复后重试。');
    }
    const raw = {
      格式目录骨架: { outline: [{
        id: '1',
        title: '技术文件',
        description: '固定一级目录',
        children: [{ id: '1.1', title: '固定承诺', description: '人工填写', manual_input_required: true }],
      }] },
      技术评分大类: groupsResponse,
    }[options.progressLabel];
    const value = options.normalizer ? options.normalizer(structuredClone(raw)) : structuredClone(raw);
    if (options.validator) options.validator(value);
    return value;
  };
  aiService.requestJson = async (options) => aiService.collectJsonResponse(options);

  let agentCalls = 0;
  const agentService = {
    runTask: async (options) => {
      agentCalls += 1;
      assert.equal(options.max_retries, 3);
      assert.match(options.prompt, /目录来源约束模式/u);
      assert.match(options.prompt, /不得修改或输出 groups/u);
      assert.doesNotMatch(options.prompt, /最终一级目录和 groups/u);
      assert.ok(options.files.some((item) => item.path === 'source-outline.json'));
      const result = {
        output_content: JSON.stringify({
          outline: [{
            id: '1',
            title: '技术文件',
            description: '固定一级目录',
            manual_input_required: true,
            children: [
              {
                id: '1.1',
                title: '固定承诺',
                description: '人工填写',
                manual_input_required: true,
                children: [{ id: '1.1.1', title: '模型误加内容', description: '应删除' }],
              },
              {
                id: '1.2',
                title: '服务实施方案',
                description: '响应服务实施评分要求',
                source_requirement_id: 'R1',
              },
            ],
          }],
        }),
      };
      options.validateOutput(result);
      return result;
    },
  };

  await runOutlineGenerationTask({
    aiService,
    agentService,
    workspaceStore,
    knowledgeBaseService: {},
    updateTask: createUpdateTask(),
    payload: { reference_knowledge_document_ids: [], debug_force_outline_agent_repair: true },
  });

  assert.deepEqual(calls, ['格式目录骨架', '技术评分大类', '目录下级补充']);
  assert.equal(agentCalls, 1);
  assert.equal(workspaceStore.getState().outlineGenerationTask.status, 'success');
  assert.equal(workspaceStore.getState().outlineData.outline[0].manual_input_required, undefined);
  assert.equal(workspaceStore.getState().outlineData.outline[0].children[0].manual_input_required, true);
  assert.equal(workspaceStore.getState().outlineData.outline[0].children[0].children, undefined);
  assert.equal(workspaceStore.getState().outlineData.outline[0].children[1].source_requirement_id, 'R1');
  assert.ok(workspaceStore.getState().outlineGenerationTask.logs.some((item) => item.includes('切换到 Agent')));
});

test('forced Agent still runs after ordinary source-driven generation succeeds', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：明确\n\n# 技术文件');
  const calls = [];
  const ordinaryOutline = {
    outline: [{
      id: '1', title: '技术文件', description: '固定一级目录',
      children: [{ id: '1.1', title: '服务实施方案', description: '响应服务实施评分要求', source_requirement_id: 'R1' }],
    }],
  };
  const aiService = createAi({
    格式目录骨架: { outline: [{ id: '1', title: '技术文件', description: '固定一级目录' }] },
    技术评分大类: groupsResponse,
    目录下级补充: ordinaryOutline,
  }, calls);
  let agentCalls = 0;
  const agentService = {
    runTask: async (options) => {
      agentCalls += 1;
      assert.equal(options.max_retries, 3);
      assert.match(options.prompt, /每个评分项节点必须输出 source_requirement_id/u);
      const result = {
        output_content: JSON.stringify({
          outline: [{
            id: '1',
            title: '技术文件',
            description: '固定一级目录',
            children: [{ id: '1.1', title: '服务实施方案', description: 'Agent 误删了评分映射字段' }],
          }],
        }),
      };
      options.validateOutput(result);
      return result;
    },
  };

  await runOutlineGenerationTask({
    aiService, agentService, workspaceStore, knowledgeBaseService: {}, updateTask: createUpdateTask(),
    payload: { reference_knowledge_document_ids: [], debug_force_outline_agent_repair: true },
  });

  assert.equal(agentCalls, 1);
  assert.equal(workspaceStore.getState().outlineGenerationTask.status, 'success');
  assert.equal(workspaceStore.getState().outlineData.outline[0].children[0].source_requirement_id, 'R1');
  assert.ok(workspaceStore.getState().outlineGenerationTask.logs.some((item) => item.includes('强制切换到 Agent')));
});

test('source-driven network failure does not invoke Agent unless forced', async () => {
  const workspaceStore = createWorkspace('【技术文件目录状态】：明确\n\n# 技术文件');
  const calls = [];
  const aiService = createAi({
    格式目录骨架: { outline: [{ id: '1', title: '技术文件', description: '固定一级目录' }] },
    技术评分大类: groupsResponse,
  }, calls);
  aiService.collectJsonResponse = async (options) => {
    calls.push(options.progressLabel);
    if (options.progressLabel === '目录下级补充') {
      throw new Error('文本模型服务连接失败（jlaudeapi.com，ECONNREFUSED）。请检查网络或代理状态以及 Base URL，恢复后重试。');
    }
    const raw = {
      格式目录骨架: { outline: [{ id: '1', title: '技术文件', description: '固定一级目录' }] },
      技术评分大类: groupsResponse,
    }[options.progressLabel];
    const value = options.normalizer ? options.normalizer(structuredClone(raw)) : structuredClone(raw);
    if (options.validator) options.validator(value);
    return value;
  };
  aiService.requestJson = async (options) => aiService.collectJsonResponse(options);
  let agentCalls = 0;

  await assert.rejects(
    runOutlineGenerationTask({
      aiService,
      agentService: { runTask: async () => { agentCalls += 1; } },
      workspaceStore,
      knowledgeBaseService: {},
      updateTask: createUpdateTask(),
      payload: { reference_knowledge_document_ids: [] },
    }),
    /文本模型服务连接失败/u,
  );
  assert.equal(agentCalls, 0);
});
