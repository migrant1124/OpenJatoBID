class OutlineFormatConstraintError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'OutlineFormatConstraintError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const FORMAT_STRENGTHS = new Set(['strict', 'fixed-roots', 'none']);
const NUMBERING_POLICIES = new Set(['auto', 'preserve-source', 'none']);
const RESPONSE_MODES = new Set([
  'freeform-markdown',
  'fixed-markdown-table',
  'locked-commitment',
  'evidence-markdown',
  'container',
  'explicit-none',
]);
const LOCKED_CONSTRAINT_FIELDS = [
  'format_node_id',
  'source_number',
  'source_title',
  'numbering_policy',
  'required_in_outline',
  'response_required',
  'title_locked',
  'order_locked',
  'level_locked',
  'response_mode',
  'allow_ai_children',
  'template_id',
  'empty_response_text',
  'missing_evidence_risk',
];

function fail(code, message, details) {
  throw new OutlineFormatConstraintError(code, message, details);
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function uniqueStrings(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail('INVALID_OUTLINE', `${label} 必须是字符串数组`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeComparable(value) {
  return nonEmptyString(value).replace(/\s+/gu, '').toLocaleLowerCase('zh-CN');
}

function intersects(left, right) {
  const values = new Set((right || []).map(normalizeComparable).filter(Boolean));
  return (left || []).some((item) => values.has(normalizeComparable(item)));
}

function matchSingleDimension(profileId, profileTitle, currentId, currentTitle) {
  const wantedId = nonEmptyString(profileId);
  const wantedTitle = nonEmptyString(profileTitle);
  if (!wantedId && !wantedTitle) return { matched: true, specific: false, idMatched: false };

  const actualId = nonEmptyString(currentId);
  const actualTitle = nonEmptyString(currentTitle);
  if (wantedId && actualId) {
    return { matched: wantedId === actualId, specific: true, idMatched: wantedId === actualId };
  }
  if (wantedTitle && actualTitle) {
    return { matched: normalizeComparable(wantedTitle) === normalizeComparable(actualTitle), specific: true, idMatched: false };
  }
  return { matched: false, specific: true, idMatched: false };
}

function matchPackageDimension(profileScope, currentScope) {
  const wantedIds = Array.isArray(profileScope.package_ids) ? profileScope.package_ids.filter(nonEmptyString) : [];
  const wantedNames = Array.isArray(profileScope.package_names) ? profileScope.package_names.filter(nonEmptyString) : [];
  if (!wantedIds.length && !wantedNames.length) return { matched: true, specific: false, idMatched: false };

  const actualIds = Array.isArray(currentScope.package_ids) ? currentScope.package_ids.filter(nonEmptyString) : [];
  const actualNames = Array.isArray(currentScope.package_names) ? currentScope.package_names.filter(nonEmptyString) : [];
  if (wantedIds.length && actualIds.length) {
    const matched = intersects(wantedIds, actualIds);
    return { matched, specific: true, idMatched: matched };
  }
  if (wantedNames.length && actualNames.length) {
    return { matched: intersects(wantedNames, actualNames), specific: true, idMatched: false };
  }
  return { matched: false, specific: true, idMatched: false };
}

function assertTechnicalProfile(profile, index) {
  if (!isObject(profile)) fail('INVALID_FORMAT_RESULT', `profiles[${index}] 不是对象`);
  if (!nonEmptyString(profile.profile_id)) fail('INVALID_FORMAT_RESULT', `profiles[${index}].profile_id 不能为空`);
  if (!isObject(profile.applicable_scope) || profile.applicable_scope.document_type !== 'technical') {
    fail('INVALID_FORMAT_PROFILE_TYPE', '格式方案只允许 technical 文档类型');
  }
  if (!FORMAT_STRENGTHS.has(profile.format_strength)) {
    fail('INVALID_FORMAT_RESULT', `格式方案 ${profile.profile_id} 的 format_strength 无效`);
  }
  if (!Array.isArray(profile.outline)) fail('INVALID_FORMAT_RESULT', `格式方案 ${profile.profile_id} 缺少 outline`);
}

function matchProfile(profile, currentScope) {
  if (!isObject(currentScope) || currentScope.document_type !== 'technical') {
    fail('INVALID_CURRENT_SCOPE', '当前投标范围必须是 technical');
  }
  const section = matchSingleDimension(
    profile.applicable_scope.section_id,
    profile.applicable_scope.section_title,
    currentScope.section_id,
    currentScope.section_title,
  );
  const packages = matchPackageDimension(profile.applicable_scope, currentScope);
  return {
    matched: section.matched && packages.matched,
    specificity: Number(section.specific) + Number(packages.specific),
    idMatches: Number(section.idMatched) + Number(packages.idMatched),
  };
}

function isGlobalNoneProfile(profile) {
  const scope = profile.applicable_scope || {};
  return profile.format_strength === 'none'
    && !nonEmptyString(scope.section_id)
    && !nonEmptyString(scope.section_title)
    && (!Array.isArray(scope.package_ids) || scope.package_ids.length === 0)
    && (!Array.isArray(scope.package_names) || scope.package_names.length === 0);
}

function selectApplicableFormatProfile(result, currentScope, explicitProfileId) {
  if (!isObject(result) || typeof result.has_explicit_technical_format !== 'boolean' || !Array.isArray(result.profiles)) {
    fail('INVALID_FORMAT_RESULT', '投标文件格式解析结果无效');
  }
  result.profiles.forEach(assertTechnicalProfile);

  if (!result.has_explicit_technical_format) {
    if (result.profiles.length !== 1 || !isGlobalNoneProfile(result.profiles[0])) {
      fail('INVALID_FORMAT_RESULT', '未发现明确格式时必须且只能提供一个全局 technical/none 方案');
    }
    if (explicitProfileId && explicitProfileId !== result.profiles[0].profile_id) {
      fail('FORMAT_PROFILE_NOT_FOUND', '指定的格式方案不存在');
    }
    return result.profiles[0];
  }

  if (!result.profiles.some((profile) => profile.format_strength === 'strict' || profile.format_strength === 'fixed-roots')) {
    fail('INVALID_FORMAT_RESULT', '明确格式结果至少需要一个 strict 或 fixed-roots 方案');
  }
  if (result.profiles.some((profile) => profile.format_strength === 'none' && isGlobalNoneProfile(profile))) {
    fail('INVALID_FORMAT_RESULT', '明确格式结果中的 none 方案必须绑定明确投标范围，不能使用全局回退');
  }

  if (explicitProfileId) {
    const selected = result.profiles.find((profile) => profile.profile_id === explicitProfileId);
    if (!selected) fail('FORMAT_PROFILE_NOT_FOUND', '指定的格式方案不存在');
    if (!matchProfile(selected, currentScope).matched) {
      fail('FORMAT_PROFILE_NOT_APPLICABLE', '指定的格式方案不适用于当前投标范围');
    }
    return selected;
  }

  const matches = result.profiles
    .map((profile) => ({ profile, ...matchProfile(profile, currentScope) }))
    .filter((entry) => entry.matched);
  if (!matches.length) {
    fail('FORMAT_PROFILE_NOT_FOUND', '未找到当前投标范围的适用格式方案，请人工选择');
  }
  const bestSpecificity = Math.max(...matches.map((entry) => entry.specificity));
  const mostSpecific = matches.filter((entry) => entry.specificity === bestSpecificity);
  const bestIdMatches = Math.max(...mostSpecific.map((entry) => entry.idMatches));
  const best = mostSpecific.filter((entry) => entry.idMatches === bestIdMatches);
  if (best.length !== 1) {
    fail('FORMAT_PROFILE_AMBIGUOUS', '当前投标范围存在多个格式方案，请先选择', {
      profileIds: best.map((entry) => entry.profile.profile_id),
    });
  }
  return best[0].profile;
}

function stripSourceNumber(title, sourceNumber) {
  const value = nonEmptyString(title);
  const prefix = nonEmptyString(sourceNumber);
  if (!value || !prefix || !value.startsWith(prefix)) return value;
  const remainder = value.slice(prefix.length);
  if (!remainder || /^[\s、，,。.．:：;；)）\-—]/u.test(remainder)) {
    return remainder.replace(/^[\s、，,。.．:：;；)）\-—]+/u, '').trim();
  }
  return value;
}

function assertFormatNode(node, path) {
  if (!isObject(node)) fail('INVALID_FORMAT_PROFILE', `${path} 不是对象`);
  if (!nonEmptyString(node.format_node_id)) fail('INVALID_FORMAT_PROFILE', `${path}.format_node_id 不能为空`);
  if (!nonEmptyString(node.source_title)) fail('INVALID_FORMAT_PROFILE', `${path}.source_title 不能为空`);
  if (!NUMBERING_POLICIES.has(node.numbering_policy)) fail('INVALID_FORMAT_PROFILE', `${path}.numbering_policy 无效`);
  if (!RESPONSE_MODES.has(node.response_mode)) fail('INVALID_FORMAT_PROFILE', `${path}.response_mode 无效`);
  if (!Array.isArray(node.children)) fail('INVALID_FORMAT_PROFILE', `${path}.children 必须是数组`);
  if (node.numbering_policy === 'preserve-source' && !nonEmptyString(node.source_number)) {
    fail('INVALID_FORMAT_PROFILE', `${path} 使用 preserve-source 时必须有 source_number`);
  }
  if ((node.response_mode === 'locked-commitment' || node.response_mode === 'fixed-markdown-table') && !nonEmptyString(node.template_id)) {
    fail('INVALID_FORMAT_PROFILE', `${path} 的受控响应缺少 template_id`);
  }
}

function instantiateNode(node, id, seenFormatIds) {
  assertFormatNode(node, `format node ${id}`);
  if (seenFormatIds.has(node.format_node_id)) fail('INVALID_FORMAT_PROFILE', 'format_node_id 重复');
  seenFormatIds.add(node.format_node_id);
  const sourceTitle = stripSourceNumber(node.source_title, node.source_number);
  const forceRequired = /如有/u.test(sourceTitle) || /^(其他|其它)(?:$|[（(：:])/u.test(sourceTitle);
  return {
    id,
    title: sourceTitle,
    description: nonEmptyString(node.description),
    format_node_id: node.format_node_id,
    ...(nonEmptyString(node.source_number) ? { source_number: nonEmptyString(node.source_number) } : {}),
    source_title: sourceTitle,
    numbering_policy: node.numbering_policy,
    required_in_outline: forceRequired ? true : Boolean(node.required_in_outline),
    response_required: forceRequired ? true : Boolean(node.response_required),
    title_locked: Boolean(node.title_locked),
    order_locked: Boolean(node.order_locked),
    level_locked: Boolean(node.level_locked),
    response_mode: node.response_mode,
    allow_ai_children: Boolean(node.allow_ai_children),
    ...(nonEmptyString(node.template_id) ? { template_id: nonEmptyString(node.template_id) } : {}),
    ...(nonEmptyString(node.empty_response_text) ? { empty_response_text: nonEmptyString(node.empty_response_text) } : {}),
    ...(node.missing_evidence_risk ? { missing_evidence_risk: node.missing_evidence_risk } : {}),
    mapped_requirement_ids: [],
    knowledge_item_ids: [],
    response_status: ['locked-commitment', 'fixed-markdown-table'].includes(node.response_mode)
      ? 'needs-manual-input'
      : 'pending',
    compliance_risk: 'none',
    content: '',
    children: node.children.map((child, index) => instantiateNode(child, `${id}.${index + 1}`, seenFormatIds)),
  };
}

function instantiateFormatOutline(profile) {
  assertTechnicalProfile(profile, 0);
  if (profile.format_strength === 'none') return { outline: [] };
  const seenFormatIds = new Set();
  return {
    outline: profile.outline.map((node, index) => instantiateNode(node, String(index + 1), seenFormatIds)),
  };
}

function outlineItems(value) {
  if (Array.isArray(value)) return value;
  if (isObject(value) && Array.isArray(value.outline)) return value.outline;
  fail('INVALID_OUTLINE', '目录必须是数组或包含 outline 数组的对象');
}

function buildFixedIndex(items, parentFormatId = null, level = 1, index = new Map()) {
  for (const item of items) {
    if (item.format_node_id) {
      if (index.has(item.format_node_id)) fail('INVALID_OUTLINE', `目录中 format_node_id 重复：${item.format_node_id}`);
      index.set(item.format_node_id, { item, parentFormatId, level });
      buildFixedIndex(item.children || [], item.format_node_id, level + 1, index);
    }
  }
  return index;
}

function sameValue(left, right) {
  return (left === undefined ? null : left) === (right === undefined ? null : right);
}

function validateAdditionalSubtree(item, path) {
  if (!isObject(item)) fail('INVALID_OUTLINE', `${path} 不是对象`);
  if (item.format_node_id) fail('FORMAT_GATE_FAILED', `${path} 的新增节点不得伪造 format_node_id`);
  if (!nonEmptyString(item.title)) fail('INVALID_OUTLINE', `${path}.title 不能为空`);
  uniqueStrings(item.mapped_requirement_ids, `${path}.mapped_requirement_ids`);
  const children = item.children === undefined ? [] : item.children;
  if (!Array.isArray(children)) fail('INVALID_OUTLINE', `${path}.children 必须是数组`);
  children.forEach((child, index) => validateAdditionalSubtree(child, `${path}.children[${index}]`));
}

function collectMappedRequirementIds(items, target = new Set()) {
  for (const item of items) {
    uniqueStrings(item.mapped_requirement_ids, `节点 ${item.id || item.title}.mapped_requirement_ids`).forEach((id) => target.add(id));
    collectMappedRequirementIds(item.children || [], target);
  }
  return target;
}

function expectedCoverage(options) {
  if (!options || !options.requireScoreCoverage) return [];
  if (Array.isArray(options.requireScoreCoverage) || options.requireScoreCoverage instanceof Set) {
    return uniqueStrings([...options.requireScoreCoverage], 'requireScoreCoverage');
  }
  if (options.requireScoreCoverage === true) {
    return uniqueStrings(options.requirementIds, 'requirementIds');
  }
  fail('INVALID_COVERAGE_OPTIONS', 'requireScoreCoverage 必须为布尔值、数组或 Set');
}

function validateFormatOutline(candidate, profile, options = {}) {
  assertTechnicalProfile(profile, 0);
  const candidateItems = outlineItems(candidate);
  if (profile.format_strength === 'none') {
    candidateItems.forEach((item, index) => validateAdditionalSubtree(item, `outline[${index}]`));
  } else {
    const expected = instantiateFormatOutline(profile).outline;
    const expectedIndex = buildFixedIndex(expected);
    const actualIndex = buildFixedIndex(candidateItems);

    for (const [formatNodeId, expectedEntry] of expectedIndex) {
      const actualEntry = actualIndex.get(formatNodeId);
      if (!actualEntry) {
        if (expectedEntry.item.required_in_outline) fail('FORMAT_GATE_FAILED', `固定目录节点缺失：${expectedEntry.item.title}`);
        continue;
      }
      if (actualEntry.parentFormatId !== expectedEntry.parentFormatId || actualEntry.level !== expectedEntry.level) {
        fail('FORMAT_GATE_FAILED', `固定目录节点层级被修改：${expectedEntry.item.title}`);
      }
      if (actualEntry.item.title !== expectedEntry.item.title) {
        fail('FORMAT_GATE_FAILED', `固定目录节点标题被修改：${expectedEntry.item.title}`);
      }
      for (const field of LOCKED_CONSTRAINT_FIELDS) {
        if (!sameValue(actualEntry.item[field], expectedEntry.item[field])) {
          fail('FORMAT_GATE_FAILED', `固定目录节点字段被修改：${expectedEntry.item.title}.${field}`);
        }
      }
    }
    for (const formatNodeId of actualIndex.keys()) {
      if (!expectedIndex.has(formatNodeId)) fail('FORMAT_GATE_FAILED', `出现未知 format_node_id：${formatNodeId}`);
    }

    function inspectSiblings(actualChildren, expectedChildren, parent) {
      for (let expectedIndexValue = 0; expectedIndexValue < expectedChildren.length; expectedIndexValue += 1) {
        const expectedChild = expectedChildren[expectedIndexValue];
        if (!expectedChild.order_locked) continue;
        const actualIndexValue = actualChildren.findIndex((item) => item.format_node_id === expectedChild.format_node_id);
        if (actualIndexValue >= 0 && actualIndexValue !== expectedIndexValue) {
          fail('FORMAT_GATE_FAILED', `固定目录节点顺序被修改${parent ? `：${parent.title}` : ''}`);
        }
      }
      const expectedById = new Map(expectedChildren.map((item) => [item.format_node_id, item]));
      for (let index = 0; index < actualChildren.length; index += 1) {
        const child = actualChildren[index];
        if (child.format_node_id) {
          const expectedChild = expectedById.get(child.format_node_id);
          inspectSiblings(child.children || [], expectedChild?.children || [], child);
        } else {
          if (!parent) fail('FORMAT_GATE_FAILED', '不得新增并列顶级目录');
          if (!parent.allow_ai_children) fail('FORMAT_GATE_FAILED', `固定目录不允许新增子目录：${parent.title}`);
          validateAdditionalSubtree(child, `新增目录 ${child.title || index + 1}`);
        }
      }
    }
    inspectSiblings(candidateItems, expected, null);
  }

  const mapped = collectMappedRequirementIds(candidateItems);
  const requiredIds = expectedCoverage(options);
  const missing = requiredIds.filter((id) => !mapped.has(id));
  if (missing.length) fail('SCORE_COVERAGE_FAILED', `技术评分要求覆盖不足：${missing.join('、')}`, { missingRequirementIds: missing });
  return { valid: true, mappedRequirementIds: [...mapped], missingRequirementIds: [] };
}

function findNode(items, selector, parent = null) {
  for (const item of items) {
    if (selector(item)) return { item, parent };
    const found = findNode(item.children || [], selector, item);
    if (found) return found;
  }
  return null;
}

function isInMutableRegion(entry) {
  if (!entry) return false;
  if (!entry.item.format_node_id) return true;
  return entry.item.allow_ai_children === true;
}

function nextChildId(parent) {
  const base = nonEmptyString(parent.id) || 'node';
  const used = new Set((parent.children || []).map((child) => nonEmptyString(child.id)).filter(Boolean));
  let index = (parent.children || []).length + 1;
  while (used.has(`${base}.${index}`)) index += 1;
  return `${base}.${index}`;
}

function createAdditionalNode(raw, id, path) {
  if (!isObject(raw)) fail('INVALID_CONTROLLED_PATCH', `${path} 不是对象`);
  const allowed = new Set(['title', 'description', 'mapped_requirement_ids', 'children']);
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) fail('INVALID_CONTROLLED_PATCH', `${path} 不允许修改字段 ${field}`);
  }
  const title = nonEmptyString(raw.title);
  if (!title) fail('INVALID_CONTROLLED_PATCH', `${path}.title 不能为空`);
  const node = {
    id,
    title,
    description: nonEmptyString(raw.description),
    numbering_policy: 'auto',
    required_in_outline: false,
    response_required: true,
    title_locked: false,
    order_locked: false,
    level_locked: false,
    response_mode: 'freeform-markdown',
    allow_ai_children: true,
    mapped_requirement_ids: uniqueStrings(raw.mapped_requirement_ids, `${path}.mapped_requirement_ids`),
    knowledge_item_ids: [],
    response_status: 'pending',
    compliance_risk: 'none',
    content: '',
    children: [],
  };
  const children = raw.children === undefined ? [] : raw.children;
  if (!Array.isArray(children)) fail('INVALID_CONTROLLED_PATCH', `${path}.children 必须是数组`);
  node.children = children.map((child, index) => createAdditionalNode(child, `${id}.${index + 1}`, `${path}.children[${index}]`));
  return node;
}

