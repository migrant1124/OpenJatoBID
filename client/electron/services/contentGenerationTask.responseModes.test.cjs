const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runContentGenerationTask,
  __developerContentExpansionPatchRuntime,
} = require('./contentGenerationTask.cjs');
const {
  confirmTemplate,
  renderLockedCommitment,
  renderFixedMarkdownTable,
} = require('./fixedMarkdownTemplateService.cjs');

function findNode(items, id) {
  for (const item of items || []) {
    if (item.id === id) return item;
    const found = findNode(item.children, id);
    if (found) return found;
  }
  return null;
}

test('content task routes explicit-none and missing evidence deterministically while protected templates bypass AI', async () => {
  let state = {
    workflowKind: 'technical-plan',
    projectOverview: '测试项目',
    techRequirements: '测试要求',
    outlineData: {
      project_overview: '测试项目',
      outline: [{
        id: '1',
        title: '固定响应目录',
        description: '',
        response_mode: 'container',
        response_required: false,
        response_status: 'pending',
        compliance_risk: 'none',
        children: [
          { id: '1.1', title: '其他', description: '', response_mode: 'explicit-none', response_required: true, empty_response_text: '无。', response_status: 'pending', compliance_risk: 'none' },
          { id: '1.2', title: '业绩文件', description: '', response_mode: 'evidence-markdown', response_required: true, missing_evidence_risk: 'potential-rejection', response_status: 'pending', compliance_risk: 'none' },
          { id: '1.3', title: '承诺函', description: '', response_mode: 'locked-commitment', response_required: true, template_id: 'tpl-1', response_status: 'needs-manual-input', compliance_risk: 'none' },
          { id: '1.4', title: '偏差表', description: '', response_mode: 'fixed-markdown-table', response_required: true, template_id: 'tpl-2', response_status: 'needs-manual-input', compliance_risk: 'none' },
        ],
      }],
    },
    globalFacts: [{ id: 'facts', title: '项目事实', content: '项目名称：测试项目' }],
    globalFactsTask: { status: 'success' },
    referenceKnowledgeDocumentIds: [],
    contentGenerationSections: {},
    contentGenerationPlans: {},
    contentGenerationOptions: {
      useAiImages: false,
      useMermaidImages: false,
      useHtmlImages: false,
      minimumWords: 0,
      tableRequirement: 'none',
      enableConsistencyAudit: false,
      enableOriginalPlanCoverageAudit: false,
    },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    clearMermaidCache() {},
    clearIllustrationFiles() {},
  };
  let background = {};
  const updateTask = (partial) => {
    background = { ...background, ...partial };
    return background;
  };

  await runContentGenerationTask({
    aiService: {
      getConfig: () => ({}),
      getImageModelAvailability: () => ({ available: false }),
    },
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    updateTask,
    payload: { generationOptions: state.contentGenerationOptions },
    taskControl: { isPauseRequested: () => false },
  });

  const explicitNone = findNode(state.outlineData.outline, '1.1');
  const evidence = findNode(state.outlineData.outline, '1.2');
  const commitment = findNode(state.outlineData.outline, '1.3');
  const table = findNode(state.outlineData.outline, '1.4');
  assert.equal(explicitNone.content, '无。');
  assert.equal(explicitNone.response_status, 'responded-none');
  assert.equal(evidence.content, '无。');
  assert.equal(evidence.response_status, 'missing-required-evidence');
  assert.equal(evidence.compliance_risk, 'potential-rejection');
  assert.equal(commitment.content, undefined);
  assert.equal(commitment.response_status, 'needs-manual-input');
  assert.equal(table.content, undefined);
  assert.equal(table.response_status, 'needs-manual-input');
  assert.equal(state.contentGenerationTask.status, 'success');
  assert.equal(state.contentGenerationTask.progress, 100);
  assert.equal(state.contentGenerationTask.stats.response.task_execution_success, true);
  assert.equal(state.contentGenerationTask.stats.response.compliance_complete, false);
  assert.deepEqual(state.contentGenerationTask.stats.response.missing_evidence_node_ids, ['1.2']);
});

