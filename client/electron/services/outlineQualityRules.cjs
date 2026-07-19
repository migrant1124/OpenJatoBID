const {
  normalizeOutlineQualityMetadata,
  normalizeRequirementResponseMatrix,
} = require('./technicalPlanQualityModel.cjs');
const { validateRequirementResponseMatrix } = require('./technicalPlanQualityValidation.cjs');

function walkOutline(items, level = 1, parentSecondLevelId = null, rows = []) {
  for (const item of items || []) {
    if (!item || !item.id) continue;
    const secondLevelId = level === 2 ? String(item.id) : parentSecondLevelId;
    rows.push({ item, id: String(item.id), level, secondLevelId });
    walkOutline(item.children, level + 1, secondLevelId, rows);
  }
  return rows;
}

function subtreeDepth(item, level = 1) {
  const childDepth = Math.max(0, ...(item?.children || []).map((child) => subtreeDepth(child, level + 1)));
  return Math.max(level, childDepth);
}

function annotateOutlineQualityMetadata(outline) {
  function visit(items, level) {
    return (items || []).map((item) => {
      const qualityMetadata = normalizeOutlineQualityMetadata(item);
      const next = { ...item, ...qualityMetadata };
      if (level === 2 && next.deep_writing_recommended === true && next.deep_writing !== true) {
        next.deep_writing = true;
      }
      if (level === 2 && next.deep_writing === true && !next.deep_writing_source) {
        next.deep_writing_source = 'ai';
      }
      if (level !== 2) {
        next.deep_writing = false;
        next.deep_writing_recommended = false;
        next.writing_profile = 'standard';
        delete next.deep_writing_reason;
        delete next.deep_writing_source;
        delete next.value_anchor_ids;
        delete next.mapped_scoring_point_ids;
      }
      if (item.children?.length) next.children = visit(item.children, level + 1);
      return next;
    });
  }

  return { ...outline, outline: visit(outline?.outline || [], 1) };
}

function validateConditionalOutlineDepth(outline) {
  const errors = [];
  for (const row of walkOutline(outline?.outline || [])) {
    if (row.level > 5) errors.push(`目录节点 ${row.id} 超过五级，禁止生成 L6 及以下目录`);
    if (row.level !== 2) continue;
    const depth = subtreeDepth(row.item, 2);
    if (row.item.deep_writing_recommended === true && !String(row.item.deep_writing_reason || '').trim()) {
      errors.push(`深化二级目录 ${row.id} 缺少深化理由`);
    }
    if (row.item.deep_writing === true) {
      if (depth !== 5) errors.push(`深化二级目录 ${row.id} 必须完整生成至第五级`);
    } else if (depth > 4) {
      errors.push(`普通二级目录 ${row.id} 最高只能生成至第四级`);
    }
  }
  if (errors.length) throw new Error(errors.join('；'));
}

function reconcileRequirementMatrixWithOutline(matrix, outline) {
  const rows = walkOutline(outline?.outline || []);
  const nodeIds = rows.map((row) => row.id);
  const secondLevelRows = rows.filter((row) => row.level === 2);
  const normalized = normalizeRequirementResponseMatrix(matrix);
  const pointIds = new Set(normalized.scoring_points.map((point) => point.scoring_point_id));
  const acceptedAnchorIds = new Set(normalized.value_anchors
    .filter((anchor) => anchor.status === 'accepted')
    .map((anchor) => anchor.anchor_id));
  const pointToNodeId = new Map();

  for (const row of secondLevelRows) {
    for (const pointId of row.item.mapped_scoring_point_ids || []) {
      if (!pointIds.has(pointId)) throw new Error(`目录节点 ${row.id} 关联了未知原子评分点 ${pointId}`);
      if (pointToNodeId.has(pointId)) throw new Error(`原子评分点 ${pointId} 只能指定一个二级目录主负责人`);
      pointToNodeId.set(pointId, row.id);
    }
    for (const anchorId of row.item.value_anchor_ids || []) {
      if (!acceptedAnchorIds.has(anchorId)) throw new Error(`目录节点 ${row.id} 只能采用已确认的增值锚点 ${anchorId}`);
    }
  }

  const nextMatrix = {
    ...normalized,
    scoring_points: normalized.scoring_points.map((point) => {
      const nodeId = pointToNodeId.get(point.scoring_point_id);
      return nodeId
        ? { ...point, mapped_node_ids: [nodeId], primary_node_id: nodeId, status: 'mapped' }
        : { ...point, mapped_node_ids: [], status: 'unmapped' };
    }),
    rejection_risks: normalized.rejection_risks.map((risk) => {
      if (risk.status !== 'unhandled') return risk;
      const needsManualReview = risk.handling_route === 'outline';
      return {
        ...risk,
        handling_route: needsManualReview ? 'manual-review' : risk.handling_route,
        mapped_node_ids: needsManualReview ? [] : risk.mapped_node_ids,
        status: 'needs-confirmation',
      };
    }),
    hidden_requirements: normalized.hidden_requirements.map((requirement) => {
      if (requirement.status !== 'unhandled') return requirement;
      const needsManualReview = ['outline', 'content'].includes(requirement.handling_route);
      return {
        ...requirement,
        handling_route: needsManualReview ? 'manual-review' : requirement.handling_route,
        mapped_node_ids: needsManualReview ? [] : requirement.mapped_node_ids,
        status: 'needs-confirmation',
      };
    }),
  };

  const normalizedMatrix = normalizeRequirementResponseMatrix(nextMatrix, { knownNodeIds: nodeIds });
  const review = validateRequirementResponseMatrix(normalizedMatrix, outline);
  if (!review.can_proceed) {
    throw new Error(`目录质量校验未通过：${review.errors.map((item) => item.message).join('；')}`);
  }
  return { matrix: normalizedMatrix, review };
}

function applyOutlineQualityRules(outline, matrix) {
  const annotatedOutline = annotateOutlineQualityMetadata(outline);
  validateConditionalOutlineDepth(annotatedOutline);
  const quality = reconcileRequirementMatrixWithOutline(matrix, annotatedOutline);
  return { outline: annotatedOutline, ...quality };
}

module.exports = {
  annotateOutlineQualityMetadata,
  applyOutlineQualityRules,
  reconcileRequirementMatrixWithOutline,
  validateConditionalOutlineDepth,
  walkOutline,
};
