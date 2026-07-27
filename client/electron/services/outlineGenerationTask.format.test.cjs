'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAndValidateOutline } = require('./outlineGenerationGuard.cjs');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
const { runOutlineGenerationTask, validateSourceDrivenOutline, __knowledgePatchRuntime } = require('./outlineGenerationTask.cjs');

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
    }],
  }, {
    sourceOutline: { outline: [{ title: '技术方案' }] },
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

test('目录生成拒绝同一二级目录下六个模型新增的并列三级叶子', async () => {
  const tasks = getBidAnalysisTasks('key');
  const taskContent = (task) => {
    if (task.id === 'responseFileRequirements') return '【技术文件目录状态】：明确\n\n# 技术方案\n## 服务方案';
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
  const sourceOutline = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案说明',
      children: [{ id: '1.1', title: '服务方案', description: '服务方案说明' }],
    }],
  };
  const responses = {
    格式目录骨架: sourceOutline,
    技术评分大类: { groups: [{ requirement_id: 'R1', title: '服务方案', description: '服务方案评分要求', detail_points: ['实施内容'] }] },
    目录下级补充: {
      outline: [{
        id: '1', title: '技术方案', description: '技术方案说明',
        children: [{
          id: '1.1', title: '服务方案', description: '服务方案说明', service_plan_section: true,
          children: Array.from({ length: 6 }, (_item, index) => ({
            id: `1.1.${index + 1}`,
            title: `模型新增事项${index + 1}`,
            description: `模型新增事项${index + 1}说明`,
          })),
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

  await assert.rejects(
    runOutlineGenerationTask({
      aiService,
      agentService: {},
      workspaceStore,
      knowledgeBaseService: {},
      updateTask: () => undefined,
      payload: { reference_knowledge_document_ids: [] },
    }),
    /同一二级目录下模型新增的无子节点三级目录不能超过 5 个/u,
  );
});

test('重点章节允许以三级主题、四级分支和五级叶子补充目录', () => {
  const sourceOutline = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案说明',
      children: [{ id: '1.1', title: '服务方案', description: '服务方案说明' }],
    }],
  };
  const outline = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案说明',
      children: [{
        id: '1.1', title: '服务方案', description: '服务方案说明', service_plan_section: true,
        children: [{
          id: '1.1.1', title: '实施组织', description: '实施组织主题',
          children: [
            {
              id: '1.1.1.1', title: '人员配置', description: '人员配置分支',
              children: [
                { id: '1.1.1.1.1', title: '项目经理职责', description: '项目经理职责' },
                { id: '1.1.1.1.2', title: '专业人员分工', description: '专业人员分工' },
              ],
            },
            { id: '1.1.1.2', title: '资源配置', description: '资源配置分支' },
          ],
        }],
      }],
    }],
  };

  assert.doesNotThrow(() => validateSourceDrivenOutline(outline, sourceOutline, { enforceGrouping: true }));
});

test('知识库补目录保留人工和已有正文节点，并拒绝六个并列三级叶子', () => {
  const outline = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案说明', children: [{
        id: '1.1', title: '服务方案', description: '服务方案说明', service_plan_section: true, children: [
          { id: '1.1.1', title: '人工章节', description: '人工填写', manual_input_required: true },
          { id: '1.1.2', title: '已有正文', description: '已有正文', content: '用户已填写的内容' },
        ],
      }],
    }],
  };
  const sixLeaves = Array.from({ length: 6 }, (_item, index) => ({
    parent_id: '1.1', title: `知识库新增事项${index + 1}`, description: `知识库新增事项${index + 1}说明`,
  }));

  assert.throws(
    () => __knowledgePatchRuntime.applyKnowledgeAdditions(outline, { updates: [], additions: sixLeaves }),
    /同一二级目录下模型新增的无子节点三级目录不能超过 5 个/u,
  );
  const result = __knowledgePatchRuntime.applyKnowledgeAdditions(outline, {
    updates: [
      { id: '1.1.1', title: '不应修改人工章节' },
      { id: '1.1.2', title: '不应修改已有正文' },
    ],
    additions: [],
  });
  assert.equal(result.outline.outline[0].children[0].children[0].title, '人工章节');
  assert.equal(result.outline.outline[0].children[0].children[1].title, '已有正文');
});

test('非重点章节拒绝模型新增五级目录', () => {
  const sourceOutline = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案说明',
      children: [{ id: '1.1', title: '项目管理', description: '项目管理说明' }],
    }],
  };
  const outline = {
    outline: [{
      id: '1', title: '技术方案', description: '技术方案说明',
      children: [{
        id: '1.1', title: '项目管理', description: '项目管理说明',
        children: [{
          id: '1.1.1', title: '管理机制', description: '管理机制主题',
          children: [{
            id: '1.1.1.1', title: '过程管理', description: '过程管理分支',
            children: [
              { id: '1.1.1.1.1', title: '过程策划', description: '过程策划' },
              { id: '1.1.1.1.2', title: '过程检查', description: '过程检查' },
            ],
          }, {
            id: '1.1.1.2', title: '闭环管理', description: '闭环管理分支',
          }],
        }],
      }],
    }],
  };

  assert.throws(
    () => validateSourceDrivenOutline(outline, sourceOutline, { enforceGrouping: true }),
    /非重点章节不允许新增五级目录/u,
  );
});
