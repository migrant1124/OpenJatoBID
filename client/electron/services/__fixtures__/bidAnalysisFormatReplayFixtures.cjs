const crypto = require('node:crypto');

function hashAnchorIds(anchorIds) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(anchorIds), 'utf8')
    .digest('hex');
}

const promptAnchorIds = [
  'source-anchor-18e2409b0a42c722adf1',
  'source-anchor-cf5d4ad4f7605193cf2c',
  'source-anchor-fc2ec04da9b801713ae3',
];

const validatorAnchorIdsWithoutCf5 = [
  'source-anchor-18e2409b0a42c722adf1',
  'source-anchor-fc2ec04da9b801713ae3',
];

const parsedFormatResultWithBareCf5 = {
  result: {
    schema_version: 1,
    has_explicit_technical_format: true,
    profiles: [{
      profile_id: 'service-technical-profile',
      applicable_scope: {
        section_id: 'section-redacted',
        section_title: '脱敏标段',
        package_ids: ['package-redacted'],
        package_names: ['脱敏包件'],
        document_type: 'technical',
      },
      format_strength: 'strict',
      document_title: '技术文件',
      outline: [{
        format_node_id: 'technical-root',
        source_number: '三',
        source_title: '技术文件（按包制作）',
        required_in_outline: true,
        response_required: true,
        title_locked: true,
        order_locked: true,
        level_locked: true,
        numbering_policy: 'preserve-source',
        response_mode: 'container',
        allow_ai_children: false,
        children: [{
          format_node_id: 'technical-cover',
          source_title: '封面页',
          required_in_outline: true,
          response_required: true,
          title_locked: true,
          order_locked: true,
          level_locked: true,
          numbering_policy: 'none',
          response_mode: 'freeform-markdown',
          allow_ai_children: false,
          children: [],
          source: { anchor_ids: ['cf5d4ad4f7605193cf2c'] },
        }],
      }],
    }],
    template_ids: [],
    other_format_rules: {
      signature_and_seal: [],
      file_and_upload: [],
      typesetting: [],
      required_template_ids: [],
    },
    sources: [],
  },
  templates: [],
};

function replayEnvelope(overrides = {}) {
  const promptIds = overrides.prompt_anchor_ids || promptAnchorIds;
  const hasParsedResult = Object.prototype.hasOwnProperty.call(overrides, 'parsed_result');
  const parsedResult = hasParsedResult ? overrides.parsed_result : parsedFormatResultWithBareCf5;
  return {
    run_id: overrides.run_id || 'run-redacted-format-001',
    document_id: 'doc-redacted-format-001',
    document_version: 'doc-version-redacted-001',
    prompt_version: 'bid-format-replay-v1',
    anchor_catalog_hash: hashAnchorIds(promptIds),
    prompt_anchor_ids: promptIds,
    validator_anchor_ids: overrides.validator_anchor_ids || promptIds,
    raw_model_response: overrides.raw_model_response || JSON.stringify(parsedResult),
    parsed_result: parsedResult,
    final_validation_error: overrides.final_validation_error
      || 'result.profiles[0].outline[0].children[0].source.anchor_ids[0]: 未知来源锚点 cf5d4ad4f7605193cf2c',
  };
}

const replayFixtures = {
  bareCf5UnknownAnchor: replayEnvelope({
    validator_anchor_ids: validatorAnchorIdsWithoutCf5,
  }),
  catalogMismatch: replayEnvelope({
    run_id: 'run-redacted-format-mismatch',
    validator_anchor_ids: validatorAnchorIdsWithoutCf5,
  }),
  oldRunLateResponse: replayEnvelope({
    run_id: 'run-redacted-format-old',
  }),
  invalidJson: replayEnvelope({
    run_id: 'run-redacted-format-invalid-json',
    raw_model_response: '{"result":',
    parsed_result: undefined,
    final_validation_error: '格式要求结构提取结果不是有效 JSON，请重新解析',
  }),
};

module.exports = {
  hashAnchorIds,
  replayFixtures,
};