test('minimumWords outline expansion rejects protected parents and refresh filtering keeps only freeform leaves', () => {
  const {
    formatOutlineExpansionContext,
    normalizeOutlineExpansionResponse,
    applyOutlineExpansionAdditions,
    collectFreeformLeafContexts,
  } = __developerContentExpansionPatchRuntime;
  const outline = [{
    id: '1',
    title: '根目录',
    response_mode: 'container',
    allow_ai_children: false,
    children: [
      { id: '1.1', title: '固定承诺函', response_mode: 'locked-commitment', allow_ai_children: false },
      { id: '1.2', title: '自由章节但禁增子目录', response_mode: 'freeform-markdown', allow_ai_children: false },
      { id: '1.3', title: '自由章节', response_mode: 'freeform-markdown', allow_ai_children: true },
    ],
  }];
  const contextText = formatOutlineExpansionContext(outline);
  assert.match(contextText, /1\.1 \| L2 \| locked/);
  assert.match(contextText, /1\.2 \| L2 \| locked/);
  assert.match(contextText, /1\.3 \| L2 \| add:L3/);
  assert.deepEqual(collectFreeformLeafContexts(outline).map(({ item }) => item.id), ['1.2', '1.3']);

  const nodeMap = new Map([
    ['1.1', { item: outline[0].children[0], level: 2 }],
    ['1.2', { item: outline[0].children[1], level: 2 }],
    ['1.3', { item: outline[0].children[2], level: 2 }],
  ]);
  for (const parentId of ['1.1', '1.2']) {
    assert.throws(() => normalizeOutlineExpansionResponse({
      additions: [{ parent_id: parentId, title: '违规新增', description: '不应被接受' }],
    }, { nodeMap, restoredNodeIds: new Set() }), /parent_id 无效/);
    assert.throws(() => applyOutlineExpansionAdditions(outline, {
      additions: [{ parent_id: parentId, title: '违规新增', description: '不应被接受' }],
    }), /不允许 AI 新增子目录/);
  }
});

function templateRecord(templateId, kind, template) {
  return {
    template_id: templateId,
    kind,
    analysis_item_id: 'bidDocumentFormatRequirements',
    profile_id: 'profile-1',
    format_node_id: `format-${templateId}`,
    source_title: templateId,
    source_location: {
      source_file_id: 'source-1',
      markdown_line_start: 1,
      markdown_line_end: 2,
      excerpt: '固定格式要求',
    },
    template,
    confirmed: false,
  };
}

function createControlledTemplates() {
  const locked = confirmTemplate(templateRecord('tpl-locked', 'locked-commitment', {
    kind: 'locked-commitment',
    segments: [
      { type: 'locked', text: '我方承诺项目名称为：' },
      { type: 'slot', slot_id: 'project_name', label: '项目名称', value_source: 'project-info', required: true },
      { type: 'locked', text: '。' },
    ],
  }));
  const table = confirmTemplate(templateRecord('tpl-table', 'fixed-markdown-table', {
    kind: 'fixed-markdown-table',
    table_title: '偏差表',
    headers: ['项目', '响应'],
    body: [
      {
        kind: 'row',
        row: {
          row_id: 'summary',
          cells: [
            { kind: 'locked', text: '总体偏差' },
            { kind: 'slot', slot_id: 'deviation', label: '偏差说明', value_source: 'manual', required: true },
          ],
        },
      },
      {
        kind: 'repeatable-region',
        region_id: 'items',
        row_template: {
          row_id: 'item-row',
          cells: [
            { kind: 'slot', slot_id: 'item_name', label: '项目', value_source: 'manual', required: true },
            { kind: 'slot', slot_id: 'item_response', label: '响应', value_source: 'manual', required: true },
          ],
        },
        min_rows: 1,
        max_rows: 3,
      },
    ],
    fixed_notes: ['注：本表结构不得修改。'],
  }));
  return { locked, table };
}

function createControlledTaskHarness({ lockedOutput, tableOutput, includeTable = true }) {
  const templates = createControlledTemplates();
  let state = {
    workflowKind: 'technical-plan',
    projectOverview: '测试项目',
    techRequirements: '测试要求',
    outlineData: {
      project_overview: '测试项目',
      outline: [{
        id: '1',
        title: '受控响应',
        response_mode: 'container',
        response_required: false,
        response_status: 'pending',
        compliance_risk: 'none',
        children: [
          { id: '1.1', title: '承诺函', description: '填写项目名称', response_mode: 'locked-commitment', response_required: true, template_id: templates.locked.template_id, response_status: 'needs-manual-input', compliance_risk: 'none' },
          ...(includeTable ? [{ id: '1.2', title: '偏差表', description: '填写偏差情况', response_mode: 'fixed-markdown-table', response_required: true, template_id: templates.table.template_id, response_status: 'needs-manual-input', compliance_risk: 'none' }] : []),
        ],
      }],
    },
    responseTemplates: includeTable ? [templates.locked, templates.table] : [templates.locked],
    globalFacts: [{ id: 'facts', title: '项目事实', content: '项目名称：测试项目' }],
    globalFactsTask: { status: 'success' },
    referenceKnowledgeDocumentIds: [],
    contentGenerationSections: {},
    contentGenerationPlans: {},
    contentGenerationOptions: {
      useAiImages: false,
      useMermaidImages: false,
      useHtmlImages: false,
      minimumWords: 0,
      tableRequirement: 'none',
      enableConsistencyAudit: false,
      enableOriginalPlanCoverageAudit: false,
    },
  };
  const calls = [];
  function persistRendered(nodeId, rendered, templateValues) {
    const item = findNode(state.outlineData.outline, nodeId);
    Object.assign(item, {
      content: rendered.content,
      template_values: templateValues,
      knowledge_item_ids: [],
      response_status: rendered.response_status,
      compliance_risk: rendered.compliance_risk,
      ...(rendered.compliance_message ? { compliance_message: rendered.compliance_message } : {}),
    });
    state.contentGenerationSections = {
      ...state.contentGenerationSections,
      [nodeId]: { id: nodeId, title: item.title, status: rendered.content.trim() ? 'success' : 'idle', content: rendered.content },
    };
    return state;
  }
  const workspaceStore = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    saveLockedTemplateValues: (payload, options) => {
      calls.push({ kind: 'locked', payload, options });
      const rendered = renderLockedCommitment(templates.locked, payload.slotValues);
      return persistRendered(payload.nodeId, rendered, { slot_values: rendered.slot_values });
    },
    saveFixedTableValues: (payload, options) => {
      calls.push({ kind: 'table', payload, options });
      const rendered = renderFixedMarkdownTable(templates.table, {
        cellValues: payload.cellValues,
        repeatableRows: payload.repeatableRows,
      });
      return persistRendered(payload.nodeId, rendered, {
        cell_values: rendered.cell_values,
        repeatable_rows: rendered.repeatable_rows,
      });
    },
    clearMermaidCache() {},
    clearIllustrationFiles() {},
  };
  const agentCalls = [];
  const agentService = {
    runTask: async (payload) => {
      agentCalls.push(payload);
      const output = payload.output_file.includes('1-1') ? lockedOutput : tableOutput;
      return { success: true, output_content: JSON.stringify(output) };
    },
  };
  return { getState: () => state, workspaceStore, agentService, calls, agentCalls };
}

