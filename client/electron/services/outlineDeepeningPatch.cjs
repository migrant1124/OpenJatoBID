const { normalizeOutlineQualityMetadata } = require('./technicalPlanQualityModel.cjs');
const { applyOutlineQualityRules } = require('./outlineQualityRules.cjs');

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
}

function optionalString(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredString(value, label);
}

function uniqueStrings(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
  return [...new Set(value.map((item) => requiredString(item, label)))];
}

function walkOutline(items, level = 1, parentId = null, rows = []) {
  for (const item of items || []) {
    if (!item?.id) continue;
    rows.push({ item, id: String(item.id), level, parentId });
    walkOutline(item.children, level + 1, String(item.id), rows);
  }
  return rows;
}

function findRow(outlineData, nodeId) {
  return walkOutline(outlineData?.outline || []).find((row) => row.id === nodeId) || null;
}

function findItem(items, nodeId) {
  for (const item of items || []) {
    if (String(item.id) === nodeId) return item;
    const child = findItem(item.children, nodeId);
    if (child) return child;
  }
  return null;
}

function collectSubtreeIds(item, ids = new Set()) {
  if (!item?.id) return ids;
  ids.add(String(item.id));
  for (const child of item.children || []) collectSubtreeIds(child, ids);
  return ids;
}

function isAiChildBlocked(item) {
  return item?.manual_input_required === true
    || item?.allow_ai_children === false
    || ['fixed-markdown-table', 'locked-commitment', 'evidence-markdown', 'explicit-none'].includes(item?.response_mode);
}

function normalizeUpdate(value, index) {
  if (!isObject(value)) throw new Error(`updates[${index}] 必须是对象`);
  if (Object.prototype.hasOwnProperty.call(value, 'title') || Object.prototype.hasOwnProperty.call(value, 'children')) {
    throw new Error('局部深化 Patch 不允许修改既有标题或返回 children');
  }
  const normalized = { node_id: requiredString(value.node_id, `updates[${index}].node_id`) };
  const description = optionalString(value.description, `updates[${index}].description`);
  if (description !== undefined) normalized.description = description;
  const qualityFields = [
    'deep_writing', 'deep_writing_recommended', 'deep_writing_reason', 'deep_writing_source',
    'writing_profile', 'value_anchor_ids', 'mapped_scoring_point_ids',
  ];
  if (qualityFields.some((field) => Object.prototype.hasOwnProperty.call(value, field))) {
    normalized.quality_metadata = normalizeOutlineQualityMetadata(value);
  }
  return normalized;
}

function normalizeAddition(value, index) {
  if (!isObject(value)) throw new Error(`additions[${index}] 必须是对象`);
  if (Object.prototype.hasOwnProperty.call(value, 'id') || Object.prototype.hasOwnProperty.call(value, 'children')) {
    throw new Error('局部深化 Patch 新增节点不得指定正式 ID 或返回 children');
  }
  const normalized = {
    parent_id: requiredString(value.parent_id, `additions[${index}].parent_id`),
    title: requiredString(value.title, `additions[${index}].title`),
    description: optionalString(value.description, `additions[${index}].description`) || requiredString(value.title, `additions[${index}].title`),
  };
  const clientId = optionalString(value.client_id, `additions[${index}].client_id`);
  if (clientId !== undefined) normalized.client_id = clientId;
  return normalized;
}

function normalizeOutlineDeepeningPatch(value) {
  if (!isObject(value)) throw new Error('OutlineDeepeningPatch 必须是对象');
  const schemaVersion = Number(value.schema_version || 1);
  if (schemaVersion !== 1) throw new Error('OutlineDeepeningPatch.schema_version 必须为 1');
  if (value.deep_writing !== true) throw new Error('局部深化 Patch 必须开启 deep_writing');
  return {
    schema_version: 1,
    target_node_id: requiredString(value.target_node_id, 'target_node_id'),
    deep_writing: true,
    writing_profile: value.writing_profile === 'creative-proposal' ? 'creative-proposal' : 'deep',
    deep_writing_reason: optionalString(value.deep_writing_reason, 'deep_writing_reason'),
    value_anchor_ids: uniqueStrings(value.value_anchor_ids, 'value_anchor_ids'),
    mapped_scoring_point_ids: uniqueStrings(value.mapped_scoring_point_ids, 'mapped_scoring_point_ids'),
    updates: Array.isArray(value.updates) ? value.updates.map(normalizeUpdate) : [],
    additions: Array.isArray(value.additions) ? value.additions.map(normalizeAddition) : [],
  };
}

