const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RESPONSE_MODES,
  partitionOutlineResponseTargets,
  buildDeterministicExplicitNone,
  buildEvidenceMarkdown,
  validateResponseModeCompletion,
  deriveResponseCompletion,
  protectWriteForResponseMode,
  reduceResponseModeRunState,
} = require('./contentResponseModes.cjs');

function item(id, responseMode, overrides = {}) {
  return {
    id,
    title: id,
    response_mode: responseMode,
    response_required: true,
    response_status: 'pending',
    compliance_risk: 'none',
    content: '',
    ...overrides,
  };
}

test('partitions all six modes in depth-first order and excludes containers from content targets', () => {
  const outline = [
    item('container', 'container', {
      children: [
        item('freeform', 'freeform-markdown'),
        item('table', 'fixed-markdown-table', {
          children: [item('commitment', 'locked-commitment')],
        }),
      ],
    }),
    item('evidence', 'evidence-markdown'),
    item('none', 'explicit-none'),
  ];
  const result = partitionOutlineResponseTargets(outline);

  assert.deepEqual(Object.keys(result.byMode), RESPONSE_MODES);
  for (const mode of RESPONSE_MODES) assert.equal(result.byMode[mode].length, 1);
  assert.deepEqual(result.targets.map((entry) => entry.id), ['freeform', 'table', 'commitment', 'evidence', 'none']);
  assert.deepEqual(result.containers.map((entry) => entry.id), ['container']);
});

test('builds explicit-none content deterministically and preserves risk', () => {
  assert.deepEqual(buildDeterministicExplicitNone({ response_required: false }), {
    content: '无。',
    knowledge_item_ids: [],
    response_status: 'responded-none',
    compliance_risk: 'none',
  });
  assert.deepEqual(buildDeterministicExplicitNone({
    empty_response_text: '  不适用。  ',
    response_required: true,
    compliance_risk: 'potential-rejection',
  }), {
    content: '不适用。',
    knowledge_item_ids: [],
    response_status: 'responded-none',
    compliance_risk: 'potential-rejection',
    compliance_message: '该节点已按无实质内容响应，请核对投标风险',
  });
});

test('unknown response modes fail closed', () => {
  assert.throws(
    () => partitionOutlineResponseTargets([item('invalid', 'future-mode')]),
    /未知的目录响应模式/,
  );
  assert.equal(protectWriteForResponseMode(item('invalid', 'future-mode'), 'save-chapter-content').decision, 'reject');
  assert.equal(validateResponseModeCompletion(item('invalid', 'future-mode')).compliant, false);
});