function applyControlledOutlinePatch(base, patch, profile) {
  const next = { outline: clone(outlineItems(base)) };
  validateFormatOutline(next, profile);
  if (!isObject(patch)) fail('INVALID_CONTROLLED_PATCH', '受控目录 patch 必须是对象');
  const allowedRootFields = new Set(['updates', 'additions']);
  for (const field of Object.keys(patch)) {
    if (!allowedRootFields.has(field)) fail('INVALID_CONTROLLED_PATCH', `受控目录 patch 不允许字段 ${field}`);
  }
  const updates = patch.updates === undefined ? [] : patch.updates;
  const additions = patch.additions === undefined ? [] : patch.additions;
  if (!Array.isArray(updates) || !Array.isArray(additions)) fail('INVALID_CONTROLLED_PATCH', 'updates 和 additions 必须是数组');

  updates.forEach((rawUpdate, index) => {
    if (!isObject(rawUpdate)) fail('INVALID_CONTROLLED_PATCH', `updates[${index}] 不是对象`);
    const allowed = new Set(['node_id', 'format_node_id', 'description', 'mapped_requirement_ids']);
    for (const field of Object.keys(rawUpdate)) {
      if (!allowed.has(field)) fail('INVALID_CONTROLLED_PATCH', `updates[${index}] 不允许修改字段 ${field}`);
    }
    const nodeId = nonEmptyString(rawUpdate.node_id);
    const formatNodeId = nonEmptyString(rawUpdate.format_node_id);
    if ((!nodeId && !formatNodeId) || (nodeId && formatNodeId)) {
      fail('INVALID_CONTROLLED_PATCH', `updates[${index}] 必须且只能提供 node_id 或 format_node_id`);
    }
    const entry = findNode(next.outline, (item) => (nodeId ? item.id === nodeId : item.format_node_id === formatNodeId));
    if (!entry) fail('INVALID_CONTROLLED_PATCH', `updates[${index}] 的目标节点不存在`);
    if (!Object.prototype.hasOwnProperty.call(rawUpdate, 'description')
      && !Object.prototype.hasOwnProperty.call(rawUpdate, 'mapped_requirement_ids')) {
      fail('INVALID_CONTROLLED_PATCH', `updates[${index}] 没有可应用的字段`);
    }
    if (Object.prototype.hasOwnProperty.call(rawUpdate, 'description')) {
      if (!isInMutableRegion(entry)) fail('FORMAT_GATE_FAILED', `该固定目录不允许 AI 修改描述：${entry.item.title}`);
      if (typeof rawUpdate.description !== 'string') fail('INVALID_CONTROLLED_PATCH', `updates[${index}].description 必须是字符串`);
      entry.item.description = rawUpdate.description.trim();
    }
    if (Object.prototype.hasOwnProperty.call(rawUpdate, 'mapped_requirement_ids')) {
      entry.item.mapped_requirement_ids = uniqueStrings(rawUpdate.mapped_requirement_ids, `updates[${index}].mapped_requirement_ids`);
    }
  });

  additions.forEach((rawAddition, index) => {
    if (!isObject(rawAddition)) fail('INVALID_CONTROLLED_PATCH', `additions[${index}] 不是对象`);
    const allowed = new Set(['parent_id', 'parent_format_node_id', 'node']);
    for (const field of Object.keys(rawAddition)) {
      if (!allowed.has(field)) fail('INVALID_CONTROLLED_PATCH', `additions[${index}] 不允许字段 ${field}`);
    }
    const parentId = nonEmptyString(rawAddition.parent_id);
    const parentFormatNodeId = nonEmptyString(rawAddition.parent_format_node_id);
    if ((!parentId && !parentFormatNodeId) || (parentId && parentFormatNodeId)) {
      fail('INVALID_CONTROLLED_PATCH', `additions[${index}] 必须且只能提供 parent_id 或 parent_format_node_id`);
    }
    const entry = findNode(next.outline, (item) => (parentId ? item.id === parentId : item.format_node_id === parentFormatNodeId));
    if (!entry) fail('INVALID_CONTROLLED_PATCH', `additions[${index}] 的父节点不存在`);
    if (!isInMutableRegion(entry)) fail('FORMAT_GATE_FAILED', `固定目录不允许新增子目录：${entry.item.title}`);
    entry.item.children = Array.isArray(entry.item.children) ? entry.item.children : [];
    entry.item.children.push(createAdditionalNode(rawAddition.node, nextChildId(entry.item), `additions[${index}].node`));
  });

  validateFormatOutline(next, profile);
  return next;
}

