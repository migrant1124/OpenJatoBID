const assert = require('node:assert/strict');
const test = require('node:test');

const { __test__ } = require('./technicalPlanStore.cjs');

const {
  bidItemFromRow,
  normalizeBidAnalysisItemContract,
} = __test__;

const analysisContext = {
  run_id: 'run-diagnostics-001',
  document_id: 'document-diagnostics-001',
  document_version: 'document-version-diagnostics-001',
  prompt_version: 'bid-document-format-requirements-v1',
  anchor_catalog_hash: 'a'.repeat(64),
};

const diagnostic = {
  error_code: 'FORMAT_VALIDATION_FAILED',
  error_path: 'result.profiles[0].outline[0].source.anchor_ids[0]',
  message: '格式要求确定性校验失败：未知来源锚点',
  ...analysisContext,
  requires_manual_review: true,
};

test('normalizes sanitized bid analysis diagnostic contract for storage', () => {
  const contract = normalizeBidAnalysisItemContract({
    status: 'error',
    error: diagnostic.message,
    analysis_context: analysisContext,
    diagnostic,
    requires_manual_review: true,
  });

  assert.deepEqual(contract.analysisContext, analysisContext);
  assert.deepEqual(contract.diagnostic, diagnostic);
  assert.equal(contract.requiresManualReview, true);
  assert.doesNotMatch(JSON.stringify(contract), /国网|湖北|武汉|供电|采购|招标编号/u);
});

test('loads bid analysis diagnostic contract from stored row JSON', () => {
  const item = bidItemFromRow({
    item_id: 'bidDocumentFormatRequirements',
    label: '格式要求',
    status: 'error',
    content: '',
    normalized_hash: null,
    error: diagnostic.message,
    analysis_context_json: JSON.stringify(analysisContext),
    diagnostic_json: JSON.stringify(diagnostic),
    requires_manual_review: 1,
  });

  assert.deepEqual(item.analysis_context, analysisContext);
  assert.deepEqual(item.diagnostic, diagnostic);
  assert.equal(item.requires_manual_review, true);
});

test('success contract clears previous diagnostic while preserving analysis context', () => {
  const contract = normalizeBidAnalysisItemContract({
    status: 'success',
    analysis_context: analysisContext,
    diagnostic,
    requires_manual_review: true,
  });

  assert.deepEqual(contract.analysisContext, analysisContext);
  assert.equal(contract.diagnostic, undefined);
  assert.equal(contract.requiresManualReview, false);
});

test('stale analysis result is not persisted as a manual-review diagnostic', () => {
  const contract = normalizeBidAnalysisItemContract({
    status: 'error',
    analysis_context: analysisContext,
    diagnostic: {
      ...diagnostic,
      error_code: 'STALE_ANALYSIS_RESULT',
      message: '旧响应已忽略',
    },
    requires_manual_review: true,
  });

  assert.equal(contract.diagnostic, undefined);
  assert.equal(contract.requiresManualReview, false);
});
