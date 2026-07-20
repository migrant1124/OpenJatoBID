const { normalizeRequirementResponseMatrix } = require('./technicalPlanQualityModel.cjs');

function flattenOutline(items, level = 1, rows = []) {
  for (const item of items || []) {
    if (!item?.id) continue;
    rows.push({ id: String(item.id), level, item });
    flattenOutline(item.children, level + 1, rows);
  }
  return rows;
}

function getDirectoryEligibleValueAnchors(matrix) {
  return (matrix?.value_anchors || []).filter((anchor) => anchor.status === 'accepted' && anchor.route === 'directory');
}

function validateRequirementResponseMatrix(matrix, outlineData) {
  const nodes = flattenOutline(outlineData?.outline || []);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const normalized = normalizeRequirementResponseMatrix(matrix, { knownNodeIds: [...nodesById.keys()] });
  const errors = [];
  const warnings = [];

  for (const point of normalized.scoring_points) {
    if (point.status === 'unmapped') {
      errors.push({ kind: 'scoring', id: point.scoring_point_id, message: '原子评分点尚未映射' });
      continue;
    }
    if (!point.mapped_node_ids.length || !point.primary_node_id) {
      errors.push({ kind: 'scoring', id: point.scoring_point_id, message: '原子评分点缺少唯一主负责目录节点' });
      continue;
    }
    const primaryNode = nodesById.get(point.primary_node_id);
    const primaryRequirementIds = Array.isArray(primaryNode?.item?.primary_requirement_ids)
      ? primaryNode.item.primary_requirement_ids.map((value) => String(value || '').trim())
      : [];
    const isManualPrimaryResponse = primaryNode?.item?.manual_input_required === true
      && primaryRequirementIds.includes(point.group_requirement_id);
    if (!primaryNode || (primaryNode.level < 2 && !isManualPrimaryResponse)) {
      errors.push({ kind: 'scoring', id: point.scoring_point_id, message: '原子评分点必须映射至二级及以下目录节点，或映射至直接对应的人工固定表格主承载节点' });
    }
    if (!point.high_score_conditions.length) {
      errors.push({ kind: 'scoring', id: point.scoring_point_id, message: '原子评分点缺少高分响应条件' });
    }
  }

  for (const risk of normalized.rejection_risks) {
    if (risk.status === 'unhandled') {
      errors.push({ kind: 'risk', id: risk.risk_id, message: '否决或高风险项尚未形成处理状态' });
    }
    if (['outline', 'content'].includes(risk.handling_route) && !risk.mapped_node_ids.length) {
      errors.push({ kind: 'risk', id: risk.risk_id, message: '需由目录或正文处理的风险缺少映射节点' });
    }
    if (risk.status === 'needs-confirmation') {
      warnings.push({ kind: 'risk', id: risk.risk_id, message: '高风险项待人工确认' });
    }
  }

  for (const requirement of normalized.hidden_requirements) {
    if (requirement.status === 'unhandled') {
      errors.push({ kind: 'hidden', id: requirement.hidden_requirement_id, message: '隐性要求尚未形成处理状态' });
    }
    if (['outline', 'content'].includes(requirement.handling_route) && !requirement.mapped_node_ids.length) {
      errors.push({ kind: 'hidden', id: requirement.hidden_requirement_id, message: '需由目录或正文处理的隐性要求缺少映射节点' });
    }
    if (requirement.status === 'needs-confirmation') {
      warnings.push({ kind: 'hidden', id: requirement.hidden_requirement_id, message: '隐性要求待人工确认' });
    }
  }

  return {
    can_proceed: errors.length === 0,
    errors,
    warnings,
    scoring_summary: {
      total: normalized.scoring_points.length,
      mapped: normalized.scoring_points.filter((point) => point.status !== 'unmapped').length,
      unmapped: normalized.scoring_points.filter((point) => point.status === 'unmapped').length,
    },
    risk_summary: {
      total: normalized.rejection_risks.length,
      covered: normalized.rejection_risks.filter((risk) => risk.status === 'covered').length,
      needs_confirmation: normalized.rejection_risks.filter((risk) => risk.status === 'needs-confirmation').length,
      unhandled: normalized.rejection_risks.filter((risk) => risk.status === 'unhandled').length,
    },
    hidden_requirement_summary: {
      total: normalized.hidden_requirements.length,
      covered: normalized.hidden_requirements.filter((item) => item.status === 'covered').length,
      needs_confirmation: normalized.hidden_requirements.filter((item) => item.status === 'needs-confirmation').length,
      unhandled: normalized.hidden_requirements.filter((item) => item.status === 'unhandled').length,
    },
  };
}

module.exports = {
  flattenOutline,
  getDirectoryEligibleValueAnchors,
  validateRequirementResponseMatrix,
};