function normalizeScoringItem(item, path) {
  if (!isObject(item)) fail('INVALID_SCORING_OUTLINE', `${path} 不是对象`);
  const title = nonEmptyString(item.title);
  if (!title) fail('INVALID_SCORING_OUTLINE', `${path}.title 不能为空`);
  const children = item.children === undefined ? [] : item.children;
  if (!Array.isArray(children)) fail('INVALID_SCORING_OUTLINE', `${path}.children 必须是数组`);
  const mapped = uniqueStrings(
    item.mapped_requirement_ids !== undefined
      ? item.mapped_requirement_ids
      : [item.source_requirement_id].filter(Boolean),
    `${path}.mapped_requirement_ids`,
  );
  return {
    title,
    description: nonEmptyString(item.description),
    mapped_requirement_ids: mapped,
    children: children.map((child, index) => normalizeScoringItem(child, `${path}.children[${index}]`)),
    target_format_node_id: nonEmptyString(item.target_format_node_id || item.parent_format_node_id),
  };
}

function createScoringAddition(item, id) {
  function toPatchNode(value) {
    return {
      title: value.title,
      description: value.description,
      mapped_requirement_ids: value.mapped_requirement_ids,
      children: value.children.map(toPatchNode),
    };
  }
  return createAdditionalNode({
    ...toPatchNode(item),
  }, id, `评分目录 ${item.title}`);
}

