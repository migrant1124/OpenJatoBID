const assert = require('node:assert/strict');
const test = require('node:test');

const { __developerContentExpansionPatchRuntime } = require('./contentGenerationTask.cjs');
const { deriveResponseCompletion, protectWriteForResponseMode } = require('./contentResponseModes.cjs');
const { resolveTechnicalPlanExportPayload } = require('./exportService.cjs');
const { __test__: technicalPlanStoreTest } = require('./technicalPlanStore.cjs');

function manualNode(content = '') {
  return {
    id: '1.1',
    title: '服务承诺函',
    description: '人工填写',
    manual_input_required: true,
    response_mode: 'freeform-markdown',
    response_required: true,
    response_status: content.trim() ? 'responded-substantive' : 'needs-manual-input',
    compliance_risk: 'none',
    content,
  };
}

function fakeStore(outline) {
  return {
    loadTechnicalPlan: () => ({ outlineData: { project_name: '脱敏项目', outline } }),
    validateProtectedResponses: () => ({ valid: true }),
  };
}

test('manual input nodes are excluded from AI generation and automatic outline expansion targets', () => {
  const manual = manualNode('人工已填写内容');
  const normal = { id: '1.2', title: '实施方案', description: '', response_mode: 'freeform-markdown', allow_ai_children: true };
  const outline = [{ id: '1', title: '技术文件', description: '', children: [manual, normal] }];

  assert.deepEqual(
    __developerContentExpansionPatchRuntime.collectFreeformLeafContexts(outline).map(({ item }) => item.id),
    ['1.2'],
  );
  const expansionContext = __developerContentExpansionPatchRuntime.formatOutlineExpansionContext(outline);
  assert.match(expansionContext, /1\.1 \| L2 \| locked/u);
  assert.match(expansionContext, /1\.2 \| L2 \| add:L3/u);
  assert.equal(protectWriteForResponseMode(manual, 'full-regenerate').allowed, false);
});

test('empty manual input blocks export and filled Markdown passes without template validation', () => {
  const empty = manualNode('');
  const emptyCompletion = deriveResponseCompletion([empty], { taskStatus: 'success' });
  assert.deepEqual(emptyCompletion.pending_node_ids, ['1.1']);
  assert.throws(
    () => resolveTechnicalPlanExportPayload({ source: 'technical-plan' }, fakeStore([empty])),
    /尚需人工补充.*请处理后再导出/u,
  );

  const filled = manualNode('本承诺函内容由投标人人工填写。');
  const result = resolveTechnicalPlanExportPayload({ source: 'technical-plan' }, fakeStore([filled]));
  assert.equal(result.outline[0].content, '本承诺函内容由投标人人工填写。');
});

test('legacy v18 controlled template constraints load as editable manual Markdown without a template ID', () => {
  const constraints = technicalPlanStoreTest.normalizeOutlineFormatConstraints(JSON.stringify({
    response_mode: 'fixed-markdown-table',
    template_id: 'legacy-template-01',
    required_in_outline: true,
  }));

  assert.equal(constraints.response_mode, 'freeform-markdown');
  assert.equal(constraints.manual_input_required, true);
  assert.equal(constraints.template_id, undefined);
  assert.equal(constraints.required_in_outline, true);
});