async function runControlledHarness(harness) {
  let background = {};
  await runContentGenerationTask({
    aiService: {
      getConfig: () => ({}),
      getImageModelAvailability: () => ({ available: false }),
    },
    agentService: harness.agentService,
    workspaceStore: harness.workspaceStore,
    knowledgeBaseService: {},
    updateTask: (partial) => {
      background = { ...background, ...partial };
      return background;
    },
    payload: { generationOptions: harness.getState().contentGenerationOptions },
    taskControl: { isPauseRequested: () => false },
  });
}

test('full content generation fills confirmed locked and fixed templates through structured Store methods', async () => {
  const harness = createControlledTaskHarness({
    lockedOutput: { template_id: 'tpl-locked', slot_values: { project_name: '测试项目' }, knowledge_item_ids: [], missing_slots: [] },
    tableOutput: {
      template_id: 'tpl-table',
      cell_values: { deviation: '无偏差' },
      repeatable_rows: { items: [{ item_name: '服务内容', item_response: '完全响应' }] },
      knowledge_item_ids: [],
      missing_fields: [],
    },
  });
  await runControlledHarness(harness);

  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[0], {
    kind: 'locked',
    payload: { nodeId: '1.1', templateId: 'tpl-locked', slotValues: { project_name: '测试项目' } },
    options: { allowDuringContentTask: true, knowledgeItemIds: [] },
  });
  assert.deepEqual(harness.calls[1], {
    kind: 'table',
    payload: {
      nodeId: '1.2',
      templateId: 'tpl-table',
      cellValues: { deviation: '无偏差' },
      repeatableRows: { items: [{ item_name: '服务内容', item_response: '完全响应' }] },
    },
    options: { allowDuringContentTask: true, knowledgeItemIds: [] },
  });
  assert.equal(harness.agentCalls.length, 2);
  assert.ok(harness.agentCalls.every((call) => /严禁返回 content、markdown、完整正文/.test(call.prompt)));
  assert.ok(harness.agentCalls.every((call) => call.files.some((file) => file.path === 'controlled-response-context.json')));
  assert.ok(harness.agentCalls.every((call) => {
    const contextFile = call.files.find((file) => file.path === 'controlled-response-context.json');
    return contextFile && !contextFile.content.includes('我方承诺项目名称为');
  }));

  const state = harness.getState();
  assert.equal(findNode(state.outlineData.outline, '1.1').response_status, 'responded-substantive');
  assert.match(findNode(state.outlineData.outline, '1.1').content, /测试项目/);
  assert.equal(findNode(state.outlineData.outline, '1.2').response_status, 'responded-substantive');
  assert.match(findNode(state.outlineData.outline, '1.2').content, /\| 总体偏差 \| 无偏差 \|/);
  assert.equal(state.contentGenerationTask.stats.response.compliance_complete, true);
});

test('confirmed controlled template with missing required value stays needs-manual-input', async () => {
  const harness = createControlledTaskHarness({
    lockedOutput: { template_id: 'tpl-locked', slot_values: {}, knowledge_item_ids: [], missing_slots: ['project_name'] },
    tableOutput: {},
    includeTable: false,
  });
  await runControlledHarness(harness);

  const state = harness.getState();
  const commitment = findNode(state.outlineData.outline, '1.1');
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].payload.slotValues, {});
  assert.equal(commitment.response_status, 'needs-manual-input');
  assert.equal(commitment.compliance_risk, 'warning');
  assert.equal(state.contentGenerationTask.stats.response.compliance_complete, false);
  assert.deepEqual(state.contentGenerationTask.stats.response.pending_node_ids, ['1.1']);
});