function findUniqueTitleMatchedFormatNode(items, title) {
  const expected = normalizeComparable(title);
  if (!expected) return null;
  const matches = [];
  (function visit(nodes) {
    for (const item of nodes) {
      if (item.format_node_id) {
        const actual = normalizeComparable(item.title || item.source_title);
        if (actual === expected || actual.includes(expected) || expected.includes(actual)) {
          matches.push(item);
        }
      }
      visit(item.children || []);
    }
  }(items));
  return matches.length === 1 ? matches[0] : null;
}

function appendScoringChildren(parent, scoring) {
  parent.children = Array.isArray(parent.children) ? parent.children : [];
  for (const child of scoring.children || []) {
    parent.children.push(createScoringAddition(child, nextChildId(parent)));
  }
}

function profileFromInstantiatedOutline(baseItems) {
  function restore(items) {
    return items.filter((item) => item.format_node_id).map((item) => ({
      format_node_id: item.format_node_id,
      ...(item.source_number ? { source_number: item.source_number } : {}),
      source_title: item.source_title || item.title,
      description: item.description || '',
      required_in_outline: Boolean(item.required_in_outline),
      response_required: Boolean(item.response_required),
      title_locked: Boolean(item.title_locked),
      order_locked: Boolean(item.order_locked),
      level_locked: Boolean(item.level_locked),
      numbering_policy: item.numbering_policy || 'auto',
      response_mode: item.response_mode || 'freeform-markdown',
      allow_ai_children: Boolean(item.allow_ai_children),
      ...(item.template_id ? { template_id: item.template_id } : {}),
      ...(item.empty_response_text ? { empty_response_text: item.empty_response_text } : {}),
      ...(item.missing_evidence_risk ? { missing_evidence_risk: item.missing_evidence_risk } : {}),
      children: restore(item.children || []),
    }));
  }
  const outline = restore(baseItems);
  return {
    profile_id: '__instantiated_base__',
    applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
    format_strength: outline.length ? 'fixed-roots' : 'none',
    document_title: '',
    outline,
  };
}