function createAddedNodeId(parent, existingIds) {
  const prefix = `${parent.id}.`;
  let index = (parent.children || []).length + 1;
  while (existingIds.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function assertExistingSubtreePreserved(beforeTarget, afterTarget) {
  const afterRows = new Map(walkOutline([afterTarget]).map((row) => [row.id, row]));
  for (const beforeRow of walkOutline([beforeTarget])) {
    const afterRow = afterRows.get(beforeRow.id);
    if (!afterRow || afterRow.item.title !== beforeRow.item.title || afterRow.parentId !== beforeRow.parentId) {
      throw new Error(`局部深化不得删除、移动或改名既有目录节点：${beforeRow.id}`);
    }
  }
}

function assertOutsideSubtreeUnchanged(beforeOutline, afterOutline, targetNodeId) {
  const beforeRows = walkOutline(beforeOutline?.outline || []);
  const afterRows = new Map(walkOutline(afterOutline?.outline || []).map((row) => [row.id, row]));
  const targetIds = collectSubtreeIds(findItem(beforeOutline?.outline || [], targetNodeId));
  for (const beforeRow of beforeRows) {
    if (targetIds.has(beforeRow.id)) continue;
    const afterRow = afterRows.get(beforeRow.id);
    if (!afterRow
      || afterRow.parentId !== beforeRow.parentId
      || afterRow.item.title !== beforeRow.item.title
      || afterRow.item.description !== beforeRow.item.description
      || afterRow.item.content !== beforeRow.item.content) {
      throw new Error('局部深化不得修改目标二级子树之外的目录或正文');
    }
  }
}

function buildDiff(beforeOutline, afterOutline, targetNodeId) {
  const beforeRows = new Map(walkOutline(beforeOutline?.outline || []).map((row) => [row.id, row]));
  const afterRows = walkOutline(afterOutline?.outline || []);
  const addedNodeIds = afterRows.filter((row) => !beforeRows.has(row.id)).map((row) => row.id);
  const descriptionUpdates = afterRows
    .filter((row) => beforeRows.has(row.id) && beforeRows.get(row.id).item.description !== row.item.description)
    .map((row) => row.id);
  const beforeTarget = findItem(beforeOutline?.outline || [], targetNodeId);
  const afterTarget = findItem(afterOutline?.outline || [], targetNodeId);
  return {
    target_node_id: targetNodeId,
    added_node_ids: addedNodeIds,
    description_updated_node_ids: descriptionUpdates,
    deep_writing_changed: beforeTarget?.deep_writing !== afterTarget?.deep_writing,
    mapped_scoring_point_ids: afterTarget?.mapped_scoring_point_ids || [],
    value_anchor_ids: afterTarget?.value_anchor_ids || [],
    affected_node_ids: [...collectSubtreeIds(afterTarget)],
  };
}

function applyOutlineDeepeningPatch({ outlineData, requirementResponseMatrix, patch, outlineExpansionMode, allowAiValueAdditions }) {
  const normalizedPatch = normalizeOutlineDeepeningPatch(patch);
  const beforeOutline = clone(outlineData);
  const beforeTargetRow = findRow(beforeOutline, normalizedPatch.target_node_id);
  if (!beforeTargetRow || beforeTargetRow.level !== 2) throw new Error('AI 深化本节只能选择真实的二级目录');
  if (isAiChildBlocked(beforeTargetRow.item)) throw new Error('当前二级目录为受控、固定或人工填写节点，不能执行 AI 深化');
  if (outlineExpansionMode === 'original-only' && !allowAiValueAdditions && normalizedPatch.additions.length) {
    throw new Error('仅参考原方案模式下需先明确允许 AI 增值深化，才可新增目录标题');
  }

  const nextOutline = clone(outlineData);
  const target = findItem(nextOutline.outline, normalizedPatch.target_node_id);
  const originalTargetIds = collectSubtreeIds(beforeTargetRow.item);
  const existingIds = new Set(walkOutline(nextOutline.outline).map((row) => row.id));
  const matrixPointIds = new Set((requirementResponseMatrix?.scoring_points || []).map((point) => point.scoring_point_id));
  const acceptedAnchorIds = new Set((requirementResponseMatrix?.value_anchors || [])
    .filter((anchor) => anchor.status === 'accepted').map((anchor) => anchor.anchor_id));
  const originalMappedPointIds = new Set(beforeTargetRow.item.mapped_scoring_point_ids || []);
  const originalAnchorIds = new Set(beforeTargetRow.item.value_anchor_ids || []);

  const applyTargetQuality = (metadata) => {
    const merged = normalizeOutlineQualityMetadata({
      ...target,
      ...metadata,
      deep_writing: true,
      deep_writing_recommended: target.deep_writing_recommended === true,
      deep_writing_source: 'ai',
      writing_profile: metadata.writing_profile || normalizedPatch.writing_profile,
      deep_writing_reason: metadata.deep_writing_reason || normalizedPatch.deep_writing_reason || target.deep_writing_reason || 'AI 深化本节目录',
      value_anchor_ids: metadata.value_anchor_ids || normalizedPatch.value_anchor_ids || target.value_anchor_ids,
      mapped_scoring_point_ids: metadata.mapped_scoring_point_ids || normalizedPatch.mapped_scoring_point_ids || target.mapped_scoring_point_ids,
    });
    for (const pointId of merged.mapped_scoring_point_ids) {
      if (!matrixPointIds.has(pointId) || !originalMappedPointIds.has(pointId)) {
        throw new Error(`局部深化不能迁移其他二级目录的评分点：${pointId}`);
      }
    }
    for (const anchorId of merged.value_anchor_ids) {
      if (!acceptedAnchorIds.has(anchorId) || (!originalAnchorIds.has(anchorId) && !acceptedAnchorIds.has(anchorId))) {
        throw new Error(`局部深化只能引用已确认的增值锚点：${anchorId}`);
      }
    }
    Object.assign(target, merged);
  };

  applyTargetQuality({
    writing_profile: normalizedPatch.writing_profile,
    deep_writing_reason: normalizedPatch.deep_writing_reason,
    value_anchor_ids: normalizedPatch.value_anchor_ids.length ? normalizedPatch.value_anchor_ids : target.value_anchor_ids,
    mapped_scoring_point_ids: normalizedPatch.mapped_scoring_point_ids.length ? normalizedPatch.mapped_scoring_point_ids : target.mapped_scoring_point_ids,
  });

  for (const update of normalizedPatch.updates) {
    if (!originalTargetIds.has(update.node_id)) throw new Error(`Patch 更新越过目标子树：${update.node_id}`);
    const item = findItem(nextOutline.outline, update.node_id);
    if (!item || (update.node_id !== target.id && update.quality_metadata)) {
      throw new Error('仅目标二级目录可以更新深度写作、评分点或增值锚点元数据');
    }
    if (isAiChildBlocked(item) || item.title_locked || item.order_locked || item.level_locked) {
      throw new Error(`受保护节点不能被 AI 修改：${update.node_id}`);
    }
    if (update.description !== undefined) item.description = update.description;
    if (update.quality_metadata) applyTargetQuality(update.quality_metadata);
  }

  const clientIdMap = new Map();
  for (const addition of normalizedPatch.additions) {
    const parentId = clientIdMap.get(addition.parent_id) || addition.parent_id;
    const parent = findItem(nextOutline.outline, parentId);
    if (!parent || !collectSubtreeIds(target).has(parentId)) throw new Error(`Patch 新增节点越过目标子树：${addition.parent_id}`);
    if (isAiChildBlocked(parent)) throw new Error(`受保护节点不能新增子目录：${parentId}`);
    const parentLevel = findRow(nextOutline, parentId)?.level || 0;
    if (parentLevel >= 5) throw new Error('局部深化新增目录不能超过第五级');
    const titleKey = addition.title.replace(/\s+/gu, '').toLowerCase();
    if ((parent.children || []).some((item) => item.title.replace(/\s+/gu, '').toLowerCase() === titleKey)) {
      throw new Error(`新增目录与同级标题重复：${addition.title}`);
    }
    const id = createAddedNodeId(parent, existingIds);
    existingIds.add(id);
    const item = { id, title: addition.title, description: addition.description };
    parent.children = [...(parent.children || []), item];
    if (addition.client_id) {
      if (clientIdMap.has(addition.client_id)) throw new Error(`Patch 新增节点 client_id 重复：${addition.client_id}`);
      clientIdMap.set(addition.client_id, id);
    }
  }

  assertExistingSubtreePreserved(beforeTargetRow.item, target);
  const quality = applyOutlineQualityRules(nextOutline, requirementResponseMatrix);
  assertOutsideSubtreeUnchanged(beforeOutline, quality.outline, normalizedPatch.target_node_id);
  return {
    outlineData: quality.outline,
    requirementResponseMatrix: quality.matrix,
    outlineQualityReview: quality.review,
    patch: normalizedPatch,
    diff: buildDiff(beforeOutline, quality.outline, normalizedPatch.target_node_id),
  };
}

module.exports = {
  applyOutlineDeepeningPatch,
  normalizeOutlineDeepeningPatch,
  walkOutline,
};
