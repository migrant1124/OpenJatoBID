const SCORING_LEVELS = new Set(['normal', 'important', 'high', 'potential-rejection']);
const RESPONSE_TYPES = new Set(['content', 'table', 'illustration', 'evidence', 'commitment', 'manual']);
const SCORING_STATUSES = new Set(['unmapped', 'mapped', 'covered', 'needs-review']);
const RISK_CATEGORIES = new Set(['technical-response', 'format', 'attachment', 'signature', 'submission', 'evidence', 'other']);
const RISK_ROUTES = new Set(['outline', 'fixed-form', 'evidence', 'export', 'submission', 'manual-review']);
const RISK_STATUSES = new Set(['unhandled', 'covered', 'not-applicable', 'needs-confirmation']);
const HIDDEN_REQUIREMENT_KINDS = new Set(['appendix', 'footnote', 'table-note', 'cross-reference', 'upload-rule', 'naming-rule', 'other']);
const HIDDEN_REQUIREMENT_ROUTES = new Set(['outline', 'content', 'fixed-form', 'evidence', 'export', 'submission', 'manual-review']);
const VALUE_ANCHOR_CATEGORIES = new Set([
  'resilience-emergency',
  'quality-improvement',
  'schedule-assurance',
  'acceptance-readiness',
  'service-capability',
  'risk-governance',
  'data-closed-loop',
  'collaboration-governance',
  'creative-value',
  'visual-expression',
]);
const VALUE_ANCHOR_SUPPORT_STATES = new Set(['tender-supported', 'original-plan-supported', 'knowledge-supported', 'industry-template', 'needs-confirmation']);
const VALUE_ANCHOR_ROUTES = new Set(['directory', 'writing', 'table', 'illustration', 'risk', 'manual-review']);
const VALUE_ANCHOR_STATUSES = new Set(['candidate', 'accepted', 'rejected', 'needs-confirmation']);
const SOURCE_TYPES = new Set(['tender', 'appendix', 'footnote', 'original-plan', 'knowledge', 'user-input']);
const WRITING_PROFILES = new Set(['standard', 'deep', 'creative-proposal']);
const DEEP_WRITING_SOURCES = new Set(['ai', 'user', 'default']);
const DIRECTORY_GATE_FIELDS = [
  'scope_relevant',
  'score_or_delivery_value',
  'actionable',
  'section_capacity',
  'evidence_safe',
  'non_duplicate',
  'format_allowed',
];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, label);
}

function uniqueStrings(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function enumValue(value, allowed, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`${label} 包含不支持的值`);
  return value;
}

function normalizeSourceReferences(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value.map((item, index) => {
    if (!isPlainObject(item)) throw new Error(`${label}[${index}] 必须是对象`);
    const sourceType = enumValue(item.source_type, SOURCE_TYPES, undefined, `${label}[${index}].source_type`);
    if (!sourceType) throw new Error(`${label}[${index}].source_type 必须是非空字符串`);
    const normalized = { source_type: sourceType };
    for (const field of ['document_id', 'section', 'block_id', 'quote']) {
      const next = optionalString(item[field], `${label}[${index}].${field}`);
      if (next !== undefined) normalized[field] = next;
    }
    if (item.page !== undefined && item.page !== null && item.page !== '') {
      const page = Number(item.page);
      if (!Number.isInteger(page) || page < 1) throw new Error(`${label}[${index}].page 必须是正整数`);
      normalized.page = page;
    }
    return normalized;
  });
}

function normalizeAtomicScoringPoint(value, index) {
  if (!isPlainObject(value)) throw new Error(`scoring_points[${index}] 必须是对象`);
  const scoringPointId = requiredString(value.scoring_point_id, `scoring_points[${index}].scoring_point_id`);
  const normalized = {
    scoring_point_id: scoringPointId,
    group_requirement_id: requiredString(value.group_requirement_id, `scoring_points[${index}].group_requirement_id`),
    title: requiredString(value.title, `scoring_points[${index}].title`),
    requirement_text: requiredString(value.requirement_text, `scoring_points[${index}].requirement_text`),
    scoring_rule: requiredString(value.scoring_rule, `scoring_points[${index}].scoring_rule`),
    source_refs: normalizeSourceReferences(value.source_refs, `scoring_points[${index}].source_refs`),
    mandatory_level: enumValue(value.mandatory_level, SCORING_LEVELS, 'normal', `scoring_points[${index}].mandatory_level`),
    expected_response_types: uniqueStrings(value.expected_response_types, `scoring_points[${index}].expected_response_types`),
    high_score_conditions: uniqueStrings(value.high_score_conditions, `scoring_points[${index}].high_score_conditions`),
    mapped_node_ids: uniqueStrings(value.mapped_node_ids, `scoring_points[${index}].mapped_node_ids`),
    status: enumValue(value.status, SCORING_STATUSES, 'unmapped', `scoring_points[${index}].status`),
  };
  if (normalized.expected_response_types.some((item) => !RESPONSE_TYPES.has(item))) {
    throw new Error(`scoring_points[${index}].expected_response_types 包含不支持的值`);
  }
  if (value.score_value !== undefined && value.score_value !== null && value.score_value !== '') {
    const scoreValue = Number(value.score_value);
    if (!Number.isFinite(scoreValue) || scoreValue < 0) throw new Error(`scoring_points[${index}].score_value 必须是非负数字`);
    normalized.score_value = scoreValue;
  }
  const scoreText = optionalString(value.score_text, `scoring_points[${index}].score_text`);
  if (scoreText !== undefined) normalized.score_text = scoreText;
  const primaryNodeId = optionalString(value.primary_node_id, `scoring_points[${index}].primary_node_id`);
  if (primaryNodeId !== undefined) {
    if (!normalized.mapped_node_ids.includes(primaryNodeId)) {
      throw new Error(`scoring_points[${index}].primary_node_id 必须包含在 mapped_node_ids 中`);
    }
    normalized.primary_node_id = primaryNodeId;
  }
  return normalized;
}

