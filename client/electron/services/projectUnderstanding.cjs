const crypto = require('node:crypto');

const FEATURE_ROLE = 'project-understanding';
const INTERNAL_CITATION_PATTERN = /〔PU:([A-Za-z0-9_-]+)〕/g;
const UNDERSTANDING_TITLE_PATTERN = /(对.{0,8}项目.{0,4}(理解|认识)|项目.{0,4}(理解|认识)|项目背景.{0,4}(需求|任务).{0,3}分析)/;
const ANALYSIS_PATTERN = /(背景|战略|政策|行业|上级|部署|职责|定位|需求|关联|意义)/;
const SAFE_PARENT_PATTERN = /(综合技术方案|总体方案|实施方案|服务方案|技术方案|项目方案|总体思路)/;

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function walk(items, ancestors = [], rows = []) {
  for (const item of items || []) {
    rows.push({ item, ancestors });
    if (item?.children?.length) walk(item.children, [...ancestors, item], rows);
  }
  return rows;
}

function isProtected(item) {
  return Boolean(
    item?.manual_input_required
    || item?.title_locked
    || item?.order_locked
    || item?.level_locked
    || item?.allow_ai_children === false
    || ['fixed-markdown-table', 'locked-commitment'].includes(item?.response_mode),
  );
}

function isEquivalentSection(item) {
  const title = String(item?.title || '').replace(/\s+/g, '');
  const text = `${title}\n${item?.description || ''}\n${item?.content || ''}`.replace(/\s+/g, '');
  return UNDERSTANDING_TITLE_PATTERN.test(title)
    || (UNDERSTANDING_TITLE_PATTERN.test(text) && ANALYSIS_PATTERN.test(text));
}

