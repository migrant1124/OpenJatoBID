const test = require('node:test');
const assert = require('node:assert/strict');

const { runOutlineGenerationTask } = require('./outlineGenerationTask.cjs');

function successJson(id, label, content = '{}') {
  return { id, label, status: 'success', content };
}

test('explicit technical format owns the top-level skeleton and scoring items stay inside allowed nodes', async () => {
  const formatResult = {
    schema_version: 1,
    has_explicit_technical_format: true,
    profiles: [{
      profile_id: 'profile-1',
      applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
      format_strength: 'fixed-roots',
      document_title: '固定技术文件',
      outline: [{
        format_node_id: 'format-root-1',
        source_number: '一、',
        source_title: '技术方案',
        description: '在固定根节点内响应技术评分要求',
        required_in_outline: true,
        response_required: true,
        title_locked: true,
        order_locked: true,
        level_locked: true,
        numbering_policy: 'preserve-source',
        response_mode: 'container',
        allow_ai_children: true,
        children: [],
      }],
    }],
    template_ids: [],
    other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: [] },
    sources: [],
  };
  let state = {
    workflowKind: 'technical-plan',
    projectOverview: '测试项目',
    techRequirements: '服务实施方案，10分。',
    bidAnalysisTasks: {
      projectOverview: successJson('projectOverview', '项目概述', '测试项目'),
      techRequirements: successJson('techRequirements', '技术评分要求', '服务实施方案，10分。'),
      bidDocumentFormatRequirements: {
        ...successJson('bidDocumentFormatRequirements', '格式要求', JSON.stringify(formatResult)),
        normalized_hash: 'format-hash-1',
      },
      procurementList: successJson('procurementList', '采购与报价', '采购清单与报价规则'),
      quotationRequirements: successJson('quotationRequirements', '报价要求', JSON.stringify({
        schema_version: 1,
        has_explicit_quotation_requirements: false,
        profiles: [{
          profile_id: 'quotation-profile-test',
          applicable_scope: { package_ids: [], package_names: [], document_type: 'quotation' },
          quote_mode: 'not-specified',
          currency: 'CNY',
          limits: [],
          tax: { pricing_basis: 'not-specified', vat_rates: [], invoice_types: [], rules: [] },
          price_composition: [],
          precision_and_rounding: { rules: [] },
          formulas: [],
          required_forms: [],
          submission_rules: [],
          consistency_rules: [],
          precedence_rules: [],
          prohibited_pricing_statements: [],
          invalid_bid_triggers: [],
          abnormally_low_price_review: [],
          settlement_and_payment: [],
          external_dependencies: [],
          sources: [],
        }],
        sources: [],
      })),
      projectInfo: successJson('projectInfo', '项目信息'),
      partAInfo: successJson('partAInfo', '甲方信息'),
      deliveryAndServiceRequirements: successJson('deliveryAndServiceRequirements', '交货和服务要求'),
    },
    referenceKnowledgeDocumentIds: [],
    tenderFile: null,
  };
  const workspaceStore = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
  };
  let background = {};
  const updateTask = (partial) => {
    background = { ...background, ...partial };
    return background;
  };
  const aiService = {
    collectJsonResponse: async (options) => {
      let raw;
      if (options.progressLabel === '技术评分大类') {
        raw = { groups: [{ requirement_id: 'score-1', title: '服务实施方案', description: '完整响应服务实施评分要求', detail_points: ['人员', '流程'] }] };
      } else if (String(options.progressLabel || '').startsWith('章节 ')) {
        raw = { children: [{
          id: '1.1',
          title: '人员组织',
          description: '人员配置与职责',
          children: [{ id: '1.1.1', title: '岗位职责', description: '岗位职责说明' }],
        }] };
      } else if (options.progressLabel === '评分项格式映射') {
        raw = { mappings: [{ requirement_id: 'score-1', target_format_node_id: 'format-root-1' }] };
      } else {
        throw new Error(`unexpected AI request: ${options.progressLabel || 'unknown'}`);
      }
      const normalized = options.normalizer ? options.normalizer(raw) : raw;
      if (options.validator) options.validator(normalized);
      return normalized;
    },
    requestJson: async (options) => aiService.collectJsonResponse(options),
    getConfig: () => ({}),
  };

  await runOutlineGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: { getOutlineReferences: () => ({ items: [] }) },
    updateTask,
    payload: { reference_knowledge_document_ids: [] },
  });

  assert.equal(state.selectedFormatProfileId, 'profile-1');
  assert.equal(state.selectedFormatProfileHash, 'format-hash-1');
  assert.equal(state.outlineData.outline.length, 1);
  assert.equal(state.outlineData.outline[0].format_node_id, 'format-root-1');
  assert.equal(state.outlineData.outline[0].title, '技术方案');
  assert.equal(state.outlineData.outline[0].children[0].title, '服务实施方案');
  assert.deepEqual(state.outlineData.outline[0].children[0].mapped_requirement_ids, ['score-1']);
  assert.equal(state.outlineGenerationTask.status, 'success');
});