function normalizeRejectionRisk(value, index) {
  if (!isPlainObject(value)) throw new Error(`rejection_risks[${index}] 必须是对象`);
  return {
    risk_id: requiredString(value.risk_id, `rejection_risks[${index}].risk_id`),
    source_refs: normalizeSourceReferences(value.source_refs, `rejection_risks[${index}].source_refs`),
    trigger: requiredString(value.trigger, `rejection_risks[${index}].trigger`),
    category: enumValue(value.category, RISK_CATEGORIES, 'other', `rejection_risks[${index}].category`),
    risk_level: enumValue(value.risk_level, new Set(['high', 'potential-rejection']), 'high', `rejection_risks[${index}].risk_level`),
    handling_route: enumValue(value.handling_route, RISK_ROUTES, 'manual-review', `rejection_risks[${index}].handling_route`),
    mapped_node_ids: uniqueStrings(value.mapped_node_ids, `rejection_risks[${index}].mapped_node_ids`),
    mitigation: requiredString(value.mitigation, `rejection_risks[${index}].mitigation`),
    status: enumValue(value.status, RISK_STATUSES, 'unhandled', `rejection_risks[${index}].status`),
  };
}

function normalizeHiddenRequirement(value, index) {
  if (!isPlainObject(value)) throw new Error(`hidden_requirements[${index}] 必须是对象`);
  return {
    hidden_requirement_id: requiredString(value.hidden_requirement_id, `hidden_requirements[${index}].hidden_requirement_id`),
    source_kind: enumValue(value.source_kind, HIDDEN_REQUIREMENT_KINDS, 'other', `hidden_requirements[${index}].source_kind`),
    requirement_text: requiredString(value.requirement_text, `hidden_requirements[${index}].requirement_text`),
    source_refs: normalizeSourceReferences(value.source_refs, `hidden_requirements[${index}].source_refs`),
    handling_route: enumValue(value.handling_route, HIDDEN_REQUIREMENT_ROUTES, 'manual-review', `hidden_requirements[${index}].handling_route`),
    mapped_node_ids: uniqueStrings(value.mapped_node_ids, `hidden_requirements[${index}].mapped_node_ids`),
    status: enumValue(value.status, RISK_STATUSES, 'unhandled', `hidden_requirements[${index}].status`),
  };
}

function normalizeValueAnchor(value, index, scoringPointIds) {
  if (!isPlainObject(value)) throw new Error(`value_anchors[${index}] 必须是对象`);
  const baseScoringPointIds = uniqueStrings(value.base_scoring_point_ids, `value_anchors[${index}].base_scoring_point_ids`);
  for (const scoringPointId of baseScoringPointIds) {
    if (!scoringPointIds.has(scoringPointId)) throw new Error(`未知评分点 ID：${scoringPointId}`);
  }
  const directoryGateSource = isPlainObject(value.directory_gate) ? value.directory_gate : {};
  const directoryGate = Object.fromEntries(DIRECTORY_GATE_FIELDS.map((field) => [field, directoryGateSource[field] === true]));
  const normalized = {
    anchor_id: requiredString(value.anchor_id, `value_anchors[${index}].anchor_id`),
    title: requiredString(value.title, `value_anchors[${index}].title`),
    category: enumValue(value.category, VALUE_ANCHOR_CATEGORIES, undefined, `value_anchors[${index}].category`),
    base_scoring_point_ids: baseScoringPointIds,
    business_value: requiredString(value.business_value, `value_anchors[${index}].business_value`),
    directory_recommended: value.directory_recommended === true,
    deep_writing_recommended: value.deep_writing_recommended === true,
    support_state: enumValue(value.support_state, VALUE_ANCHOR_SUPPORT_STATES, 'needs-confirmation', `value_anchors[${index}].support_state`),
    content_requirements: uniqueStrings(value.content_requirements, `value_anchors[${index}].content_requirements`),
    table_recommendations: uniqueStrings(value.table_recommendations, `value_anchors[${index}].table_recommendations`),
    visual_recommendations: uniqueStrings(value.visual_recommendations, `value_anchors[${index}].visual_recommendations`),
    risk_notes: uniqueStrings(value.risk_notes, `value_anchors[${index}].risk_notes`),
    route: enumValue(value.route, VALUE_ANCHOR_ROUTES, 'manual-review', `value_anchors[${index}].route`),
    status: enumValue(value.status, VALUE_ANCHOR_STATUSES, 'candidate', `value_anchors[${index}].status`),
    directory_gate: directoryGate,
  };
  if (normalized.route === 'directory' && Object.values(directoryGate).some((value) => value !== true)) {
    throw new Error(`value_anchors[${index}] 未通过目录准入 Gate，不能路由到 directory`);
  }
  const recommendedParentId = optionalString(value.recommended_parent_id, `value_anchors[${index}].recommended_parent_id`);
  if (recommendedParentId !== undefined) normalized.recommended_parent_id = recommendedParentId;
  return normalized;
}