test('evidence output keeps only known IDs and renders metadata instead of attachment content', () => {
  const candidates = [
    { id: 'doc::K2', title: '人员证书', content: 'SECRET', source_file: 'certificate.pdf' },
    { id: 'doc::K1', title: '合同_[2025]', content: 'DO NOT COPY' },
  ];
  const result = buildEvidenceMarkdown(
    item('evidence', 'evidence-markdown'),
    candidates,
    { knowledge_item_ids: ['unknown', 'doc::K1', 'doc::K1', 'doc::K2'] },
  );

  assert.deepEqual(result.knowledge_item_ids, ['doc::K1', 'doc::K2']);
  assert.deepEqual(result.discarded_knowledge_item_ids, ['unknown']);
  assert.equal(result.response_status, 'responded-substantive');
  assert.equal(result.compliance_risk, 'none');
  assert.match(result.content, /^### 材料索引\n\n1\. 合同\\_\\\[2025\\\]/);
  assert.ok(result.content.indexOf('doc::K1') < result.content.indexOf('doc::K2'));
  assert.doesNotMatch(result.content, /SECRET|DO NOT COPY|certificate\.pdf/);
});

test('missing evidence distinguishes required status while retaining configured risk', () => {
  const required = buildEvidenceMarkdown(
    item('required', 'evidence-markdown', { missing_evidence_risk: 'potential-rejection' }),
    [{ id: 'known', title: '已知材料' }],
    ['unknown'],
  );
  assert.equal(required.content, '无。');
  assert.equal(required.response_status, 'missing-required-evidence');
  assert.equal(required.compliance_risk, 'potential-rejection');
  assert.deepEqual(required.discarded_knowledge_item_ids, ['unknown']);

  const optional = buildEvidenceMarkdown(
    item('optional', 'evidence-markdown', { response_required: false, missing_evidence_risk: 'high' }),
    [],
    [],
  );
  assert.equal(optional.response_status, 'responded-none');
  assert.equal(optional.compliance_risk, 'high');
});

test('completion separates successful execution from compliance actions', () => {
  const outline = [
    item('done', 'freeform-markdown', {
      content: '已生成',
      response_status: 'responded-substantive',
    }),
    item('manual', 'locked-commitment', { response_status: 'needs-manual-input' }),
    item('missing', 'evidence-markdown', {
      content: '无。',
      response_status: 'missing-required-evidence',
      compliance_risk: 'high',
    }),
    item('container', 'container'),
  ];
  const result = deriveResponseCompletion(outline, { taskStatus: 'success' });

  assert.equal(result.task_execution_success, true);
  assert.equal(result.response_complete, false);
  assert.equal(result.compliance_complete, false);
  assert.equal(result.outcome, 'completed-with-actions-required');
  assert.deepEqual(result.pending_node_ids, ['manual']);
  assert.deepEqual(result.missing_evidence_node_ids, ['missing']);
  assert.deepEqual(result.attention_node_ids, ['manual', 'missing']);
  assert.equal(result.target_count, 3);

  assert.equal(validateResponseModeCompletion(outline[2]).response_complete, true);
  assert.equal(validateResponseModeCompletion(outline[2]).compliant, false);
  assert.equal(validateResponseModeCompletion(outline[3]).is_target, false);
});

test('pending and needs-manual-input never become silently compliant', () => {
  for (const status of ['pending', 'needs-manual-input']) {
    const validation = validateResponseModeCompletion(item(status, 'freeform-markdown', {
      content: '即使意外存在正文',
      response_status: status,
    }));
    assert.equal(validation.response_complete, false);
    assert.equal(validation.compliant, false);
    assert.equal(validation.requires_attention, true);
  }
});

test('write guard blocks every generic bypass outside freeform and permits only dedicated renderers', () => {
  const genericOperations = [
    'save-chapter-content',
    'generate-all',
    'regenerate-section',
    'expand',
    'rewrite',
    'polish',
    'minimum-words',
    'consistency-repair',
    'table-cleanup',
    'original-scheme-replace',
    'illustration-writeback',
  ];
  const protectedModes = RESPONSE_MODES.filter((mode) => mode !== 'freeform-markdown');

  for (const operation of genericOperations) {
    assert.equal(protectWriteForResponseMode(item('free', 'freeform-markdown'), operation).decision, 'allow');
    for (const mode of protectedModes) {
      assert.equal(protectWriteForResponseMode(item(mode, mode), operation).decision, 'reject', `${mode}: ${operation}`);
    }
  }

  const dedicated = [
    ['evidence-markdown', 'deterministic-evidence-write'],
    ['locked-commitment', 'save-locked-template-values'],
    ['fixed-markdown-table', 'save-fixed-table-values'],
    ['explicit-none', 'render-explicit-none'],
  ];
  for (const [mode, operation] of dedicated) {
    assert.equal(protectWriteForResponseMode(item(mode, mode), operation).decision, 'allow');
  }
  assert.equal(protectWriteForResponseMode(item('container', 'container'), 'render-explicit-none').decision, 'reject');
});

test('pause and resume keep deterministic progress and only complete from running', () => {
  let state = reduceResponseModeRunState(undefined, { type: 'start' });
  state = reduceResponseModeRunState(state, { type: 'advance', count: 2 });
  state = reduceResponseModeRunState(state, { type: 'pause' });
  assert.deepEqual({ status: state.status, completed: state.completed }, { status: 'paused', completed: 2 });

  const pausedAdvance = reduceResponseModeRunState(state, { type: 'advance', count: 5 });
  assert.equal(pausedAdvance.completed, 2);
  assert.equal(reduceResponseModeRunState(pausedAdvance, { type: 'complete' }).status, 'paused');

  state = reduceResponseModeRunState(pausedAdvance, { type: 'resume' });
  state = reduceResponseModeRunState(state, { type: 'advance' });
  state = reduceResponseModeRunState(state, { type: 'complete' });
  assert.deepEqual({ status: state.status, completed: state.completed }, { status: 'success', completed: 3 });
});
