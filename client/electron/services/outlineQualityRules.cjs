const { normalizeRequirementResponseMatrix } = require('./technicalPlanQualityModel.cjs');

const FOCUS_PRIORITIES = ['service-plan', 'score-first', 'score-second'];

function walkOutline(items, level = 1, parentSecondLevelId = null, rows = []) {
  for (const item of items || []) {
    if (!item || !item.id) continue;
    const secondLevelId = level === 2 ? String(item.id) : parentSecondLevelId;
    rows.push({ item, id: String(item.id), level, secondLevelId });
    walkOutline(item.children, level + 1, secondLevelId, rows);
  }
  return rows;
}

function normalizeTitle(value) {
  return String(value || '').replace(/[\s：:、，,。；;（）()【】\[\]《》<>]/gu, '').trim();
}

function scoreBands(scoringPoints) {
  const scores = [...new Set(scoringPoints
    .map((point) => point.score_value)
    .filter((score) => Number.isFinite(score)))]
    .sort((left, right) => right - left);
  return scores.slice(0, 2);
}

function collectExplicitFocusIds(item, field) {
  return Array.isArray(item?.[field])
    ? [...new Set(item[field].map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
}

function findScoringPointIds(item, scoringPoints) {
  const explicitIds = collectExplicitFocusIds(item, 'focus_scoring_point_ids');
  if (explicitIds.length) {
    const knownIds = new Set(scoringPoints.map((point) => point.scoring_point_id));
    return explicitIds.filter((id) => knownIds.has(id));
  }

  const itemTitle = normalizeTitle(item?.title);
  if (!itemTitle) return [];
  return scoringPoints
    .filter((point) => {
      const suggested = normalizeTitle(point.suggested_section);
      const title = normalizeTitle(point.title);
      return [suggested, title].some((candidate) => candidate.length >= 3
        && (itemTitle.includes(candidate) || candidate.includes(itemTitle)));
    })
    .map((point) => point.scoring_point_id);
}

function isServicePlanSection(item) {
  const title = String(item?.title || '').trim();
  return /服务方案|实施方案|技术方案|服务内容|服务措施|履约方案/u.test(title);
}

function resolveFocusPriority(item, scoringPoints, bands) {
  if (item?.service_plan_section === true || isServicePlanSection(item)) return 'service-plan';
  const pointIds = findScoringPointIds(item, scoringPoints);
  const matchedPoints = scoringPoints.filter((point) => pointIds.includes(point.scoring_point_id));
  if (bands.length && matchedPoints.some((point) => point.score_value === bands[0])) return 'score-first';
  if (bands.length > 1 && matchedPoints.some((point) => point.score_value === bands[1])) return 'score-second';
  return undefined;
}

function annotateOutlineQualityMetadata(outline, matrix) {
  const normalizedMatrix = normalizeRequirementResponseMatrix(matrix);
  const bands = scoreBands(normalizedMatrix.scoring_points);
  function visit(items) {
    return (items || []).map((item) => {
      const focusScoringPointIds = findScoringPointIds(item, normalizedMatrix.scoring_points);
      const focusPriority = resolveFocusPriority(item, normalizedMatrix.scoring_points, bands);
      const {
        deep_writing,
        deep_writing_recommended,
        deep_writing_reason,
        deep_writing_source,
        writing_profile,
        value_anchor_ids,
        mapped_scoring_point_ids,
        primary_requirement_ids,
        supplemental_requirement_ids,
        source_requirement_id,
        source_requirement_title,
        service_plan_section,
        ...next
      } = item;
      if (focusPriority) next.focus_priority = focusPriority;
      if (focusScoringPointIds.length) next.focus_scoring_point_ids = focusScoringPointIds;
      if (item.children?.length) next.children = visit(item.children);
      return next;
    });
  }

  return { ...outline, outline: visit(outline?.outline || []) };
}

function validateConditionalOutlineDepth() {
  // v1.5.0 no longer applies fifth-level or deep-writing gates.
}

function reconcileRequirementMatrixWithOutline(matrix) {
  const normalized = normalizeRequirementResponseMatrix(matrix);
  const nextMatrix = {
    ...normalized,
    scoring_points: normalized.scoring_points.map((point) => ({
      ...point,
      mapped_node_ids: [],
      status: 'unmapped',
    })),
  };
  return {
    matrix: normalizeRequirementResponseMatrix(nextMatrix),
    review: { can_proceed: true, errors: [], warnings: [] },
  };
}

function applyOutlineQualityRules(outline, matrix) {
  const annotatedOutline = annotateOutlineQualityMetadata(outline, matrix);
  const quality = reconcileRequirementMatrixWithOutline(matrix, annotatedOutline);
  return { outline: annotatedOutline, ...quality };
}

module.exports = {
  FOCUS_PRIORITIES,
  annotateOutlineQualityMetadata,
  applyOutlineQualityRules,
  reconcileRequirementMatrixWithOutline,
  validateConditionalOutlineDepth,
  walkOutline,
};