function assertUniqueIds(items, field, label) {
  const seen = new Set();
  for (const item of items) {
    const id = item[field];
    if (seen.has(id)) throw new Error(`${label} 存在重复 ID：${id}`);
    seen.add(id);
  }
}

function normalizeRequirementResponseMatrix(value, { knownNodeIds = [] } = {}) {
  if (!isPlainObject(value)) throw new Error('RequirementResponseMatrix 必须是对象');
  const scoringPointsRaw = Array.isArray(value.scoring_points) ? value.scoring_points : [];
  const scoringPoints = scoringPointsRaw.map(normalizeAtomicScoringPoint);
  assertUniqueIds(scoringPoints, 'scoring_point_id', 'scoring_points');
  const scoringPointIds = new Set(scoringPoints.map((item) => item.scoring_point_id));
  const rejectionRisks = (Array.isArray(value.rejection_risks) ? value.rejection_risks : []).map(normalizeRejectionRisk);
  const hiddenRequirements = (Array.isArray(value.hidden_requirements) ? value.hidden_requirements : []).map(normalizeHiddenRequirement);
  const knownNodes = new Set(knownNodeIds);
  if (knownNodes.size) {
    for (const collection of [scoringPoints, rejectionRisks, hiddenRequirements]) {
      for (const item of collection) {
        for (const nodeId of item.mapped_node_ids) {
        if (!knownNodes.has(nodeId)) throw new Error(`未知目录节点 ID：${nodeId}`);
        }
      }
    }
  }
  const valueAnchors = (Array.isArray(value.value_anchors) ? value.value_anchors : []).map((item, index) => normalizeValueAnchor(item, index, scoringPointIds));
  assertUniqueIds(rejectionRisks, 'risk_id', 'rejection_risks');
  assertUniqueIds(hiddenRequirements, 'hidden_requirement_id', 'hidden_requirements');
  assertUniqueIds(valueAnchors, 'anchor_id', 'value_anchors');
  return {
    schema_version: 1,
    revision: requiredString(value.revision || 'matrix-1', 'RequirementResponseMatrix.revision'),
    scoring_points: scoringPoints,
    rejection_risks: rejectionRisks,
    hidden_requirements: hiddenRequirements,
    value_anchors: valueAnchors,
    updated_at: optionalString(value.updated_at, 'RequirementResponseMatrix.updated_at') || new Date().toISOString(),
  };
}

function normalizeOutlineQualityMetadata(value) {
  const source = isPlainObject(value) ? value : {};
  const writingProfile = enumValue(source.writing_profile, WRITING_PROFILES, 'standard', 'OutlineItem.writing_profile');
  const normalized = {
    deep_writing: source.deep_writing === true || writingProfile === 'creative-proposal',
    deep_writing_recommended: source.deep_writing_recommended === true,
    writing_profile: writingProfile,
    value_anchor_ids: uniqueStrings(source.value_anchor_ids, 'OutlineItem.value_anchor_ids'),
    mapped_scoring_point_ids: uniqueStrings(source.mapped_scoring_point_ids, 'OutlineItem.mapped_scoring_point_ids'),
  };
  const reason = optionalString(source.deep_writing_reason, 'OutlineItem.deep_writing_reason');
  if (reason !== undefined) normalized.deep_writing_reason = reason;
  const deepWritingSource = enumValue(source.deep_writing_source, DEEP_WRITING_SOURCES, undefined, 'OutlineItem.deep_writing_source');
  if (deepWritingSource !== undefined) normalized.deep_writing_source = deepWritingSource;
  return normalized;
}

function buildOutlineQualityMetadataPatch(item = {}) {
  return normalizeOutlineQualityMetadata({
    deep_writing: item.deep_writing,
    deep_writing_recommended: item.deep_writing_recommended,
    deep_writing_reason: item.deep_writing_reason,
    deep_writing_source: item.deep_writing_source,
    writing_profile: item.writing_profile,
    value_anchor_ids: item.value_anchor_ids,
    mapped_scoring_point_ids: item.mapped_scoring_point_ids,
  });
}

module.exports = {
  buildOutlineQualityMetadataPatch,
  normalizeOutlineQualityMetadata,
  normalizeRequirementResponseMatrix,
  normalizeSourceReferences,
};