function mergeScoringOutlineIntoFormat(base, generatedScoringOutline, requirementIds) {
  const baseItems = outlineItems(base);
  const profile = profileFromInstantiatedOutline(baseItems);
  const scoringItems = outlineItems(generatedScoringOutline).map((item, index) => normalizeScoringItem(item, `scoring[${index}]`));
  if (profile.format_strength === 'none') {
    const outline = scoringItems.map((item, index) => createScoringAddition(item, String(index + 1)));
    validateFormatOutline({ outline }, profile, requirementIds ? { requireScoreCoverage: requirementIds } : {});
    return { outline };
  }

  let next = { outline: clone(baseItems) };
  validateFormatOutline(next, profile);
  const allowedFixed = [];
  (function visit(items) {
    for (const item of items) {
      if (item.format_node_id && item.allow_ai_children) allowedFixed.push(item);
      visit(item.children || []);
    }
  }(next.outline));

  for (const scoring of scoringItems) {
    let parent;
    if (scoring.target_format_node_id) {
      parent = findNode(next.outline, (item) => item.format_node_id === scoring.target_format_node_id)?.item;
      if (!parent) fail('SCORING_TARGET_NOT_FOUND', `评分目录 ${scoring.title} 的目标格式节点不存在`);
      const parentTitle = normalizeComparable(parent.title || parent.source_title);
      const scoringTitle = normalizeComparable(scoring.title);
      const mapsExistingNode = parentTitle === scoringTitle
        || parentTitle.includes(scoringTitle)
        || scoringTitle.includes(parentTitle);
      if (mapsExistingNode) {
        parent.mapped_requirement_ids = [...new Set([...(parent.mapped_requirement_ids || []), ...scoring.mapped_requirement_ids])];
        if (scoring.children.length) {
          if (!parent.allow_ai_children) fail('FORMAT_GATE_FAILED', `固定目录不允许新增子目录：${parent.title}`);
          appendScoringChildren(parent, scoring);
        }
      } else {
        if (!parent.allow_ai_children) fail('FORMAT_GATE_FAILED', `固定目录不允许新增子目录：${parent.title}`);
        parent.children = Array.isArray(parent.children) ? parent.children : [];
        parent.children.push(createScoringAddition(scoring, nextChildId(parent)));
      }
      continue;
    }

    const titleMatched = findUniqueTitleMatchedFormatNode(next.outline, scoring.title);
    if (titleMatched) {
      titleMatched.mapped_requirement_ids = [...new Set([...(titleMatched.mapped_requirement_ids || []), ...scoring.mapped_requirement_ids])];
      if (titleMatched.allow_ai_children) appendScoringChildren(titleMatched, scoring);
      continue;
    } else if (allowedFixed.length === 1) {
      parent = findNode(next.outline, (item) => item.format_node_id === allowedFixed[0].format_node_id).item;
    } else if (allowedFixed.length === 0) {
      fail('SCORING_TARGET_NOT_FOUND', '格式骨架没有允许承载评分目录的位置');
    } else {
      fail('SCORING_TARGET_AMBIGUOUS', `评分目录 ${scoring.title} 缺少明确的目标格式节点`);
    }
    parent.children = Array.isArray(parent.children) ? parent.children : [];
    parent.children.push(createScoringAddition(scoring, nextChildId(parent)));
  }

  validateFormatOutline(next, profile, requirementIds ? { requireScoreCoverage: requirementIds } : {});
  return next;
}

function displayNumber(item) {
  const policy = item?.numbering_policy || 'auto';
  if (policy === 'none') return '';
  if (policy === 'preserve-source') return nonEmptyString(item?.source_number);
  return nonEmptyString(item?.id);
}

function numberOutlineForDisplay(value) {
  function visit(items) {
    return items.map((item) => {
      const number = displayNumber(item);
      const title = stripSourceNumber(stripSourceNumber(item.title, item.source_number), number);
      return {
        ...clone(item),
        display_number: number,
        display_title: number ? `${number} ${title}`.trim() : title,
        children: visit(item.children || []),
      };
    });
  }
  const numbered = visit(outlineItems(value));
  return Array.isArray(value) ? numbered : { ...clone(value), outline: numbered };
}

module.exports = {
  OutlineFormatConstraintError,
  applyControlledOutlinePatch,
  instantiateFormatOutline,
  mergeScoringOutlineIntoFormat,
  numberOutlineForDisplay,
  selectApplicableFormatProfile,
  validateFormatOutline,
};