function createNodeId(parent, outline) {
  const prefix = `${String(parent?.id || 'section')}-project-understanding`;
  const ids = new Set(walk(outline).map(({ item }) => String(item?.id || '')));
  if (!ids.has(prefix)) return prefix;
  let index = 2;
  while (ids.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function planProjectUnderstandingPlacement(outlineData, previous = {}) {
  const nextOutlineData = clone(outlineData);
  const roots = nextOutlineData?.outline || [];
  const rows = walk(roots);
  const existing = rows.find(({ item }) => item?.feature_role === FEATURE_ROLE || isEquivalentSection(item));
  if (existing) {
    existing.item.feature_role = FEATURE_ROLE;
    return {
      outlineData: nextOutlineData,
      placement: { status: 'reused', node_id: existing.item.id, title: existing.item.title, reason: '复用已有的项目理解章节' },
    };
  }

  if (previous?.placement?.status === 'excluded') {
    return { outlineData: nextOutlineData, placement: clone(previous.placement) };
  }

  const parentRow = rows.find(({ item, ancestors }) => SAFE_PARENT_PATTERN.test(String(item?.title || '')) && !isProtected(item) && !ancestors.some(isProtected));
  if (!parentRow) {
    return {
      outlineData: nextOutlineData,
      placement: { status: 'review-required', reason: '未找到可在不改动冻结骨架的前提下安全插入“项目理解”的上级章节' },
    };
  }

  const node = {
    id: createNodeId(parentRow.item, roots),
    title: '项目理解',
    description: '基于已核验的权威来源，从宏观背景、行业与上级部署逐层联系到采购人职责和本项目需求，区分直接依据、背景关联与分析推导并保留出处。',
    feature_role: FEATURE_ROLE,
  };
  const children = Array.isArray(parentRow.item.children) ? parentRow.item.children : [];
  // 来源/冻结节点保持靠前；新增节点放在其后的首个可编辑位置，既有兄弟相对顺序不变。
  const firstEditableIndex = children.findIndex((child) => !isProtected(child));
  const insertionIndex = firstEditableIndex < 0 ? children.length : firstEditableIndex;
  parentRow.item.children = [...children.slice(0, insertionIndex), node, ...children.slice(insertionIndex)];
  return {
    outlineData: nextOutlineData,
    placement: { status: 'added', node_id: node.id, parent_node_id: parentRow.item.id, title: node.title, reason: '已在现有方案章节内补全，并保留原有子目录顺序' },
  };
}

function findProjectUnderstandingNode(outlineData) {
  return walk(outlineData?.outline || []).find(({ item, ancestors }) => (
    item?.feature_role === FEATURE_ROLE || ancestors.some((parent) => parent?.feature_role === FEATURE_ROLE)
  ));
}

function isProjectUnderstandingNode(outlineData, nodeId) {
  return walk(outlineData?.outline || []).some(({ item, ancestors }) => (
    String(item?.id || '') === String(nodeId || '')
    && (item?.feature_role === FEATURE_ROLE || ancestors.some((parent) => parent?.feature_role === FEATURE_ROLE))
  ));
}

function projectUnderstandingSubtreeHash(outlineData) {
  const row = walk(outlineData?.outline || []).find(({ item }) => item?.feature_role === FEATURE_ROLE);
  return row ? stableHash(JSON.stringify(row.item)) : '';
}

function normalizeProjectUnderstanding(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  return {
    schema_version: 1,
    placement: source.placement,
    reference_date: source.reference_date || '',
    active_version_id: source.active_version_id || undefined,
    pending_version_id: source.pending_version_id || undefined,
    versions: Array.isArray(source.versions) ? source.versions : [],
    content_review: source.content_review || { status: 'pending', issues: [] },
    human_review: source.human_review || { status: 'unreviewed' },
    audit_log: Array.isArray(source.audit_log) ? source.audit_log : [],
  };
}

function getActiveResearchVersion(projectUnderstanding) {
  const state = normalizeProjectUnderstanding(projectUnderstanding);
  return state.versions.find((version) => version.version_id === state.active_version_id);
}

function isReviewableGap(value) {
  return String(value || '').startsWith('[可人工确认]');
}

function formatEvidencePackage(projectUnderstanding) {
  const version = getActiveResearchVersion(projectUnderstanding);
  if (!version?.evidence?.length) return '';
  const sources = new Map((version.sources || []).map((source) => [source.source_id, source]));
  const evidenceText = version.evidence.map((evidence) => {
    const source = sources.get(evidence.source_id) || {};
    return [
      `引用标记：〔PU:${evidence.evidence_id}〕`,
      `来源：${source.title || '未命名来源'}；${source.publisher || '发布机构待核验'}；${source.published_at || '发布日期未知'}`,
      `原文片段：${evidence.excerpt}${evidence.location ? `；定位：${evidence.location}` : ''}`,
      `讲话属性：${evidence.speaker || '不适用/未知'}；${evidence.event_date || '日期未知'}；${evidence.occasion || '场合未知'}`,
      `适用性：文号 ${evidence.document_number || '未知'}；对象 ${evidence.applicability?.object || '未知'}；地域 ${evidence.applicability?.region || '未知'}；时期 ${evidence.applicability?.period || '未知'}；有效性 ${evidence.effective_status || 'unknown'}`,
      `层级与关联：${evidence.layer || '未分类'} / ${evidence.relationship || '背景关联'}`,
      `用途：${evidence.claim || ''}`,
    ].join('\n');
  }).join('\n\n');
  const relationText = (version.relations || []).map((relation) => (
    `${relation.from_evidence_id} → ${relation.to_evidence_id}；类型 ${relation.relation_type}；性质 ${relation.relationship}；支撑 ${relation.support_evidence_ids?.join('、') || '未提供'}；关系原文 ${relation.support_excerpt || '未提供'}；说明 ${relation.explanation || '无'}`
  )).join('\n');
  return relationText ? `${evidenceText}\n\n已校验关联候选（direct 才可作事实，background/inference 必须按其性质表述）：\n${relationText}` : evidenceText;
}

function validateProjectUnderstandingContent(content, projectUnderstanding) {
  const version = getActiveResearchVersion(projectUnderstanding);
  const evidenceMap = new Map((version?.evidence || []).map((evidence) => [evidence.evidence_id, evidence]));
  const issues = [];
  const markers = [...String(content || '').matchAll(INTERNAL_CITATION_PATTERN)].map((match) => match[1]);
  for (const evidenceId of markers) {
    if (!evidenceMap.has(evidenceId)) issues.push(`引用标记不存在：${evidenceId}`);
  }
  if (String(content || '').trim() && version?.evidence?.length && markers.length === 0) {
    issues.push('项目理解正文未保留来源标记');
  }
  const referencedEvidence = markers.map((id) => evidenceMap.get(id)).filter(Boolean);
  const quotations = [...String(content || '').matchAll(/[“"]([^”"]{5,})[”"]/g)].map((match) => match[1].trim());
  for (const quotation of quotations) {
    if (!referencedEvidence.some((evidence) => String(evidence.excerpt || '').includes(quotation))) {
      issues.push(`直接引语未与所引证据原文匹配：${quotation.slice(0, 30)}`);
    }
  }
  return { status: issues.length ? 'issues' : 'passed', issues };
}

function validateProjectUnderstandingOutlineContent(outlineData, projectUnderstanding, override = {}) {
  const rows = walk(outlineData?.outline || []).filter(({ item, ancestors }) => (
    (item?.feature_role === FEATURE_ROLE || ancestors.some((parent) => parent?.feature_role === FEATURE_ROLE))
    && !item?.children?.length
  ));
  const issues = [];
  if (!rows.length) issues.push('项目理解目录没有可写叶子');
  for (const { item } of rows) {
    const content = String(item.id) === String(override.nodeId || '') ? override.content : item.content;
    if (!String(content || '').trim()) {
      issues.push(`${item.title || item.id}：正文为空`);
      continue;
    }
    const review = validateProjectUnderstandingContent(content, projectUnderstanding);
    issues.push(...review.issues.map((issue) => `${item.title || item.id}：${issue}`));
  }
  return { status: issues.length ? 'issues' : 'passed', issues };
}

function buildProjectUnderstandingSubtree(outlineData, placement, evidence) {
  const result = clone(outlineData);
  if (placement?.status !== 'added' || !placement.node_id) return result;
  const row = walk(result?.outline || []).find(({ item }) => String(item?.id || '') === String(placement.node_id));
  if (!row || row.item?.children?.length || String(row.item?.content || '').trim()) return result;
  const themes = [...new Set((evidence || []).map((item) => String(item?.theme || '').replace(/^[一二三四五六七八九十\d.、（）()\s]+/, '').trim()).filter(Boolean))];
  const normalizedThemes = themes.map((theme) => theme.replace(/[\s、，：:；;]/g, ''));
  const hasFactLikeTitle = themes.some((theme) => /[“”"《》]|\d{4}年|\d{4}-\d{1,2}|〔PU:/.test(theme));
  const hasOverlappingThemes = normalizedThemes.some((theme, index) => normalizedThemes.some((other, otherIndex) => index !== otherIndex && (theme.includes(other) || other.includes(theme))));
  if (themes.length < 2 || hasFactLikeTitle || hasOverlappingThemes) return result;
  row.item.children = themes.map((theme) => ({
    id: `${row.item.id}-theme-${stableHash(theme).slice(0, 8)}`,
    title: theme.slice(0, 40),
    description: `围绕“${theme}”使用已核验证据形成项目认识，并说明与本项目需求及响应落点的实际关联。`,
  }));
  return result;
}

function prepareProjectUnderstandingExport(outlineData, projectUnderstanding) {
  if (!outlineData?.outline?.length) return { outlineData, draft: false, warnings: [] };
  const normalized = normalizeProjectUnderstanding(projectUnderstanding);
  const version = getActiveResearchVersion(normalized);
  if (!version) {
    if (!normalized.placement || normalized.placement.status === 'excluded') return { outlineData, draft: false, warnings: [] };
    const result = clone(outlineData);
    const row = walk(result.outline).find(({ item, ancestors }) => item?.feature_role === FEATURE_ROLE || ancestors.some((parent) => parent?.feature_role === FEATURE_ROLE));
    if (row) row.item.content = `> 项目理解资料状态：待人工复核\n\n${String(row.item.content || '').trim()}`.trim();
    return { outlineData: result, draft: true, warnings: ['项目理解尚无可核验资料版本，本次导出为待复核稿。'] };
  }
  const result = clone(outlineData);
  const sourceMap = new Map((version.sources || []).map((source) => [source.source_id, source]));
  const evidenceMap = new Map((version.evidence || []).map((evidence) => [evidence.evidence_id, evidence]));
  const markerOrder = [];
  const usedEvidenceIds = new Set();
  const projectRows = walk(result.outline).filter(({ item, ancestors }) => (
    item?.feature_role === FEATURE_ROLE || ancestors.some((parent) => parent?.feature_role === FEATURE_ROLE)
  ));
  for (const { item } of projectRows) {
    item.content = String(item.content || '').replace(INTERNAL_CITATION_PATTERN, (_match, evidenceId) => {
      const evidence = evidenceMap.get(evidenceId);
      const sourceId = evidence?.source_id;
      if (!evidence || !sourceMap.has(sourceId)) return `〔PU-待核验〕`;
      usedEvidenceIds.add(evidenceId);
      if (!markerOrder.includes(sourceId)) markerOrder.push(sourceId);
      return `〔PU-${markerOrder.indexOf(sourceId) + 1}〕`;
    });
  }
  if (markerOrder.length && projectRows.length) {
    const references = markerOrder.map((sourceId, index) => {
      const source = sourceMap.get(sourceId);
      const title = String(source.title || '未命名来源').replace(/[\[\]]/g, '');
      const location = source.url ? `[${title}](${source.url})` : title;
      const details = [...usedEvidenceIds].map((id) => evidenceMap.get(id)).filter((evidence) => evidence?.source_id === sourceId).map((evidence) => [
        evidence.location,
        evidence.speaker && evidence.event_date && evidence.occasion ? `${evidence.speaker}，${evidence.event_date}，${evidence.occasion}` : '',
        evidence.document_number ? `文号：${evidence.document_number}` : '',
        evidence.applicability?.object ? `适用对象：${evidence.applicability.object}` : '',
        evidence.applicability?.region ? `适用地域：${evidence.applicability.region}` : '',
        evidence.applicability?.period ? `适用时期：${evidence.applicability.period}` : '',
        evidence.effective_status && evidence.effective_status !== 'unknown' ? `有效性：${evidence.effective_status}` : '',
      ].filter(Boolean).join('；')).filter(Boolean);
      return `- 〔PU-${index + 1}〕 ${location}，${source.publisher || '发布机构待核验'}，${source.published_at || '发布日期未知'}${source.version_type ? `；读取版本：${source.version_type}` : ''}${source.internal_location ? `；内部定位：${source.internal_location}` : ''}${details.length ? `；${[...new Set(details)].join('；')}` : ''}。`;
    }).join('\n');
    const last = projectRows[projectRows.length - 1].item;
    last.content = `${String(last.content || '').trim()}\n\n**参考依据：**\n\n${references}`.trim();
  }
  const acceptedGaps = new Set(version.accepted_gaps || []);
  const unresolvedGaps = (version.gaps || []).filter((gap) => !acceptedGaps.has(gap));
  const humanReviewMatches = normalized.human_review?.status === 'reviewed'
    && normalized.human_review?.version_id === version.version_id;
  const draft = version.status !== 'complete'
    || unresolvedGaps.length > 0
    || normalized.content_review?.status !== 'passed'
    || !humanReviewMatches;
  if (draft && projectRows.length) {
    const first = projectRows[0].item;
    first.content = `> 项目理解资料状态：待人工复核\n\n${String(first.content || '').trim()}`.trim();
  }
  return {
    outlineData: result,
    draft,
    warnings: draft ? ['项目理解资料尚未完成机器核验和人工复核，本次导出为待复核稿。'] : [],
  };
}

module.exports = {
  FEATURE_ROLE,
  INTERNAL_CITATION_PATTERN,
  buildProjectUnderstandingSubtree,
  findProjectUnderstandingNode,
  formatEvidencePackage,
  getActiveResearchVersion,
  isProjectUnderstandingNode,
  isReviewableGap,
  normalizeProjectUnderstanding,
  planProjectUnderstandingPlacement,
  prepareProjectUnderstandingExport,
  projectUnderstandingSubtreeHash,
  stableHash,
  validateProjectUnderstandingContent,
  validateProjectUnderstandingOutlineContent,
};
