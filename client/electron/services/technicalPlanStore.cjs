const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  getBidAnalysisTaskDefinitions,
  getBidAnalysisTasks,
  isBidAnalysisTaskResultValid,
} = require('./bidAnalysisTask.cjs');
const {
  getTechnicalPlanGeneratedIllustrationsDir,
  getTechnicalPlanIllustrationsDir,
  getTechnicalPlanOriginalPlanMarkdownPath,
  getTechnicalPlanTenderMarkdownPath,
} = require('../utils/paths.cjs');
const { deleteImportedImageBatches } = require('../utils/importedImages.cjs');
const { detectBidSections } = require('../utils/bidSectionDetector.cjs');
const { normalizeBidSectionDisplayText } = require('../utils/bidSectionDisplayText.cjs');
const {
  normalizeRequirementResponseMatrix,
} = require('./technicalPlanQualityModel.cjs');
const { applyOutlineQualityRules, validateConditionalOutlineDepth } = require('./outlineQualityRules.cjs');

const tenderMarkdownRelativePath = path.join('technical-plan', 'tender.md').replace(/\\/g, '/');
const tenderOriginalMarkdownRelativePath = path.join('technical-plan', 'tender-original.md').replace(/\\/g, '/');
const tenderSourceFilesDirRelativePath = path.join('technical-plan', 'tender-files').replace(/\\/g, '/');
const originalPlanMarkdownRelativePath = path.join('technical-plan', 'original-plan.md').replace(/\\/g, '/');
const originalOutlineRuntimeFileName = 'original-outline-runtime.json';

const outlineNumberingPolicies = new Set(['auto', 'preserve-source', 'none']);
const outlineResponseModes = new Set([
  'freeform-markdown',
  'fixed-markdown-table',
  'locked-commitment',
  'evidence-markdown',
  'container',
  'explicit-none',
]);
const outlineResponseStatuses = new Set([
  'pending',
  'responded-substantive',
  'responded-none',
  'needs-manual-input',
  'missing-required-evidence',
]);
const outlineComplianceRisks = new Set(['none', 'warning', 'high', 'potential-rejection']);
const missingEvidenceRisks = new Set(['high', 'potential-rejection']);

const outlineFormatConstraintFields = [
  'manual_input_required',
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
  'empty_response_text',
  'missing_evidence_risk',
  'mapped_requirement_ids',
];

const outlineResponseStateFields = [
  'template_values',
  'knowledge_item_ids',
  'response_status',
  'compliance_risk',
  'compliance_message',
];

const outlineQualityMetadataFields = [
  'focus_priority',
  'focus_scoring_point_ids',
];

const defaultOutlineFormatConstraints = Object.freeze({
  manual_input_required: false,
  numbering_policy: 'auto',
  required_in_outline: false,
  response_required: true,
  title_locked: false,
  order_locked: false,
  level_locked: false,
  response_mode: 'freeform-markdown',
  allow_ai_children: true,
  mapped_requirement_ids: [],
});

const defaultOutlineWordControlOptions = Object.freeze({
  enabled: false,
  minimumWords: 0,
  maximumWords: 0,
  sectionWords: 0,
  strictSectionWords: false,
});

const initialState = {
  workflowKind: 'technical-plan',
  step: 'document-analysis',
  tenderFile: null,
  tenderFiles: [],
  originalPlanFile: null,
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key',
  bidAnalysisSelectedTaskIds: [],
  bidAnalysisTaskDefinitions: [],
  bidAnalysisTasks: {},
  bidAnalysisProgress: 0,
  bidSectionMode: 'single',
  bidSections: [],
  bidSectionExtractionStatus: 'idle',
  bidSectionExtractionError: undefined,
  outlineMode: 'aligned',
  outlineExpansionMode: 'ai-complement',
  outlineWordControlOptions: { ...defaultOutlineWordControlOptions },
  outlineWordControlSnapshot: undefined,
  referenceKnowledgeDocumentIds: [],
  bidSectionExtractionTask: undefined,
  bidAnalysisTask: undefined,
  outlineGenerationTask: undefined,
  globalFactsTask: undefined,
  globalFacts: [],
  contentGenerationTask: undefined,
  contentGenerationOptions: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  contentIllustrationPlan: undefined,
  contentGenerationRuntime: undefined,
  requirementResponseMatrix: undefined,
  outlineQualityReview: undefined,
  outlineData: null,
};

const taskFieldTypes = {
  bidSectionExtractionTask: 'bid-section-extraction',
  bidAnalysisTask: 'bid-analysis',
  outlineGenerationTask: 'outline-generation',
  globalFactsTask: 'global-facts-generation',
  contentGenerationTask: 'content-generation',
};

const taskTypeFields = Object.fromEntries(Object.entries(taskFieldTypes).map(([field, type]) => [type, field]));

function now() {
  return new Date().toISOString();
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function normalizeOutlineWordControlOptions(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalizeInteger = (input) => {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  };
  const sectionWords = normalizeInteger(source.sectionWords);
  return {
    enabled: Boolean(source.enabled),
    minimumWords: normalizeInteger(source.minimumWords),
    maximumWords: normalizeInteger(source.maximumWords),
    sectionWords,
    strictSectionWords: sectionWords > 0 && Boolean(source.strictSectionWords),
  };
}

function isEmptyObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseStrictJsonObject(value, label) {
  if (value === undefined || value === null || value === '') return null;
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    throw new Error(`${label} JSON 已损坏：${error.message || '无法解析'}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} JSON 已损坏：根节点必须是对象`);
  }
  return parsed;
}

function normalizeOptionalString(source, field, label) {
  if (!hasOwn(source, field) || source[field] === undefined || source[field] === null) return undefined;
  if (typeof source[field] !== 'string') {
    throw new Error(`${label}.${field} 必须是字符串`);
  }
  const value = source[field].trim();
  return value || undefined;
}

function normalizeRequiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value.trim();
}

const bidAnalysisContextFields = [
  'run_id',
  'document_id',
  'document_version',
  'prompt_version',
  'anchor_catalog_hash',
];

function normalizeBidAnalysisContext(value) {
  if (!isPlainObject(value)) return undefined;
  const normalized = {};
  for (const field of bidAnalysisContextFields) {
    const fieldValue = typeof value[field] === 'string' ? value[field].trim() : '';
    if (fieldValue) normalized[field] = fieldValue;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeBidAnalysisDiagnostic(value, fallback = {}) {
  if (!isPlainObject(value)) return undefined;
  const errorCode = typeof value.error_code === 'string'
    ? value.error_code.trim()
    : typeof value.code === 'string'
      ? value.code.trim()
      : '';
  if (!errorCode || errorCode === 'STALE_ANALYSIS_RESULT') return undefined;

  const context = normalizeBidAnalysisContext(value) || normalizeBidAnalysisContext(fallback) || {};
  const errorPath = typeof value.error_path === 'string'
    ? value.error_path.trim()
    : typeof value.path === 'string'
      ? value.path.trim()
      : '';
  const message = typeof value.message === 'string'
    ? value.message.trim()
    : typeof fallback.error === 'string'
      ? fallback.error.trim()
      : '';
  const requiresManualReview = value.requires_manual_review === true
    || fallback.requires_manual_review === true
    || errorCode === 'FORMAT_VALIDATION_FAILED'
    || errorCode === 'ANCHOR_CATALOG_MISMATCH';

  return {
    error_code: errorCode,
    ...(errorPath ? { error_path: errorPath } : {}),
    ...(message ? { message } : {}),
    ...context,
    requires_manual_review: requiresManualReview,
  };
}

function normalizeBidAnalysisItemContract(task = {}) {
  const status = normalizeStatus(task.status, ['idle', 'running', 'success', 'error'], 'idle');
  const analysisContext = normalizeBidAnalysisContext(task.analysis_context || task.analysisContext || task.details);
  const fallbackDiagnostic = {
    error_code: task.error_code || task.code,
    error_path: task.error_path || task.path,
    message: task.message || task.error,
    run_id: task.run_id,
    document_id: task.document_id,
    document_version: task.document_version,
    prompt_version: task.prompt_version,
    anchor_catalog_hash: task.anchor_catalog_hash,
    requires_manual_review: task.requires_manual_review,
  };
  const diagnostic = status === 'error'
    ? normalizeBidAnalysisDiagnostic(task.diagnostic || fallbackDiagnostic, { ...fallbackDiagnostic, ...(analysisContext || {}) })
    : undefined;
  const requiresManualReview = status === 'error'
    && Boolean(diagnostic?.requires_manual_review)
    && diagnostic?.error_code !== 'STALE_ANALYSIS_RESULT';
  return {
    analysisContext,
    diagnostic: diagnostic ? { ...diagnostic, requires_manual_review: requiresManualReview } : undefined,
    requiresManualReview,
  };
}

function normalizeBooleanField(source, field, fallback, label) {
  if (!hasOwn(source, field) || source[field] === undefined || source[field] === null) return fallback;
  if (typeof source[field] !== 'boolean') {
    throw new Error(`${label}.${field} 必须是布尔值`);
  }
  return source[field];
}

function normalizeEnumField(source, field, allowed, fallback, label) {
  if (!hasOwn(source, field) || source[field] === undefined || source[field] === null) return fallback;
  if (typeof source[field] !== 'string' || !allowed.has(source[field])) {
    throw new Error(`${label}.${field} 包含不支持的值`);
  }
  return source[field];
}

function normalizeStringArray(value, fallback, label) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeOutlineFocusMetadata(value) {
  const source = isPlainObject(value) ? value : {};
  const normalized = {};
  if (['service-plan', 'score-first', 'score-second'].includes(source.focus_priority)) {
    normalized.focus_priority = source.focus_priority;
  }
  const scoringPointIds = normalizeStringArray(source.focus_scoring_point_ids, [], '目录重点评分项');
  if (scoringPointIds.length) normalized.focus_scoring_point_ids = scoringPointIds;
  return normalized;
}

function normalizeOutlineFormatConstraints(value) {
  const source = parseStrictJsonObject(value, '目录格式约束') || {};
  const manualInputRequired = normalizeBooleanField(source, 'manual_input_required', defaultOutlineFormatConstraints.manual_input_required, '目录格式约束');
  const normalized = {
    manual_input_required: manualInputRequired,
    numbering_policy: normalizeEnumField(source, 'numbering_policy', outlineNumberingPolicies, defaultOutlineFormatConstraints.numbering_policy, '目录格式约束'),
    required_in_outline: normalizeBooleanField(source, 'required_in_outline', defaultOutlineFormatConstraints.required_in_outline, '目录格式约束'),
    response_required: normalizeBooleanField(source, 'response_required', defaultOutlineFormatConstraints.response_required, '目录格式约束'),
    title_locked: normalizeBooleanField(source, 'title_locked', defaultOutlineFormatConstraints.title_locked, '目录格式约束'),
    order_locked: normalizeBooleanField(source, 'order_locked', defaultOutlineFormatConstraints.order_locked, '目录格式约束'),
    level_locked: normalizeBooleanField(source, 'level_locked', defaultOutlineFormatConstraints.level_locked, '目录格式约束'),
    response_mode: 'freeform-markdown',
    allow_ai_children: normalizeBooleanField(source, 'allow_ai_children', defaultOutlineFormatConstraints.allow_ai_children, '目录格式约束'),
    mapped_requirement_ids: normalizeStringArray(source.mapped_requirement_ids, defaultOutlineFormatConstraints.mapped_requirement_ids, '目录格式约束.mapped_requirement_ids'),
  };

  for (const field of ['format_node_id', 'source_number', 'source_title', 'empty_response_text']) {
    const fieldValue = normalizeOptionalString(source, field, '目录格式约束');
    if (fieldValue !== undefined) normalized[field] = fieldValue;
  }
  const missingEvidenceRisk = normalizeEnumField(source, 'missing_evidence_risk', missingEvidenceRisks, undefined, '目录格式约束');
  if (missingEvidenceRisk !== undefined) normalized.missing_evidence_risk = missingEvidenceRisk;
  return normalized;
}

function normalizeOutlineResponseState(value, { content = '', knowledgeItemIds = [] } = {}) {
  const source = parseStrictJsonObject(value, '目录响应状态') || {};
  const defaultStatus = String(content || '').trim() ? 'responded-substantive' : 'pending';
  const normalized = {
    knowledge_item_ids: normalizeStringArray(source.knowledge_item_ids, knowledgeItemIds, '目录响应状态.knowledge_item_ids'),
    response_status: normalizeEnumField(source, 'response_status', outlineResponseStatuses, defaultStatus, '目录响应状态'),
    compliance_risk: normalizeEnumField(source, 'compliance_risk', outlineComplianceRisks, 'none', '目录响应状态'),
  };

  if (hasOwn(source, 'template_values') && source.template_values !== undefined && source.template_values !== null) {
    if (!isPlainObject(source.template_values)) {
      throw new Error('目录响应状态.template_values 必须是对象');
    }
    normalized.template_values = JSON.parse(JSON.stringify(source.template_values));
  }
  const complianceMessage = normalizeOptionalString(source, 'compliance_message', '目录响应状态');
  if (complianceMessage !== undefined) normalized.compliance_message = complianceMessage;
  return normalized;
}

function extractOwnFields(source, fields) {
  const patch = {};
  for (const field of fields) {
    if (hasOwn(source, field) && source[field] !== undefined) {
      patch[field] = source[field];
    }
  }
  return patch;
}

function hasFields(value) {
  return Boolean(value && Object.keys(value).length);
}

function applyOutlinePersistenceFields(item, formatConstraints, responseState, qualityMetadata) {
  return {
    ...item,
    ...formatConstraints,
    ...responseState,
    ...qualityMetadata,
    knowledge_item_ids: [...responseState.knowledge_item_ids],
  };
}

function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function stableHash(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function safeFileNamePart(value) {
  return String(value || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'file';
}

function createTenderSourceId(fileName, markdown, index) {
  const hash = stableHash(`${fileName}\n${markdown}`).slice(0, 12);
  return `tender-${String(index + 1).padStart(2, '0')}-${hash}`;
}

function combineTenderMarkdown(markdowns) {
  return (Array.isArray(markdowns) ? markdowns : [])
    .map((markdown) => String(markdown || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function toDbBool(value) {
  return value ? 1 : 0;
}

function fromDbBool(value) {
  return Number(value) === 1;
}

function normalizeStatus(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function bidItemFromRow(row) {
  const analysisContext = normalizeBidAnalysisContext(safeJsonParse(row?.analysis_context_json, undefined));
  const diagnostic = normalizeBidAnalysisDiagnostic(safeJsonParse(row?.diagnostic_json, undefined), {
    ...(analysisContext || {}),
    error: row?.error || undefined,
  });
  return {
    id: row.item_id,
    label: row.label,
    status: normalizeStatus(row.status, ['idle', 'running', 'success', 'error'], 'idle'),
    content: row.content || '',
    ...(row.normalized_hash ? { normalized_hash: row.normalized_hash } : {}),
    error: row.error || undefined,
    ...(analysisContext ? { analysis_context: analysisContext } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    requires_manual_review: fromDbBool(row.requires_manual_review),
  };
}

function normalizeWorkflowKind(value) {
  return value === 'existing-plan-expansion' ? 'existing-plan-expansion' : 'technical-plan';
}

function isValidStep(value) {
  return ['document-analysis', 'bid-analysis', 'outline-generation', 'global-facts', 'content-edit', 'expand'].includes(value);
}

function normalizeGlobalFactId(value, index) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id || `fact_${String(index + 1).padStart(3, '0')}`;
}

function isValidBidMode(value) {
  return value === 'key' || value === 'full' || value === 'custom';
}

function normalizeBidSectionMode(value) {
  return value === 'multiple' ? 'multiple' : 'single';
}

function normalizeBidSectionExtractionStatus(value) {
  return normalizeStatus(value, ['idle', 'running', 'success', 'error'], 'idle');
}

function normalizeBidSectionRanges(value) {
  return (Array.isArray(value) ? value : [])
    .map((range) => ({
      startLine: Math.max(1, Math.floor(Number(range?.startLine || range?.start_line || 0))),
      endLine: Math.max(1, Math.floor(Number(range?.endLine || range?.end_line || 0))),
      reason: range?.reason ? String(range.reason) : undefined,
    }))
    .filter((range) => range.startLine > 0 && range.endLine >= range.startLine);
}

function normalizeBidSections(value) {
  return (Array.isArray(value) ? value : [])
    .map((section, index) => {
      const normalizedIndex = Number(section?.index || index + 1);
      const title = String(section?.title || '').trim();
      return {
        id: String(section?.id || `section-${normalizedIndex || index + 1}`).trim(),
        index: Number.isFinite(normalizedIndex) && normalizedIndex > 0 ? normalizedIndex : index + 1,
        unit: String(section?.unit || '标段').trim() || '标段',
        title,
        headLine: normalizeBidSectionDisplayText(section?.headLine || section?.head_line),
        description: normalizeBidSectionDisplayText(section?.description),
        includeRanges: normalizeBidSectionRanges(section?.includeRanges || section?.include_ranges),
        evidence: (Array.isArray(section?.evidence) ? section.evidence : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      };
    })
    .filter((section) => section.id && section.title);
}

function expandLineRanges(ranges, totalLines) {
  const lines = new Set();
  for (const range of normalizeBidSectionRanges(ranges)) {
    const start = Math.max(1, Math.min(totalLines, range.startLine));
    const end = Math.max(start, Math.min(totalLines, range.endLine));
    for (let line = start; line <= end; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

function buildSelectedSectionMarkdown(markdown, sections, selectedSectionId) {
  const sourceLines = String(markdown || '').split(/\r?\n/);
  const totalLines = sourceLines.length;
  const selected = sections.find((section) => section.id === selectedSectionId);
  if (!selected) {
    throw new Error('未找到选择的投标范围');
  }
  if (!normalizeBidSectionRanges(selected.includeRanges).length) {
    throw new Error('当前标段缺少有效范围，请重新识别');
  }

  const selectedLines = expandLineRanges(selected.includeRanges, totalLines);
  const otherLines = new Set();
  for (const section of sections) {
    if (section.id === selected.id) continue;
    for (const line of expandLineRanges(section.includeRanges, totalLines)) {
      otherLines.add(line);
    }
  }

  const filtered = sourceLines.filter((_, index) => {
    const lineNumber = index + 1;
    return !otherLines.has(lineNumber) || selectedLines.has(lineNumber);
  }).join('\n').trim();

  if (!filtered) {
    throw new Error('生成投标范围工作副本失败，请重新提取标段');
  }
  return filtered;
}

function getAllBidAnalysisTasks() {
  return getBidAnalysisTasks('full');
}

function getRequiredBidAnalysisTaskIds() {
  return getBidAnalysisTasks('key').map((task) => task.id);
}

function normalizeBidAnalysisTaskIds(taskIds) {
  const requestedIds = new Set((Array.isArray(taskIds) ? taskIds : [])
    .map((taskId) => String(taskId || '').trim())
    .filter(Boolean));
  return getAllBidAnalysisTasks()
    .filter((task) => requestedIds.has(task.id))
    .map((task) => task.id);
}

function normalizeBidAnalysisConfig(mode, selectedTaskIds) {
  const allTaskIds = getAllBidAnalysisTasks().map((task) => task.id);
  const requiredTaskIds = getRequiredBidAnalysisTaskIds();
  const requiredSet = new Set(requiredTaskIds);
  const selectedSet = new Set([...requiredTaskIds, ...normalizeBidAnalysisTaskIds(selectedTaskIds)]);
  const selectedIds = allTaskIds.filter((taskId) => selectedSet.has(taskId));
  const hasOptional = selectedIds.some((taskId) => !requiredSet.has(taskId));
  const hasAll = selectedIds.length === allTaskIds.length;

  if (mode === 'full' || hasAll) {
    return { mode: 'full', selectedTaskIds: allTaskIds };
  }
  if (mode === 'custom' || hasOptional) {
    return { mode: 'custom', selectedTaskIds: selectedIds };
  }
  return { mode: 'key', selectedTaskIds: requiredTaskIds };
}

function getBidAnalysisTaskIdsForConfig(mode, selectedTaskIds) {
  return normalizeBidAnalysisConfig(mode, selectedTaskIds).selectedTaskIds;
}

function isValidOutlineMode(value) {
  return value === 'aligned';
}

function isValidOutlineExpansionMode(value) {
  return value === 'original-only' || value === 'ai-complement';
}

function collectLeafItems(items) {
  return (items || []).flatMap((item) => item?.children?.length ? collectLeafItems(item.children) : [item]);
}

function flattenOutlineItems(items, parentNodeId = null, level = 1, rows = []) {
  (items || []).forEach((item, index) => {
    const nodeId = String(item?.id || '').trim();
    if (!nodeId) return;
    const formatConstraintsPatch = extractOwnFields(item, outlineFormatConstraintFields);
    const responseStatePatch = extractOwnFields(item, outlineResponseStateFields);
    const qualityMetadataPatch = extractOwnFields(item, outlineQualityMetadataFields);
    rows.push({
      node_id: nodeId,
      parent_node_id: parentNodeId,
      sort_order: index,
      level,
      title: String(item?.title || '未命名章节').trim() || '未命名章节',
      description: String(item?.description || '').trim(),
      source_requirement_id: item?.source_requirement_id ? String(item.source_requirement_id) : null,
      source_requirement_title: item?.source_requirement_title ? String(item.source_requirement_title) : null,
      knowledge_item_ids_json: Array.isArray(item?.knowledge_item_ids) && item.knowledge_item_ids.length ? JSON.stringify(item.knowledge_item_ids) : null,
      has_knowledge_item_ids: hasOwn(item, 'knowledge_item_ids') && item.knowledge_item_ids !== undefined,
      format_constraints_patch: formatConstraintsPatch,
      response_state_patch: responseStatePatch,
      quality_metadata_patch: qualityMetadataPatch,
      content: String(item?.content || ''),
    });
    if (item?.children?.length) {
      flattenOutlineItems(item.children, nodeId, level + 1, rows);
    }
  });
  return rows;
}

function clearOutlineItemContent(items) {
  return (items || []).map((item) => ({
    ...item,
    content: '',
    children: item?.children?.length ? clearOutlineItemContent(item.children) : item.children,
  }));
}

function clearOutlineDataContent(outlineData) {
  if (!outlineData?.outline?.length) return outlineData;
  return { ...outlineData, outline: clearOutlineItemContent(outlineData.outline) };
}

const outlineSaveReasons = new Set(['sort', 'edit', 'delete', 'add-root', 'add-child', 'replace']);

function normalizeOutlineSaveReason(value) {
  return outlineSaveReasons.has(value) ? value : 'replace';
}

function normalizeStringMap(value) {
  const entries = value && typeof value === 'object' ? Object.entries(value) : [];
  const map = new Map();
  for (const [from, to] of entries) {
    const fromId = String(from || '').trim();
    const toId = String(to || '').trim();
    if (fromId && toId) map.set(fromId, toId);
  }
  return map;
}

function normalizeStringSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean));
}

function reverseIdMap(idMap) {
  const reversed = new Map();
  for (const [oldId, newId] of idMap.entries()) {
    reversed.set(newId, oldId);
  }
  return reversed;
}

function mapOutlineItems(items, mapper) {
  return (items || []).map((item) => {
    const nextItem = mapper(item);
    if (item?.children?.length) {
      nextItem.children = mapOutlineItems(item.children, mapper);
    }
    return nextItem;
  });
}

function createTechnicalPlanStore({ app, db, fileService }) {
  const tenderMarkdownPath = getTechnicalPlanTenderMarkdownPath(app);
  const tenderOriginalMarkdownPath = path.join(path.dirname(tenderMarkdownPath), 'tender-original.md');
  const tenderSourceFilesDir = path.join(path.dirname(tenderMarkdownPath), 'tender-files');
  const originalPlanMarkdownPath = getTechnicalPlanOriginalPlanMarkdownPath(app);
  const originalOutlineRuntimePath = path.join(path.dirname(originalPlanMarkdownPath), originalOutlineRuntimeFileName);
  const illustrationsDir = getTechnicalPlanIllustrationsDir(app);
  const generatedIllustrationsDir = getTechnicalPlanGeneratedIllustrationsDir(app);

  function normalizeIllustrationFilePart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'illustration';
  }

  function writeIllustrationFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    if (typeof content === 'string') {
      fs.writeFileSync(tempPath, content, 'utf-8');
    } else {
      fs.writeFileSync(tempPath, content);
    }
    fs.renameSync(tempPath, filePath);
  }

  // 独立保存 HTML 图片源文件，供转图失败或任务恢复时复用。
  function saveIllustrationHtml({ revision, itemId, content }) {
    const safeRevision = normalizeIllustrationFilePart(revision);
    const safeItemId = normalizeIllustrationFilePart(itemId);
    const relativePath = path.join('illustrations', safeRevision, 'html', `${safeItemId}.html`).replace(/\\/g, '/');
    const filePath = path.join(path.dirname(originalPlanMarkdownPath), relativePath);
    writeIllustrationFile(filePath, String(content || ''));
    return { relativePath, filePath };
  }

  // 读取此前已生成的 HTML 图片源文件。
  function readIllustrationHtml(relativePath) {
    const resolvedPath = path.resolve(path.dirname(originalPlanMarkdownPath), String(relativePath || ''));
    const root = `${path.resolve(illustrationsDir)}${path.sep}`;
    if (!resolvedPath.startsWith(root) || !fs.existsSync(resolvedPath)) return '';
    return fs.readFileSync(resolvedPath, 'utf-8');
  }

  // 按确定性路径找回已保存的 HTML 源文件，避免任务恢复时重复调用模型。
  function findIllustrationHtml({ revision, itemId }) {
    const safeRevision = normalizeIllustrationFilePart(revision);
    const safeItemId = normalizeIllustrationFilePart(itemId);
    const relativePath = path.join('illustrations', safeRevision, 'html', `${safeItemId}.html`).replace(/\\/g, '/');
    const content = readIllustrationHtml(relativePath);
    return content ? { relativePath, content } : null;
  }

  function saveIllustrationChart({ revision, itemId, spec, reference }) {
    const safeRevision = normalizeIllustrationFilePart(revision);
    const safeItemId = normalizeIllustrationFilePart(itemId);
    const relativePath = path.join('illustrations', safeRevision, 'chart', `${safeItemId}.json`).replace(/\\/g, '/');
    const filePath = path.join(path.dirname(originalPlanMarkdownPath), relativePath);
    const source = JSON.stringify(spec, null, 2);
    writeIllustrationFile(filePath, `${source}\n`);
    writeIllustrationFile(filePath.replace(/\.json$/, '.meta.json'), `${JSON.stringify({
      schema_version: 1,
      spec_hash: `sha256:${crypto.createHash('sha256').update(source).digest('hex')}`,
      reference_hash: `sha256:${crypto.createHash('sha256').update(String(reference || '')).digest('hex')}`,
      renderer_version: 1,
      chart_type: spec.chart_type,
      source_path: relativePath,
      updated_at: now(),
    }, null, 2)}\n`);
    return { relativePath, filePath };
  }

  function readIllustrationChart(relativePath) {
    const resolvedPath = path.resolve(path.dirname(originalPlanMarkdownPath), String(relativePath || ''));
    const root = `${path.resolve(illustrationsDir)}${path.sep}`;
    if (!resolvedPath.startsWith(root) || !fs.existsSync(resolvedPath)) return null;
    try { return JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')); } catch { return null; }
  }

  // 保存 HTML 截图 PNG，并返回 Renderer/导出层均可读取的资产 URL。
  function saveIllustrationPng({ revision, itemId, buffer }) {
    const safeRevision = normalizeIllustrationFilePart(revision);
    const safeItemId = normalizeIllustrationFilePart(itemId);
    const filePath = path.join(generatedIllustrationsDir, safeRevision, `${safeItemId}.png`);
    writeIllustrationFile(filePath, buffer);
    return {
      filePath,
      assetUrl: `yibiao-asset://generated-images/technical-plan/illustrations/${encodeURIComponent(safeRevision)}/${encodeURIComponent(`${safeItemId}.png`)}`,
    };
  }

  // 清理技术方案专属的图片源文件和生成图片。
  function clearIllustrationFiles() {
    fs.rmSync(illustrationsDir, { recursive: true, force: true });
    fs.rmSync(generatedIllustrationsDir, { recursive: true, force: true });
  }
  function resolvePendingTenderMarkdownPath(filePath) {
    return path.resolve(resolveMarkdownPath(filePath));
  }

  function isPendingTenderMarkdownPath(filePath) {
    const resolvedPath = resolvePendingTenderMarkdownPath(filePath);
    const expectedDir = path.resolve(path.dirname(tenderMarkdownPath));
    return path.dirname(resolvedPath).toLowerCase() === expectedDir.toLowerCase()
      && /^tender-pending-\d+\.tmp\.md$/.test(path.basename(resolvedPath));
  }

  function clearPendingTenderMeta() {
    updateMeta({
      pending_tender_markdown_path: null,
      pending_tender_file_name: null,
      pending_tender_parser_label: null,
      pending_tender_sections_json: null,
      pending_tender_total_declared: null,
      pending_tender_created_at: null,
    });
  }

  function cleanupOrphanPendingTenderFiles(activeMarkdownPath = '') {
    const targetDir = path.dirname(tenderMarkdownPath);
    if (!fs.existsSync(targetDir)) {
      return;
    }
    const activePath = activeMarkdownPath ? path.resolve(activeMarkdownPath).toLowerCase() : '';
    for (const fileName of fs.readdirSync(targetDir)) {
      if (!/^tender-pending-\d+\.tmp\.md$/.test(fileName)) {
        continue;
      }
      const filePath = path.join(targetDir, fileName);
      if (activePath && path.resolve(filePath).toLowerCase() === activePath) {
        continue;
      }
      try {
        const stats = fs.lstatSync(filePath);
        if (stats.isFile()) fs.rmSync(filePath, { force: true });
      } catch {
        // 清理孤儿临时文件失败不影响主流程
      }
    }
  }

  function removePendingTenderMarkdown(markdownPath) {
    const resolvedPath = markdownPath ? resolvePendingTenderMarkdownPath(markdownPath) : '';
    if (!resolvedPath || !isPendingTenderMarkdownPath(resolvedPath) || !fs.existsSync(resolvedPath)) {
      return;
    }
    try {
      const stats = fs.lstatSync(resolvedPath);
      if (stats.isFile()) fs.rmSync(resolvedPath, { force: true });
    } catch {
      // 清理临时文件失败不影响主流程
    }
  }

  function cleanupPendingTenderSelection() {
    const meta = ensureMetaRow();
    const pendingPath = meta.pending_tender_markdown_path || '';
    const markdownPath = pendingPath ? resolvePendingTenderMarkdownPath(pendingPath) : '';
    clearPendingTenderMeta();
    if (!markdownPath || !isPendingTenderMarkdownPath(markdownPath) || !fs.existsSync(markdownPath)) {
      cleanupOrphanPendingTenderFiles();
      return;
    }
    removePendingTenderMarkdown(markdownPath);
    cleanupOrphanPendingTenderFiles();
  }

  function cleanupLegacyPendingTenderState(meta = ensureMetaRow()) {
    const hasPendingMeta = Boolean(
      meta.pending_tender_markdown_path
      || meta.pending_tender_file_name
      || meta.pending_tender_sections_json
      || meta.pending_tender_created_at,
    );
    if (hasPendingMeta) {
      cleanupPendingTenderSelection();
      return true;
    }
    cleanupOrphanPendingTenderFiles();
    return false;
  }

  function ensureMetaRow() {
    const existing = db.prepare('SELECT * FROM technical_plan_meta WHERE id = 1').get();
    if (existing) return existing;
    const timestamp = now();
    db.prepare(`
      INSERT INTO technical_plan_meta (id, workflow_kind, step, bid_analysis_mode, outline_mode, outline_expansion_mode, created_at, updated_at)
      VALUES (1, 'technical-plan', 'document-analysis', 'key', 'aligned', 'ai-complement', @timestamp, @timestamp)
    `).run({ timestamp });
    return db.prepare('SELECT * FROM technical_plan_meta WHERE id = 1').get();
  }

  function updateMeta(fields) {
    ensureMetaRow();
    const entries = Object.entries(fields || {}).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE technical_plan_meta SET ${assignments}, updated_at = @updated_at WHERE id = 1`).run({
      ...Object.fromEntries(entries),
      updated_at: now(),
    });
  }

  function resolveMarkdownPath(relativeOrAbsolutePath) {
    const value = String(relativeOrAbsolutePath || '').trim();
    if (!value) return tenderMarkdownPath;
    return path.isAbsolute(value) ? value : path.join(path.dirname(path.dirname(tenderMarkdownPath)), value);
  }

  function readTenderMarkdown() {
    const meta = ensureMetaRow();
    const filePath = resolveMarkdownPath(meta.tender_markdown_path || tenderMarkdownRelativePath);
    if (!meta.tender_markdown_path || !fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  function loadTenderSourceFiles(meta = ensureMetaRow()) {
    const sourceFiles = safeJsonParse(meta.tender_files_json, []);
    if (Array.isArray(sourceFiles) && sourceFiles.length) {
      return sourceFiles.map((file) => ({
        id: String(file.id || ''),
        fileName: String(file.fileName || '招标文件'),
        markdownPath: String(file.markdownPath || ''),
        markdownChars: Number(file.markdownChars || 0),
        contentHash: String(file.contentHash || ''),
        parserLabel: file.parserLabel ? String(file.parserLabel) : undefined,
        importedAt: file.importedAt ? String(file.importedAt) : undefined,
        updatedAt: file.updatedAt ? String(file.updatedAt) : meta.updated_at,
      })).filter((file) => file.id && file.markdownPath);
    }
    if (meta.tender_markdown_path) {
      return [{
        id: 'tender-legacy-01',
        fileName: meta.tender_file_name || '技术方案招标文件',
        markdownPath: meta.tender_markdown_path,
        markdownChars: Number(meta.tender_markdown_chars || 0),
        contentHash: meta.tender_markdown_hash || '',
        parserLabel: meta.tender_parser_label || undefined,
        importedAt: meta.tender_imported_at || undefined,
        updatedAt: meta.updated_at,
      }];
    }
    return [];
  }

  function readTenderSourceMarkdown(sourceId) {
    const target = loadTenderSourceFiles().find((file) => file.id === String(sourceId || ''));
    if (!target) return '';
    const filePath = resolveMarkdownPath(target.markdownPath);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  }

  function readOriginalTenderMarkdown() {
    const meta = ensureMetaRow();
    if (!meta.tender_markdown_path) {
      return '';
    }
    const originalPath = meta.tender_original_markdown_path
      ? resolveMarkdownPath(meta.tender_original_markdown_path)
      : null;
    if (originalPath && fs.existsSync(originalPath)) {
      return fs.readFileSync(originalPath, 'utf-8');
    }
    throw new Error('原始招标文件缺失，请重新上传招标文件');
  }

  function writeMarkdownFile(targetPath, markdown, prefix) {
    const targetDir = path.dirname(targetPath);
    const tempPath = path.join(targetDir, `${prefix}-${Date.now()}.tmp.md`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tempPath, `${String(markdown || '').trim()}\n`, 'utf-8');
    try {
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  function checkBidSections() {
    const markdown = readOriginalTenderMarkdown();
    return detectBidSections(markdown);
  }

  function readOriginalPlanMarkdown() {
    const meta = ensureMetaRow();
    const filePath = resolveMarkdownPath(meta.original_plan_markdown_path || originalPlanMarkdownRelativePath);
    if (!meta.original_plan_markdown_path || !fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  function writeTenderSourceMarkdown(source, index) {
    const markdown = String(source?.file_content || '').trim();
    const fileName = source?.file_name || '招标文件';
    const id = createTenderSourceId(fileName, markdown, index);
    const relativePath = path.join(tenderSourceFilesDirRelativePath, `${id}-${safeFileNamePart(fileName)}.md`).replace(/\\/g, '/');
    const targetPath = resolveMarkdownPath(relativePath);
    writeMarkdownFile(targetPath, markdown, id);
    return {
      id,
      fileName,
      markdownPath: relativePath,
      markdownChars: markdown.length,
      contentHash: stableHash(markdown),
      parserLabel: source?.parser_label || undefined,
      importedAt: now(),
      updatedAt: now(),
    };
  }

  function clearTenderSourceFiles() {
    if (fs.existsSync(tenderSourceFilesDir)) {
      fs.rmSync(tenderSourceFilesDir, { recursive: true, force: true });
    }
  }

  function clearOriginalOutlineRuntime() {
    if (!fs.existsSync(originalOutlineRuntimePath)) {
      return;
    }
    fs.rmSync(originalOutlineRuntimePath, { force: true });
  }

  function readOriginalOutlineRuntime() {
    if (!fs.existsSync(originalOutlineRuntimePath)) {
      return null;
    }
    try {
      const runtime = safeJsonParse(fs.readFileSync(originalOutlineRuntimePath, 'utf-8'), null);
      if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
        clearOriginalOutlineRuntime();
        return null;
      }
      return runtime;
    } catch {
      clearOriginalOutlineRuntime();
      return null;
    }
  }

  function saveOriginalOutlineRuntime(runtime) {
    const targetDir = path.dirname(originalOutlineRuntimePath);
    const tempPath = path.join(targetDir, `original-outline-runtime-${Date.now()}.tmp.json`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(runtime || {}, null, 2)}\n`, 'utf-8');
    try {
      fs.renameSync(tempPath, originalOutlineRuntimePath);
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  function loadReferenceDocumentIds() {
    return db.prepare('SELECT document_id FROM technical_plan_reference_docs ORDER BY sort_order ASC').all()
      .map((row) => row.document_id);
  }

  function replaceReferenceDocumentIds(documentIds) {
    db.prepare('DELETE FROM technical_plan_reference_docs').run();
    const insert = db.prepare('INSERT INTO technical_plan_reference_docs (document_id, sort_order) VALUES (@document_id, @sort_order)');
    [...new Set((Array.isArray(documentIds) ? documentIds : []).map((id) => String(id || '').trim()).filter(Boolean))]
      .forEach((documentId, index) => insert.run({ document_id: documentId, sort_order: index }));
  }

  function taskFromRow(row) {
    if (!row) return undefined;
    return {
      task_id: row.task_id,
      type: row.type,
      status: normalizeStatus(row.status, ['running', 'pausing', 'paused', 'success', 'error'], 'running'),
      progress: Number(row.progress || 0),
      logs: safeJsonParse(row.logs_json, []),
      started_at: row.started_at,
      updated_at: row.updated_at,
      error: row.error || undefined,
      stats: safeJsonParse(row.stats_json, undefined),
      pause_requested: fromDbBool(row.pause_requested),
    };
  }

  function saveTask(type, task) {
    if (!task) {
      db.prepare('DELETE FROM technical_plan_tasks WHERE type = ?').run(type);
      if (type === 'bid-section-extraction') {
        updateMeta({ bid_section_extraction_status: 'idle', bid_section_extraction_error: null });
      }
      return;
    }
    const timestamp = now();
    db.prepare(`
      INSERT INTO technical_plan_tasks (type, task_id, status, progress, logs_json, stats_json, error, pause_requested, started_at, updated_at)
      VALUES (@type, @task_id, @status, @progress, @logs_json, @stats_json, @error, @pause_requested, @started_at, @updated_at)
      ON CONFLICT(type) DO UPDATE SET
        task_id = excluded.task_id,
        status = excluded.status,
        progress = excluded.progress,
        logs_json = excluded.logs_json,
        stats_json = excluded.stats_json,
        error = excluded.error,
        pause_requested = excluded.pause_requested,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `).run({
      type,
      task_id: String(task.task_id || ''),
      status: String(task.status || 'running'),
      progress: Math.max(0, Math.min(100, Math.round(Number(task.progress || 0)))),
      logs_json: JSON.stringify(Array.isArray(task.logs) ? task.logs : []),
      stats_json: jsonOrNull(task.stats),
      error: task.error ? String(task.error) : null,
      pause_requested: toDbBool(task.pause_requested),
      started_at: task.started_at || timestamp,
      updated_at: task.updated_at || timestamp,
    });
    if (type === 'bid-section-extraction') {
      updateMeta({
        bid_section_extraction_status: normalizeBidSectionExtractionStatus(task.status),
        bid_section_extraction_error: task.error ? String(task.error) : null,
      });
    }
  }

  function loadTasks() {
    const rows = db.prepare('SELECT * FROM technical_plan_tasks').all();
    const tasks = {};
    for (const row of rows) {
      const field = taskTypeFields[row.type];
      if (field) tasks[field] = taskFromRow(row);
    }
    return tasks;
  }

  function loadBidItems() {
    const rows = db.prepare('SELECT * FROM technical_plan_bid_items ORDER BY sort_order ASC, item_id ASC').all();
    return rows.reduce((acc, row) => {
      acc[row.item_id] = bidItemFromRow(row);
      return acc;
    }, {});
  }

  function getBidItemSortOrder(itemId) {
    const fullTasks = getAllBidAnalysisTasks();
    const index = fullTasks.findIndex((task) => task.id === itemId);
    return index >= 0 ? index : 9999;
  }

  function getBidItemLabel(itemId, fallbackLabel) {
    const task = getBidAnalysisTasks('full').find((item) => item.id === itemId) || getBidAnalysisTasks('key').find((item) => item.id === itemId);
    return fallbackLabel || task?.label || itemId;
  }

  function saveBidItems(tasks, mode) {
    const entries = Object.entries(tasks || {});
    if (!entries.length) {
      db.prepare('DELETE FROM technical_plan_bid_items').run();
      return;
    }

    const upsert = db.prepare(`
      INSERT INTO technical_plan_bid_items (
        item_id, label, status, content, normalized_hash, error,
        analysis_context_json, diagnostic_json, requires_manual_review,
        sort_order, updated_at
      )
      VALUES (
        @item_id, @label, @status, @content, @normalized_hash, @error,
        @analysis_context_json, @diagnostic_json, @requires_manual_review,
        @sort_order, @updated_at
      )
      ON CONFLICT(item_id) DO UPDATE SET
        label = excluded.label,
        status = excluded.status,
        content = excluded.content,
        normalized_hash = CASE
          WHEN @has_normalized_hash = 1 THEN excluded.normalized_hash
          ELSE technical_plan_bid_items.normalized_hash
        END,
        error = excluded.error,
        analysis_context_json = excluded.analysis_context_json,
        diagnostic_json = excluded.diagnostic_json,
        requires_manual_review = excluded.requires_manual_review,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const [itemId, task] of entries) {
      const contract = normalizeBidAnalysisItemContract(task);
      upsert.run({
        item_id: itemId,
        label: getBidItemLabel(itemId, task?.label),
        status: normalizeStatus(task?.status, ['idle', 'running', 'success', 'error'], 'idle'),
        content: String(task?.content || ''),
        normalized_hash: task?.normalized_hash ? String(task.normalized_hash) : null,
        has_normalized_hash: hasOwn(task, 'normalized_hash') && task.normalized_hash !== undefined ? 1 : 0,
        error: task?.error ? String(task.error) : null,
        analysis_context_json: jsonOrNull(contract.analysisContext),
        diagnostic_json: jsonOrNull(contract.diagnostic),
        requires_manual_review: toDbBool(contract.requiresManualReview),
        sort_order: getBidItemSortOrder(itemId, mode),
        updated_at: task?.updated_at || timestamp,
      });
    }
  }

  function upsertDerivedBidItem(itemId, content, mode) {
    const label = getBidItemLabel(itemId);
    const value = String(content || '');
    db.prepare(`
      INSERT INTO technical_plan_bid_items (
        item_id, label, status, content, error,
        analysis_context_json, diagnostic_json, requires_manual_review,
        sort_order, updated_at
      )
      VALUES (
        @item_id, @label, @status, @content, NULL,
        NULL, NULL, 0,
        @sort_order, @updated_at
      )
      ON CONFLICT(item_id) DO UPDATE SET
        label = excluded.label,
        status = excluded.status,
        content = excluded.content,
        error = NULL,
        analysis_context_json = NULL,
        diagnostic_json = NULL,
        requires_manual_review = 0,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run({
      item_id: itemId,
      label,
      status: value.trim() ? 'success' : 'idle',
      content: value,
      sort_order: getBidItemSortOrder(itemId, mode),
      updated_at: now(),
    });
  }

  function calculateBidProgress(mode, bidTasks, selectedTaskIds) {
    const selectedIds = getBidAnalysisTaskIdsForConfig(mode, selectedTaskIds);
    if (!selectedIds.length) return 0;
    const done = selectedIds.filter((taskId) => ['success', 'error'].includes(bidTasks[taskId]?.status)).length;
    return Math.round((done / selectedIds.length) * 100);
  }

  function validateStoredOutlineNodeJson(nodeId) {
    const row = db.prepare(`
      SELECT node_id, knowledge_item_ids_json, format_constraints_json, response_state_json, quality_metadata_json, content
      FROM technical_plan_outline_nodes
      WHERE node_id = ?
    `).get(nodeId);
    if (!row) return null;
    const knowledgeItemIds = normalizeStringArray(
      safeJsonParse(row.knowledge_item_ids_json, []),
      [],
      `目录节点 ${row.node_id}.knowledge_item_ids_json`,
    );
    normalizeOutlineFormatConstraints(row.format_constraints_json);
    normalizeOutlineResponseState(row.response_state_json, {
      content: row.content,
      knowledgeItemIds,
    });
    normalizeOutlineFocusMetadata(safeJsonParse(row.quality_metadata_json, undefined));
    return row;
  }

  function loadOutlineData(meta) {
    const rows = db.prepare('SELECT * FROM technical_plan_outline_nodes ORDER BY level ASC, parent_node_id ASC, sort_order ASC').all();
    if (!rows.length) return null;

    const map = new Map();
    for (const row of rows) {
      const legacyKnowledgeItemIds = normalizeStringArray(safeJsonParse(row.knowledge_item_ids_json, []), [], `目录节点 ${row.node_id}.knowledge_item_ids_json`);
      const formatConstraints = normalizeOutlineFormatConstraints(row.format_constraints_json);
      const responseState = normalizeOutlineResponseState(row.response_state_json, {
        content: row.content,
        knowledgeItemIds: legacyKnowledgeItemIds,
      });
      const qualityMetadata = normalizeOutlineFocusMetadata(safeJsonParse(row.quality_metadata_json, undefined));
      map.set(row.node_id, applyOutlinePersistenceFields({
        id: row.node_id,
        title: row.title,
        description: row.description || '',
        source_requirement_id: row.source_requirement_id || undefined,
        source_requirement_title: row.source_requirement_title || undefined,
        content: row.content || '',
        children: [],
      }, formatConstraints, responseState, qualityMetadata));
    }

    const roots = [];
    for (const row of rows) {
      const item = map.get(row.node_id);
      if (!item) continue;
      if (row.parent_node_id && map.has(row.parent_node_id)) {
        map.get(row.parent_node_id).children.push(item);
      } else {
        roots.push(item);
      }
    }

    function cleanup(item) {
      if (!item.children.length) {
        delete item.children;
      } else {
        item.children.forEach(cleanup);
      }
      if (!item.knowledge_item_ids?.length) delete item.knowledge_item_ids;
      if (!item.template_values) delete item.template_values;
      if (!item.compliance_message) delete item.compliance_message;
      if (!item.content) delete item.content;
      return item;
    }

    return {
      outline: roots.map(cleanup),
      project_name: meta.outline_project_name || undefined,
      project_overview: meta.outline_project_overview || undefined,
    };
  }

  function saveOutlineData(outlineData) {
    if (!outlineData?.outline?.length) {
      db.prepare('DELETE FROM technical_plan_outline_nodes').run();
      updateMeta({ outline_project_name: null, outline_project_overview: null });
      return;
    }

    assertFormatConstrainedOutlineMutation(outlineData);
    const rows = flattenOutlineItems(outlineData.outline);
    const nextIds = new Set(rows.map((row) => row.node_id));
    const existingRows = new Map(db.prepare(`
      SELECT node_id, knowledge_item_ids_json, format_constraints_json, response_state_json, quality_metadata_json, content
      FROM technical_plan_outline_nodes
    `).all().map((row) => [row.node_id, row]));
    const existingRowsByFormatNodeId = new Map();
    for (const existingRow of existingRows.values()) {
      const existingKnowledgeItemIds = normalizeStringArray(
        safeJsonParse(existingRow.knowledge_item_ids_json, []),
        [],
        `目录节点 ${existingRow.node_id}.knowledge_item_ids_json`,
      );
      const constraints = normalizeOutlineFormatConstraints(existingRow.format_constraints_json);
      if (constraints.format_node_id) existingRowsByFormatNodeId.set(constraints.format_node_id, existingRow);
      normalizeOutlineResponseState(existingRow.response_state_json, {
        content: existingRow.content,
        knowledgeItemIds: existingKnowledgeItemIds,
      });
      normalizeOutlineFocusMetadata(safeJsonParse(existingRow.quality_metadata_json, undefined));
    }
    const upsert = db.prepare(`
      INSERT INTO technical_plan_outline_nodes (
        node_id, parent_node_id, sort_order, level, title, description, source_requirement_id,
        source_requirement_title, knowledge_item_ids_json, format_constraints_json, response_state_json, quality_metadata_json,
        content, created_at, updated_at
      ) VALUES (
        @node_id, @parent_node_id, @sort_order, @level, @title, @description, @source_requirement_id,
        @source_requirement_title, @knowledge_item_ids_json, @format_constraints_json, @response_state_json, @quality_metadata_json,
        @content, @created_at, @updated_at
      ) ON CONFLICT(node_id) DO UPDATE SET
        parent_node_id = excluded.parent_node_id,
        sort_order = excluded.sort_order,
        level = excluded.level,
        title = excluded.title,
        description = excluded.description,
        source_requirement_id = excluded.source_requirement_id,
        source_requirement_title = excluded.source_requirement_title,
        knowledge_item_ids_json = excluded.knowledge_item_ids_json,
        format_constraints_json = excluded.format_constraints_json,
        response_state_json = excluded.response_state_json,
        quality_metadata_json = excluded.quality_metadata_json,
        content = excluded.content,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const row of rows) {
      const directExistingRow = existingRows.get(row.node_id);
      const incomingFormatNodeId = row.format_constraints_patch?.format_node_id;
      const existingRow = directExistingRow
        || (incomingFormatNodeId ? existingRowsByFormatNodeId.get(incomingFormatNodeId) : null);
      const existingKnowledgeItemIds = normalizeStringArray(
        safeJsonParse(existingRow?.knowledge_item_ids_json, []),
        [],
        `目录节点 ${row.node_id}.knowledge_item_ids_json`,
      );
      const incomingKnowledgeItemIds = row.has_knowledge_item_ids
        ? normalizeStringArray(safeJsonParse(row.knowledge_item_ids_json, []), [], `目录节点 ${row.node_id}.knowledge_item_ids_json`)
        : existingKnowledgeItemIds;
      const existingFormatConstraints = normalizeOutlineFormatConstraints(existingRow?.format_constraints_json);
      const formatConstraints = normalizeOutlineFormatConstraints({
        ...existingFormatConstraints,
        ...(hasFields(row.format_constraints_patch) ? row.format_constraints_patch : {}),
      });
      if (existingRow) {
        for (const field of outlineFormatConstraintFields.filter((name) => !['mapped_requirement_ids', 'manual_input_required'].includes(name))) {
          if (JSON.stringify(existingFormatConstraints[field] ?? null) !== JSON.stringify(formatConstraints[field] ?? null)) {
            throw new Error(`目录格式约束不能通过通用工作区写入修改：${row.title}.${field}`);
          }
        }
      }
      const existingResponseState = existingRow
        ? normalizeOutlineResponseState(existingRow.response_state_json, {
          content: existingRow.content,
          knowledgeItemIds: existingKnowledgeItemIds,
        })
        : {};
      const responseStateSource = {
        ...existingResponseState,
        ...(hasFields(row.response_state_patch) ? row.response_state_patch : {}),
      };
      if (row.has_knowledge_item_ids) {
        responseStateSource.knowledge_item_ids = incomingKnowledgeItemIds;
      }
      const responseState = normalizeOutlineResponseState(responseStateSource, {
        content: row.content,
        knowledgeItemIds: incomingKnowledgeItemIds,
      });
      const existingQualityMetadata = normalizeOutlineFocusMetadata(
        safeJsonParse(existingRow?.quality_metadata_json, undefined),
      );
      const qualityMetadata = normalizeOutlineFocusMetadata({
        ...existingQualityMetadata,
        ...(hasFields(row.quality_metadata_patch) ? row.quality_metadata_patch : {}),
      });
      upsert.run({
        node_id: row.node_id,
        parent_node_id: row.parent_node_id,
        sort_order: row.sort_order,
        level: row.level,
        title: row.title,
        description: row.description,
        source_requirement_id: row.source_requirement_id,
        source_requirement_title: row.source_requirement_title,
        knowledge_item_ids_json: responseState.knowledge_item_ids.length ? JSON.stringify(responseState.knowledge_item_ids) : null,
        format_constraints_json: JSON.stringify(formatConstraints),
        response_state_json: JSON.stringify(responseState),
        quality_metadata_json: JSON.stringify(qualityMetadata),
        content: row.content,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    const existingIds = db.prepare('SELECT node_id FROM technical_plan_outline_nodes').all().map((row) => row.node_id);
    const deleteNode = db.prepare('DELETE FROM technical_plan_outline_nodes WHERE node_id = ?');
    for (const nodeId of existingIds) {
      if (!nextIds.has(nodeId)) deleteNode.run(nodeId);
    }

    updateMeta({
      outline_project_name: outlineData.project_name || null,
      outline_project_overview: outlineData.project_overview || null,
      outline_quality_review_json: null,
    });
  }

  function loadContentSections(outlineData) {
    const rows = db.prepare(`
      SELECT s.node_id, s.status, s.error, s.updated_at, n.title, n.content
      FROM technical_plan_content_sections s
      JOIN technical_plan_outline_nodes n ON n.node_id = s.node_id
    `).all();
    const sections = rows.reduce((acc, row) => {
      acc[row.node_id] = {
        id: row.node_id,
        title: row.title || '未命名章节',
        status: normalizeStatus(row.status, ['idle', 'running', 'success', 'error'], 'idle'),
        content: row.content || '',
        error: row.error || undefined,
        updated_at: row.updated_at || undefined,
      };
      return acc;
    }, {});

    for (const item of collectLeafItems(outlineData?.outline || [])) {
      if (!sections[item.id] && item.content?.trim()) {
        sections[item.id] = {
          id: item.id,
          title: item.title || '未命名章节',
          status: 'success',
          content: item.content,
        };
      }
    }

    return sections;
  }

  function saveContentSections(sections) {
    const entries = Object.entries(sections || {});
    if (!entries.length) {
      db.prepare('DELETE FROM technical_plan_content_sections').run();
      return;
    }

    const storedRows = new Map();
    for (const [nodeId, section] of entries) {
      const row = validateStoredOutlineNodeJson(nodeId);
      storedRows.set(nodeId, row);
      if (!row || !hasOwn(section || {}, 'content')) continue;
    }

    const nextIds = new Set(entries.map(([nodeId]) => nodeId));
    const upsert = db.prepare(`
      INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
      VALUES (@node_id, @status, @error, @updated_at)
      ON CONFLICT(node_id) DO UPDATE SET
        status = excluded.status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `);
    const updateContent = db.prepare('UPDATE technical_plan_outline_nodes SET content = @content, updated_at = @updated_at WHERE node_id = @node_id');
    const timestamp = now();
    for (const [nodeId, section] of entries) {
      upsert.run({
        node_id: nodeId,
        status: normalizeStatus(section?.status, ['idle', 'running', 'success', 'error'], 'idle'),
        error: section?.error ? String(section.error) : null,
        updated_at: section?.updated_at || timestamp,
      });
      const storedRow = storedRows.get(nodeId);
      if (hasOwn(section, 'content') && storedRow) {
        updateContent.run({ node_id: nodeId, content: String(section.content || ''), updated_at: timestamp });
      }
    }

    const deleteSection = db.prepare('DELETE FROM technical_plan_content_sections WHERE node_id = ?');
    for (const row of db.prepare('SELECT node_id FROM technical_plan_content_sections').all()) {
      if (!nextIds.has(row.node_id)) deleteSection.run(row.node_id);
    }
  }

  function loadContentPlans() {
    return db.prepare('SELECT * FROM technical_plan_content_plans').all().reduce((acc, row) => {
      const storedPlan = safeJsonParse(row.plan_json, null);
      if (storedPlan?.plan && Number(storedPlan.plan_version) > 0) {
        acc[row.node_id] = {
          plan_version: Number(storedPlan.plan_version),
          plan: storedPlan.plan,
          ...(storedPlan.fingerprint ? { fingerprint: storedPlan.fingerprint } : {}),
          ...(storedPlan.table_requirement ? { table_requirement: storedPlan.table_requirement } : {}),
          updated_at: row.updated_at || undefined,
        };
      }
      return acc;
    }, {});
  }

  function normalizeGlobalFactGroups(groups) {
    const seen = new Set();
    return (Array.isArray(groups) ? groups : []).map((group, index) => {
      const title = String(group?.title || '').trim();
      const content = String(group?.content || '').trim();
      if (!title || !content) return null;
      let id = normalizeGlobalFactId(group?.id || group?.group_id || title, index);
      let suffix = 2;
      while (seen.has(id)) {
        id = `${id}_${suffix}`;
        suffix += 1;
      }
      seen.add(id);
      return {
        id,
        title,
        content,
        updated_at: group?.updated_at || group?.updatedAt || now(),
      };
    }).filter(Boolean);
  }

  function loadGlobalFacts() {
    return db.prepare('SELECT * FROM technical_plan_global_fact_groups ORDER BY sort_order ASC, group_id ASC').all().map((row) => ({
      id: row.group_id,
      title: row.title,
      content: row.content || '',
      updated_at: row.updated_at || undefined,
    }));
  }

  function replaceGlobalFacts(groups) {
    const normalized = normalizeGlobalFactGroups(groups);
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    if (!normalized.length) return;

    const insert = db.prepare(`
      INSERT INTO technical_plan_global_fact_groups (group_id, title, content, sort_order, created_at, updated_at)
      VALUES (@group_id, @title, @content, @sort_order, @created_at, @updated_at)
    `);
    const timestamp = now();
    normalized.forEach((group, index) => insert.run({
      group_id: group.id,
      title: group.title,
      content: group.content,
      sort_order: index,
      created_at: timestamp,
      updated_at: group.updated_at || timestamp,
    }));
  }

  function saveContentPlans(plans) {
    const entries = Object.entries(plans || {}).filter(([, value]) => value?.plan && Number(value.plan_version) > 0);
    if (!entries.length) {
      db.prepare('DELETE FROM technical_plan_content_plans').run();
      return;
    }

    const nextIds = new Set(entries.map(([nodeId]) => nodeId));
    const upsert = db.prepare(`
      INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at)
      VALUES (@node_id, @plan_json, @updated_at)
      ON CONFLICT(node_id) DO UPDATE SET
        plan_json = excluded.plan_json,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const [nodeId, value] of entries) {
      if (!value?.plan) continue;
      upsert.run({
        node_id: nodeId,
        plan_json: JSON.stringify({
          plan_version: Number(value.plan_version),
          plan: value.plan,
          ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
          ...(value.table_requirement ? { table_requirement: value.table_requirement } : {}),
        }),
        updated_at: value.updated_at || timestamp,
      });
    }

    const deletePlan = db.prepare('DELETE FROM technical_plan_content_plans WHERE node_id = ?');
    for (const row of db.prepare('SELECT node_id FROM technical_plan_content_plans').all()) {
      if (!nextIds.has(row.node_id)) deletePlan.run(row.node_id);
    }
  }

  const updateGeneratedContent = db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?');
  const upsertGeneratedSection = db.prepare(`
    INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
    VALUES (@node_id, @status, @error, @updated_at)
    ON CONFLICT(node_id) DO UPDATE SET
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);
  const upsertGeneratedPlan = db.prepare(`
    INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at)
    VALUES (@node_id, @plan_json, @updated_at)
    ON CONFLICT(node_id) DO UPDATE SET
      plan_json = excluded.plan_json,
      updated_at = excluded.updated_at
  `);
  const saveContentGenerationItemTransaction = db.transaction(({ nodeId, section, storedPlan, runtime }) => {
    const timestamp = now();
    if (section) {
      updateGeneratedContent.run(String(section.content || ''), timestamp, nodeId);
      upsertGeneratedSection.run({
        node_id: nodeId,
        status: normalizeStatus(section.status, ['idle', 'running', 'success', 'error'], 'idle'),
        error: section.error ? String(section.error) : null,
        updated_at: section.updated_at || timestamp,
      });
    }
    if (storedPlan) {
      upsertGeneratedPlan.run({
        node_id: nodeId,
        plan_json: JSON.stringify({
          plan_version: Number(storedPlan.plan_version),
          plan: storedPlan.plan,
          ...(storedPlan.fingerprint ? { fingerprint: storedPlan.fingerprint } : {}),
          ...(storedPlan.table_requirement ? { table_requirement: storedPlan.table_requirement } : {}),
        }),
        updated_at: storedPlan.updated_at || timestamp,
      });
    }
    if (runtime !== undefined) updateMeta({ content_generation_runtime_json: jsonOrNull(runtime) });
  });

  function saveContentGenerationItem(partial = {}) {
    saveContentGenerationItemTransaction(partial);
  }

  function clearDownstreamFromTender() {
    db.prepare('DELETE FROM technical_plan_tasks').run();
    db.prepare('DELETE FROM technical_plan_bid_items').run();
    db.prepare('DELETE FROM technical_plan_response_templates').run();
    db.prepare('DELETE FROM technical_plan_reference_docs').run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    clearOriginalOutlineRuntime();
    updateMeta({
      step: 'document-analysis',
      bid_analysis_mode: 'key',
      bid_analysis_selected_task_ids_json: null,
      outline_mode: 'aligned',
      outline_expansion_mode: 'ai-complement',
      outline_word_control_options_json: null,
      outline_word_control_snapshot_json: null,
      outline_project_name: null,
      outline_project_overview: null,
      content_generation_options_json: null,
      content_generation_runtime_json: null,
      content_illustration_plan_json: null,
      requirement_response_matrix_json: null,
      outline_quality_review_json: null,
      outline_word_control_snapshot_json: null,
      pending_tender_markdown_path: null,
      pending_tender_file_name: null,
      pending_tender_parser_label: null,
      pending_tender_sections_json: null,
      pending_tender_total_declared: null,
      pending_tender_created_at: null,
      bid_section_mode: 'single',
      bid_sections_json: null,
      bid_section_extraction_status: 'idle',
      bid_section_extraction_error: null,
      selected_section_id: null,
      selected_section_title: null,
      selected_format_profile_id: null,
      selected_format_profile_hash: null,
    });
  }

  function clearDownstreamFromBidSectionChange() {
    db.prepare('DELETE FROM technical_plan_tasks').run();
    db.prepare('DELETE FROM technical_plan_bid_items').run();
    db.prepare('DELETE FROM technical_plan_response_templates').run();
    db.prepare('DELETE FROM technical_plan_reference_docs').run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    clearOriginalOutlineRuntime();
    updateMeta({
      step: 'bid-analysis',
      content_generation_options_json: null,
      content_generation_runtime_json: null,
      content_illustration_plan_json: null,
      requirement_response_matrix_json: null,
      outline_quality_review_json: null,
      outline_project_name: null,
      outline_project_overview: null,
      outline_word_control_snapshot_json: null,
      selected_format_profile_id: null,
      selected_format_profile_hash: null,
    });
  }

  function clearContentGenerationState() {
    const timestamp = now();
    const rows = db.prepare(`
      SELECT node_id, content, knowledge_item_ids_json, format_constraints_json, response_state_json
      FROM technical_plan_outline_nodes
    `).all();
    const resetNode = db.prepare(`
      UPDATE technical_plan_outline_nodes
      SET content = '', knowledge_item_ids_json = NULL, response_state_json = @response_state_json, updated_at = @updated_at
      WHERE node_id = @node_id
    `);
    for (const row of rows) {
      normalizeOutlineResponseState(row.response_state_json, {
        content: row.content,
        knowledgeItemIds: normalizeStringArray(
          safeJsonParse(row.knowledge_item_ids_json, []),
          [],
          `目录节点 ${row.node_id}.knowledge_item_ids_json`,
        ),
      });
      resetNode.run({
        node_id: row.node_id,
        response_state_json: JSON.stringify({
          knowledge_item_ids: [],
          response_status: 'pending',
          compliance_risk: 'none',
        }),
        updated_at: timestamp,
      });
    }
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();
    db.prepare("DELETE FROM technical_plan_tasks WHERE type = 'content-generation'").run();
    updateMeta({
      content_generation_runtime_json: null,
      content_illustration_plan_json: null,
      outline_quality_review_json: null,
    });
  }

  function clearDownstreamFromOriginalPlan() {
    db.prepare("DELETE FROM technical_plan_tasks WHERE type IN ('outline-generation', 'global-facts-generation', 'content-generation')").run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();
    clearOriginalOutlineRuntime();
    updateMeta({
      step: 'document-analysis',
      outline_project_name: null,
      outline_project_overview: null,
      content_generation_runtime_json: null,
      content_illustration_plan_json: null,
      outline_quality_review_json: null,
    });
  }

  function assertNoTechnicalPlanTaskRunning() {
    const row = db.prepare("SELECT type FROM technical_plan_tasks WHERE status IN ('running', 'pausing') LIMIT 1").get();
    if (row) {
      throw new Error('当前有技术方案任务正在运行，请等待任务结束后再切换模式');
    }
  }

  // 正文任务活动或暂停期间禁止手工保存，避免清空待恢复的图片计划。
  function assertContentEditingAllowed() {
    const row = db.prepare("SELECT status FROM technical_plan_tasks WHERE type = 'content-generation' AND status IN ('running', 'pausing', 'paused') LIMIT 1").get();
    if (row) {
      throw new Error('当前正文生成任务正在运行或已暂停，请先完成任务再编辑正文');
    }
  }

  function clearWorkflowSpecificState(workflowKind) {
    db.prepare("DELETE FROM technical_plan_tasks WHERE type IN ('outline-generation', 'global-facts-generation', 'content-generation')").run();
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    clearOriginalOutlineRuntime();
    updateMeta({
      workflow_kind: normalizeWorkflowKind(workflowKind),
      step: 'document-analysis',
      outline_expansion_mode: 'ai-complement',
      outline_word_control_options_json: null,
      outline_word_control_snapshot_json: null,
      original_plan_file_name: null,
      original_plan_markdown_path: null,
      original_plan_markdown_hash: null,
      original_plan_markdown_chars: 0,
      original_plan_parser_label: null,
      original_plan_imported_at: null,
      outline_project_name: null,
      outline_project_overview: null,
      content_generation_options_json: null,
      content_generation_runtime_json: null,
      content_illustration_plan_json: null,
      outline_quality_review_json: null,
    });
  }

  function loadOutlinePersistenceSnapshot() {
    return {
      nodes: db.prepare(`
        SELECT node_id, content, knowledge_item_ids_json, format_constraints_json, response_state_json
        FROM technical_plan_outline_nodes
      `).all().reduce((acc, row) => {
        const knowledgeItemIds = normalizeStringArray(
          safeJsonParse(row.knowledge_item_ids_json, []),
          [],
          `目录节点 ${row.node_id}.knowledge_item_ids_json`,
        );
        acc[row.node_id] = {
          content: row.content || '',
          formatConstraints: normalizeOutlineFormatConstraints(row.format_constraints_json),
          responseState: normalizeOutlineResponseState(row.response_state_json, {
            content: row.content,
            knowledgeItemIds,
          }),
        };
        return acc;
      }, {}),
      sections: db.prepare('SELECT node_id, status, error, updated_at FROM technical_plan_content_sections').all(),
      plans: db.prepare('SELECT node_id, plan_json, updated_at FROM technical_plan_content_plans').all(),
    };
  }

  function assertOutlineMutationAllowed() {
    const task = db.prepare("SELECT status FROM technical_plan_tasks WHERE type = 'content-generation'").get();
    if (['running', 'pausing', 'paused'].includes(task?.status)) {
      throw new Error('正文生成任务正在运行或暂停中，请结束后再调整目录');
    }
  }

  function shouldClearSavedNode({ clearAll, oldId, newId, affectedIds }) {
    return clearAll || affectedIds.has(oldId) || (!oldId && affectedIds.has(newId));
  }

  function buildOutlineWithPersistedContent(outlineData, { snapshot, reverseMap, affectedIds, clearAll }) {
    if (!outlineData?.outline?.length) return outlineData;
    return {
      ...outlineData,
      outline: mapOutlineItems(outlineData.outline, (item) => {
        const newId = String(item?.id || '').trim();
        const oldId = reverseMap.get(newId) || newId;
        const clearContent = shouldClearSavedNode({ clearAll, oldId, newId, affectedIds });
        const oldNode = snapshot.nodes[oldId];
        const oldContent = oldNode?.content;
        let nextItem = {
          ...item,
          content: clearContent ? '' : String(oldContent ?? item?.content ?? ''),
        };
        if (oldNode) {
          const formatConstraints = normalizeOutlineFormatConstraints({
            ...oldNode.formatConstraints,
            ...extractOwnFields(item, outlineFormatConstraintFields),
          });
          const responseState = normalizeOutlineResponseState({
            ...oldNode.responseState,
            ...extractOwnFields(item, outlineResponseStateFields),
          }, {
            content: nextItem.content,
            knowledgeItemIds: oldNode.responseState.knowledge_item_ids,
          });
          nextItem = applyOutlinePersistenceFields(nextItem, formatConstraints, responseState);
        }
        return nextItem;
      }),
    };
  }

  function restoreMappedContentRows({ snapshot, idMap, affectedIds, nextIds, clearAll }) {
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();

    if (clearAll || !nextIds.size) return;

    const insertSection = db.prepare(`
      INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
      VALUES (@node_id, @status, @error, @updated_at)
    `);
    const seenSections = new Set();
    for (const row of snapshot.sections) {
      const oldId = String(row.node_id || '').trim();
      const newId = idMap.get(oldId) || oldId;
      if (!newId || !nextIds.has(newId) || seenSections.has(newId)) continue;
      if (shouldClearSavedNode({ clearAll, oldId, newId, affectedIds })) continue;
      seenSections.add(newId);
      insertSection.run({
        node_id: newId,
        status: normalizeStatus(row.status, ['idle', 'running', 'success', 'error'], 'idle'),
        error: row.error || null,
        updated_at: row.updated_at || now(),
      });
    }

    const insertPlan = db.prepare(`
      INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at)
      VALUES (@node_id, @plan_json, @updated_at)
    `);
    const seenPlans = new Set();
    for (const row of snapshot.plans) {
      const oldId = String(row.node_id || '').trim();
      const newId = idMap.get(oldId) || oldId;
      if (!newId || !nextIds.has(newId) || seenPlans.has(newId)) continue;
      if (shouldClearSavedNode({ clearAll, oldId, newId, affectedIds })) continue;
      if (!row.plan_json) continue;
      seenPlans.add(newId);
      insertPlan.run({
        node_id: newId,
        plan_json: row.plan_json,
        updated_at: row.updated_at || now(),
      });
    }
  }

  function applyPartial(partial) {
    const meta = ensureMetaRow();
    const metaUpdates = {};

    if (hasOwn(partial, 'workflowKind')) metaUpdates.workflow_kind = normalizeWorkflowKind(partial.workflowKind);
    if (hasOwn(partial, 'step') && isValidStep(partial.step)) metaUpdates.step = partial.step;
    if (hasOwn(partial, 'bidAnalysisMode') && isValidBidMode(partial.bidAnalysisMode)) metaUpdates.bid_analysis_mode = partial.bidAnalysisMode;
    if (hasOwn(partial, 'bidAnalysisSelectedTaskIds')) metaUpdates.bid_analysis_selected_task_ids_json = jsonOrNull(normalizeBidAnalysisTaskIds(partial.bidAnalysisSelectedTaskIds));
    if (hasOwn(partial, 'bidSectionMode')) metaUpdates.bid_section_mode = normalizeBidSectionMode(partial.bidSectionMode);
    if (hasOwn(partial, 'bidSections')) metaUpdates.bid_sections_json = jsonOrNull(normalizeBidSections(partial.bidSections));
    if (hasOwn(partial, 'bidSectionExtractionStatus')) metaUpdates.bid_section_extraction_status = normalizeBidSectionExtractionStatus(partial.bidSectionExtractionStatus);
    if (hasOwn(partial, 'bidSectionExtractionError')) metaUpdates.bid_section_extraction_error = partial.bidSectionExtractionError ? String(partial.bidSectionExtractionError) : null;
    if (hasOwn(partial, 'outlineMode') && isValidOutlineMode(partial.outlineMode)) metaUpdates.outline_mode = partial.outlineMode;
    if (hasOwn(partial, 'outlineExpansionMode') && isValidOutlineExpansionMode(partial.outlineExpansionMode)) metaUpdates.outline_expansion_mode = partial.outlineExpansionMode;
    if (hasOwn(partial, 'outlineWordControlOptions')) metaUpdates.outline_word_control_options_json = jsonOrNull(normalizeOutlineWordControlOptions(partial.outlineWordControlOptions));
    if (hasOwn(partial, 'outlineWordControlSnapshot')) metaUpdates.outline_word_control_snapshot_json = partial.outlineWordControlSnapshot == null
      ? null
      : jsonOrNull(normalizeOutlineWordControlOptions(partial.outlineWordControlSnapshot));
    if (hasOwn(partial, 'contentGenerationOptions')) metaUpdates.content_generation_options_json = jsonOrNull(partial.contentGenerationOptions);
    if (hasOwn(partial, 'contentGenerationRuntime')) metaUpdates.content_generation_runtime_json = jsonOrNull(partial.contentGenerationRuntime);
    if (hasOwn(partial, 'contentIllustrationPlan')) metaUpdates.content_illustration_plan_json = jsonOrNull(partial.contentIllustrationPlan);
    if (hasOwn(partial, 'requirementResponseMatrix')) {
      metaUpdates.requirement_response_matrix_json = jsonOrNull(
        partial.requirementResponseMatrix == null
          ? null
          : normalizeRequirementResponseMatrix(partial.requirementResponseMatrix),
      );
    }
    if (hasOwn(partial, 'outlineQualityReview')) metaUpdates.outline_quality_review_json = jsonOrNull(partial.outlineQualityReview);

    if (Object.keys(metaUpdates).length) updateMeta(metaUpdates);

    const nextBidMode = isValidBidMode(partial.bidAnalysisMode) ? partial.bidAnalysisMode : meta.bid_analysis_mode;
    if (hasOwn(partial, 'referenceKnowledgeDocumentIds')) replaceReferenceDocumentIds(partial.referenceKnowledgeDocumentIds);
    if (hasOwn(partial, 'bidAnalysisTasks')) {
      const incomingFormatTask = partial.bidAnalysisTasks?.responseFileRequirements;
      if (incomingFormatTask?.status === 'success') {
        const existingFormatTask = db.prepare('SELECT content FROM technical_plan_bid_items WHERE item_id = ?').get('responseFileRequirements');
        if (String(existingFormatTask?.content || '') !== String(incomingFormatTask.content || '')) {
          clearDownstreamFromFormatAnalysisChange();
        }
      }
      saveBidItems(partial.bidAnalysisTasks, nextBidMode);
    }
    if (hasOwn(partial, 'projectOverview')) upsertDerivedBidItem('projectOverview', partial.projectOverview, nextBidMode);
    if (hasOwn(partial, 'techRequirements')) upsertDerivedBidItem('techRequirements', partial.techRequirements, nextBidMode);
    if (hasOwn(partial, 'globalFacts')) {
      replaceGlobalFacts(partial.globalFacts);
      clearContentGenerationState();
    }

    for (const [field, type] of Object.entries(taskFieldTypes)) {
      if (hasOwn(partial, field)) saveTask(type, partial[field]);
    }

    if (hasOwn(partial, 'outlineData')) {
      if (partial.outlineData === null) {
        db.prepare('DELETE FROM technical_plan_outline_nodes').run();
        updateMeta({ outline_project_name: null, outline_project_overview: null, outline_quality_review_json: null, outline_word_control_snapshot_json: null });
      } else {
        saveOutlineData(partial.outlineData);
      }
    }
    if (hasOwn(partial, 'outlineQualityReview')) {
      updateMeta({ outline_quality_review_json: jsonOrNull(partial.outlineQualityReview) });
    }

    if (hasOwn(partial, 'contentGenerationSections')) saveContentSections(partial.contentGenerationSections);
    if (hasOwn(partial, 'contentGenerationPlans')) saveContentPlans(partial.contentGenerationPlans);
  }

  function loadTechnicalPlan() {
    let meta = ensureMetaRow();
    if (cleanupLegacyPendingTenderState(meta)) {
      meta = ensureMetaRow();
    }
    const bidAnalysisMode = isValidBidMode(meta.bid_analysis_mode) ? meta.bid_analysis_mode : 'key';
    const bidAnalysisSelectedTaskIds = getBidAnalysisTaskIdsForConfig(
      bidAnalysisMode,
      safeJsonParse(meta.bid_analysis_selected_task_ids_json, []),
    );
    const bidAnalysisTasks = loadBidItems();
    const storedStep = isValidStep(meta.step) ? meta.step : 'document-analysis';
    const requiresBidAnalysisRecovery = ['outline-generation', 'global-facts', 'content-edit', 'expand'].includes(storedStep)
      && getBidAnalysisTasks('key').some((task) => !isBidAnalysisTaskResultValid(task, bidAnalysisTasks[task.id]));
    const outlineData = loadOutlineData(meta);
    const tasks = loadTasks();
    const bidSections = normalizeBidSections(safeJsonParse(meta.bid_sections_json, []));
    const requirementResponseMatrix = safeJsonParse(meta.requirement_response_matrix_json, undefined);
    const bidSectionExtractionTask = tasks.bidSectionExtractionTask;
    const tenderFiles = loadTenderSourceFiles(meta);
    const tenderFile = meta.tender_markdown_path ? {
      fileName: meta.tender_file_name || '技术方案招标文件',
      markdownPath: meta.tender_markdown_path,
      markdownChars: Number(meta.tender_markdown_chars || 0),
      contentHash: meta.tender_markdown_hash || '',
      originalMarkdownPath: meta.tender_original_markdown_path || meta.tender_markdown_path,
      originalMarkdownChars: Number(meta.tender_original_markdown_chars || meta.tender_markdown_chars || 0),
      originalContentHash: meta.tender_original_markdown_hash || meta.tender_markdown_hash || '',
      parserLabel: meta.tender_parser_label || undefined,
      importedAt: meta.tender_imported_at || undefined,
      selectedSectionId: meta.selected_section_id || undefined,
      selectedSectionTitle: meta.selected_section_title || undefined,
      updatedAt: meta.updated_at,
    } : null;
    const originalPlanFile = meta.original_plan_markdown_path ? {
      fileName: meta.original_plan_file_name || '原方案',
      markdownPath: meta.original_plan_markdown_path,
      markdownChars: Number(meta.original_plan_markdown_chars || 0),
      contentHash: meta.original_plan_markdown_hash || '',
      parserLabel: meta.original_plan_parser_label || undefined,
      importedAt: meta.original_plan_imported_at || undefined,
      updatedAt: meta.updated_at,
    } : null;

    return {
      ...initialState,
      workflowKind: normalizeWorkflowKind(meta.workflow_kind),
      step: requiresBidAnalysisRecovery ? 'bid-analysis' : storedStep,
      tenderFile,
      tenderFiles,
      originalPlanFile,
      projectOverview: bidAnalysisTasks.projectOverview?.status === 'success' ? bidAnalysisTasks.projectOverview.content : '',
      techRequirements: bidAnalysisTasks.techRequirements?.status === 'success' ? bidAnalysisTasks.techRequirements.content : '',
      bidAnalysisMode,
      bidAnalysisSelectedTaskIds,
      bidAnalysisTaskDefinitions: getBidAnalysisTaskDefinitions(),
      bidAnalysisTasks,
      bidAnalysisProgress: calculateBidProgress(bidAnalysisMode, bidAnalysisTasks, bidAnalysisSelectedTaskIds),
      bidSectionMode: normalizeBidSectionMode(meta.bid_section_mode),
      bidSections,
      bidSectionExtractionStatus: bidSectionExtractionTask?.status
        ? normalizeBidSectionExtractionStatus(bidSectionExtractionTask.status)
        : normalizeBidSectionExtractionStatus(meta.bid_section_extraction_status),
      bidSectionExtractionError: bidSectionExtractionTask?.error || meta.bid_section_extraction_error || undefined,
      outlineMode: isValidOutlineMode(meta.outline_mode) ? meta.outline_mode : 'aligned',
      outlineExpansionMode: isValidOutlineExpansionMode(meta.outline_expansion_mode) ? meta.outline_expansion_mode : 'ai-complement',
      outlineWordControlOptions: normalizeOutlineWordControlOptions(safeJsonParse(meta.outline_word_control_options_json, defaultOutlineWordControlOptions)),
      outlineWordControlSnapshot: meta.outline_word_control_snapshot_json
        ? normalizeOutlineWordControlOptions(safeJsonParse(meta.outline_word_control_snapshot_json, defaultOutlineWordControlOptions))
        : undefined,
      referenceKnowledgeDocumentIds: loadReferenceDocumentIds(),
      ...tasks,
      globalFacts: loadGlobalFacts(),
      contentGenerationOptions: safeJsonParse(meta.content_generation_options_json, undefined),
      contentGenerationRuntime: safeJsonParse(meta.content_generation_runtime_json, undefined),
      contentIllustrationPlan: safeJsonParse(meta.content_illustration_plan_json, undefined),
      requirementResponseMatrix: requirementResponseMatrix
        ? normalizeRequirementResponseMatrix(requirementResponseMatrix)
        : undefined,
      outlineQualityReview: safeJsonParse(meta.outline_quality_review_json, undefined),
      contentGenerationSections: loadContentSections(outlineData),
      contentGenerationPlans: loadContentPlans(),
      outlineData,
    };
  }

  const updateTechnicalPlanTransaction = db.transaction((partial) => {
    applyPartial(partial || {});
    return loadTechnicalPlan();
  });

  function updateTechnicalPlanWithoutReload(partial) {
    updateTechnicalPlanTransaction(partial || {});
  }

  function updateTechnicalPlan(partial) {
    updateTechnicalPlanWithoutReload(partial);
    return loadTechnicalPlan();
  }

  function assertFormatConstrainedOutlineMutation(outlineData) {
    const storedRows = db.prepare(`
      SELECT node_id, parent_node_id, sort_order, level, title, format_constraints_json, response_state_json,
             knowledge_item_ids_json, content
      FROM technical_plan_outline_nodes
      ORDER BY level ASC, parent_node_id ASC, sort_order ASC
    `).all().map((row) => ({
      ...row,
      constraints: normalizeOutlineFormatConstraints(row.format_constraints_json),
      responseState: normalizeOutlineResponseState(row.response_state_json, {
        content: row.content,
        knowledgeItemIds: normalizeStringArray(
          safeJsonParse(row.knowledge_item_ids_json, []),
          [],
          `目录节点 ${row.node_id}.knowledge_item_ids_json`,
        ),
      }),
    }));
    const storedByNodeId = new Map(storedRows.map((row) => [row.node_id, row]));
    const storedFixed = storedRows.filter((row) => row.constraints.format_node_id);
    if (!storedFixed.length) return;

    const incomingRows = flattenOutlineItems(outlineData?.outline || []);
    const incomingByNodeId = new Map(incomingRows.map((row) => [row.node_id, row]));
    const incomingByFormatId = new Map();
    const resolvedConstraints = new Map();
    for (const row of incomingRows) {
      const stored = storedByNodeId.get(row.node_id);
      const constraints = normalizeOutlineFormatConstraints({
        ...(stored?.constraints || {}),
        ...(row.format_constraints_patch || {}),
      });
      resolvedConstraints.set(row.node_id, constraints);
      if (constraints.format_node_id) {
        if (incomingByFormatId.has(constraints.format_node_id)) {
          throw new Error(`固定目录节点重复：${constraints.source_title || row.title}`);
        }
        incomingByFormatId.set(constraints.format_node_id, row);
      }
    }

    const immutableConstraintFields = outlineFormatConstraintFields.filter((field) => field !== 'mapped_requirement_ids');
    const storedFixedIds = new Set(storedFixed.map((row) => row.constraints.format_node_id));
    for (const [formatNodeId, row] of incomingByFormatId) {
      if (!storedFixedIds.has(formatNodeId)) throw new Error(`出现未知固定目录节点：${row.title}`);
    }

    function parentFormatId(row, rowsByNodeId, constraintsByNodeId, fallbackByNodeId) {
      if (!row?.parent_node_id) return null;
      const parent = rowsByNodeId.get(row.parent_node_id);
      if (!parent) return null;
      return constraintsByNodeId?.get(parent.node_id)?.format_node_id
        || fallbackByNodeId?.get(parent.node_id)?.constraints?.format_node_id
        || null;
    }

    for (const stored of storedFixed) {
      const formatNodeId = stored.constraints.format_node_id;
      const incoming = incomingByFormatId.get(formatNodeId);
      if (!incoming) {
        if (stored.constraints.required_in_outline) throw new Error(`固定目录节点不可删除：${stored.title}`);
        continue;
      }
      const incomingConstraints = resolvedConstraints.get(incoming.node_id);
      if (stored.constraints.title_locked && incoming.title !== stored.title) {
        throw new Error(`固定目录标题不可修改：${stored.title}`);
      }
      for (const field of immutableConstraintFields) {
        const before = stored.constraints[field] ?? null;
        const after = incomingConstraints[field] ?? null;
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          throw new Error(`固定目录约束不可修改：${stored.title}.${field}`);
        }
      }
      const storedParentFormatId = parentFormatId(stored, storedByNodeId, null, storedByNodeId);
      const incomingParentFormatId = parentFormatId(incoming, incomingByNodeId, resolvedConstraints, storedByNodeId);
      if (stored.constraints.level_locked
        && (stored.level !== incoming.level || storedParentFormatId !== incomingParentFormatId)) {
        throw new Error(`固定目录层级不可修改：${stored.title}`);
      }
      if (stored.constraints.order_locked
        && (stored.sort_order !== incoming.sort_order || storedParentFormatId !== incomingParentFormatId)) {
        throw new Error(`固定目录顺序不可修改：${stored.title}`);
      }

    }

    for (const row of incomingRows) {
      if (resolvedConstraints.get(row.node_id)?.format_node_id) continue;
      let ancestor = row.parent_node_id ? incomingByNodeId.get(row.parent_node_id) : null;
      let fixedAncestor = null;
      while (ancestor) {
        const constraints = resolvedConstraints.get(ancestor.node_id);
        if (constraints?.format_node_id) {
          fixedAncestor = constraints;
          break;
        }
        ancestor = ancestor.parent_node_id ? incomingByNodeId.get(ancestor.parent_node_id) : null;
      }
      if (!fixedAncestor) throw new Error('固定格式目录不允许新增并列一级目录');
      if (!fixedAncestor.allow_ai_children) throw new Error('该固定目录不允许新增子目录');
    }
  }

  function clearDownstreamFromFormatAnalysisChange() {
    db.prepare("DELETE FROM technical_plan_tasks WHERE type IN ('outline-generation', 'global-facts-generation', 'content-generation')").run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();
    clearOriginalOutlineRuntime();
    updateMeta({
      step: 'bid-analysis',
      selected_format_profile_id: null,
      selected_format_profile_hash: null,
      outline_project_name: null,
      outline_project_overview: null,
      content_generation_options_json: null,
      content_generation_runtime_json: null,
      content_illustration_plan_json: null,
    });
  }

  function updateStep(step) {
    return updateTechnicalPlan({ step });
  }

  function setWorkflowKind(workflowKind) {
    return updateTechnicalPlan({ workflowKind: normalizeWorkflowKind(workflowKind) });
  }

  function switchWorkflowKind(workflowKind) {
    const nextWorkflowKind = normalizeWorkflowKind(workflowKind);
    const meta = ensureMetaRow();
    if (normalizeWorkflowKind(meta.workflow_kind) === nextWorkflowKind) {
      return loadTechnicalPlan();
    }

    const originalPlanFilePath = meta.original_plan_markdown_path
      ? resolveMarkdownPath(meta.original_plan_markdown_path)
      : originalPlanMarkdownPath;
    const transaction = db.transaction(() => {
      assertNoTechnicalPlanTaskRunning();
      clearWorkflowSpecificState(nextWorkflowKind);
    });
    transaction();
    if (fs.existsSync(originalPlanFilePath)) {
      fs.rmSync(originalPlanFilePath, { force: true });
    }
    return loadTechnicalPlan();
  }

  function saveOutlineConfig({ referenceKnowledgeDocumentIds, outlineExpansionMode, wordControlOptions } = {}) {
    return updateTechnicalPlan({
      outlineMode: 'aligned',
      outlineExpansionMode: isValidOutlineExpansionMode(outlineExpansionMode) ? outlineExpansionMode : 'ai-complement',
      outlineWordControlOptions: normalizeOutlineWordControlOptions(wordControlOptions),
      referenceKnowledgeDocumentIds,
    });
  }

  function resetTenderWorkingCopyToOriginal() {
    const originalMarkdown = readOriginalTenderMarkdown().trim();
    if (!originalMarkdown) {
      return;
    }
    writeMarkdownFile(tenderMarkdownPath, originalMarkdown, 'tender');
    updateMeta({
      tender_markdown_path: tenderMarkdownRelativePath,
      tender_markdown_hash: stableHash(originalMarkdown),
      tender_markdown_chars: originalMarkdown.length,
    });
  }

  function saveBidAnalysisConfig({ mode, selectedTaskIds, bidSectionMode } = {}) {
    const config = normalizeBidAnalysisConfig(mode, selectedTaskIds);
    const nextSectionMode = bidSectionMode === undefined ? null : normalizeBidSectionMode(bidSectionMode);
    const meta = ensureMetaRow();
    const shouldChangeSectionMode = nextSectionMode && nextSectionMode !== normalizeBidSectionMode(meta.bid_section_mode);
    if (!shouldChangeSectionMode) {
      return updateTechnicalPlan({
        bidAnalysisMode: config.mode,
        bidAnalysisSelectedTaskIds: config.selectedTaskIds,
      });
    }

    const transaction = db.transaction(() => {
      if (nextSectionMode === 'single' || nextSectionMode === 'multiple') {
        resetTenderWorkingCopyToOriginal();
      }
      clearDownstreamFromBidSectionChange();
      updateMeta({
        bid_analysis_mode: config.mode,
        bid_analysis_selected_task_ids_json: jsonOrNull(config.selectedTaskIds),
        bid_section_mode: nextSectionMode,
        bid_sections_json: null,
        bid_section_extraction_status: 'idle',
        bid_section_extraction_error: null,
        selected_section_id: null,
        selected_section_title: null,
      });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function prepareBidSectionExtraction() {
    const transaction = db.transaction(() => {
      resetTenderWorkingCopyToOriginal();
      clearDownstreamFromBidSectionChange();
      updateMeta({
        bid_section_mode: 'multiple',
        bid_sections_json: null,
        bid_section_extraction_status: 'running',
        bid_section_extraction_error: null,
        selected_section_id: null,
        selected_section_title: null,
      });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function saveOutline(payload) {
    const request = payload?.outlineData ? payload : { outlineData: payload, reason: 'replace' };
    const outlineData = request?.outlineData;
    const reason = normalizeOutlineSaveReason(request?.reason);
    const idMap = normalizeStringMap(request?.idMap);
    const reverseMap = reverseIdMap(idMap);
    const affectedIds = normalizeStringSet(request?.affectedNodeIds);
    const clearAll = reason === 'replace';
    const invalidatesContentTask = reason !== 'sort';

    const transaction = db.transaction(() => {
      assertOutlineMutationAllowed();
      assertFormatConstrainedOutlineMutation(outlineData);
      const snapshot = loadOutlinePersistenceSnapshot();
      const outlineToSave = buildOutlineWithPersistedContent(outlineData, { snapshot, reverseMap, affectedIds, clearAll });
      validateConditionalOutlineDepth(outlineToSave);
      saveOutlineData(outlineToSave);
      const rows = flattenOutlineItems(outlineToSave?.outline || []);
      const nextIds = new Set(rows.map((row) => row.node_id));
      restoreMappedContentRows({ snapshot, idMap, affectedIds, nextIds, clearAll });
      if (invalidatesContentTask) {
        db.prepare("DELETE FROM technical_plan_tasks WHERE type = 'content-generation'").run();
        updateMeta({ content_generation_runtime_json: null });
      }
      updateMeta({ content_illustration_plan_json: null });
    });
    transaction();
    return loadTechnicalPlan();
  }

  /* v1.4.5 local deepening path removed by v1.5.0.
  function applyOutlineDeepening({ patch, allowAiValueAdditions = false }) {
    const current = loadTechnicalPlan();
    if (!current.outlineData) {
      throw new Error('目录不存在，不能应用局部深化');
    }
    const result = applyOutlineDeepeningPatch({
      outlineData: current.outlineData,
      requirementResponseMatrix: current.requirementResponseMatrix || createEmptyFocusWritingMatrix(),
      patch,
      outlineExpansionMode: current.outlineExpansionMode,
      allowAiValueAdditions: allowAiValueAdditions === true,
    });
    const affectedNodeIds = result.diff.affected_node_ids;
    const targetNodeId = result.diff.target_node_id;
    const transaction = db.transaction(() => {
      assertOutlineMutationAllowed();
      saveOutlineData(result.outlineData);
      updateMeta({
        requirement_response_matrix_json: jsonOrNull(result.requirementResponseMatrix),
        outline_quality_review_json: jsonOrNull(result.outlineQualityReview),
      });
      const placeholders = affectedNodeIds.map(() => '?').join(', ');
      if (placeholders) {
        db.prepare(`DELETE FROM technical_plan_content_sections WHERE node_id IN (${placeholders})`).run(...affectedNodeIds);
        db.prepare(`DELETE FROM technical_plan_content_plans WHERE node_id IN (${placeholders})`).run(...affectedNodeIds);
      }
      const meta = ensureMetaRow();
      const illustrationPlan = safeJsonParse(meta.content_illustration_plan_json, undefined);
      const illustrationItems = Array.isArray(illustrationPlan?.items)
        ? illustrationPlan.items
        : Array.isArray(illustrationPlan?.plan?.items) ? illustrationPlan.plan.items : null;
      if (illustrationItems) {
        const filteredItems = illustrationItems.filter((item) => !item?.section_ids?.some((id) => String(id) === targetNodeId || String(id).startsWith(`${targetNodeId}.`)));
        if (Array.isArray(illustrationPlan?.items)) illustrationPlan.items = filteredItems;
        else illustrationPlan.plan.items = filteredItems;
        updateMeta({ content_illustration_plan_json: jsonOrNull(illustrationPlan) });
      }
      saveTask('outline-deepening', undefined);
    });
    transaction();
    return { ...loadTechnicalPlan(), outlineDeepeningDiff: result.diff };
  }

  function setOutlineDeepWriting({ targetNodeId, deepWriting }) {
    const current = loadTechnicalPlan();
    if (!current.outlineData) {
      throw new Error('目录不存在，不能修改深度写作');
    }
    const targetId = String(targetNodeId || '').trim();
    const nextOutline = JSON.parse(JSON.stringify(current.outlineData));
    const rows = flattenOutlineItems(nextOutline.outline || []);
    const targetRow = rows.find((row) => row.node_id === targetId);
    if (!targetRow || targetRow.level !== 2) {
      throw new Error('深度写作只能设置在真实的二级目录上');
    }
    const findItem = (items, nodeId) => {
      for (const item of items || []) {
        if (String(item.id) === nodeId) return item;
        const child = findItem(item.children, nodeId);
        if (child) return child;
      }
      return null;
    };
    const target = findItem(nextOutline.outline, targetId);
    const depthRows = flattenOutlineItems([target], null, 2);
    const maxDepth = Math.max(...depthRows.map((row) => row.level));
    const removedIds = [];
    if (deepWriting === true) {
      if (maxDepth !== 5) {
        throw new Error('请先使用“AI 深化本节”生成完整五级目录，再开启深度写作');
      }
      Object.assign(target, normalizeOutlineQualityMetadata({
        ...target,
        deep_writing: true,
        deep_writing_source: 'user',
        writing_profile: target.writing_profile === 'creative-proposal' ? 'creative-proposal' : 'deep',
      }));
    } else {
      const removeLevelFiveChildren = (item, level) => {
        if (level === 4) {
          for (const child of item.children || []) {
            if (String(child.content || '').trim()) {
              throw new Error('第五级目录已有正文，请先保留或迁移正文后再取消深度写作');
            }
            removedIds.push(String(child.id));
          }
          item.children = [];
          return;
        }
        for (const child of item.children || []) removeLevelFiveChildren(child, level + 1);
      };
      removeLevelFiveChildren(target, 2);
      Object.assign(target, normalizeOutlineQualityMetadata({
        ...target,
        deep_writing: false,
        deep_writing_source: 'user',
        writing_profile: 'standard',
      }));
    }
    const quality = applyOutlineQualityRules(nextOutline, current.requirementResponseMatrix || createEmptyFocusWritingMatrix());
    const transaction = db.transaction(() => {
      assertOutlineMutationAllowed();
      saveOutlineData(quality.outline);
      updateMeta({
        requirement_response_matrix_json: jsonOrNull(quality.matrix),
        outline_quality_review_json: jsonOrNull(quality.review),
      });
      if (removedIds.length) {
        const placeholders = removedIds.map(() => '?').join(', ');
        db.prepare(`DELETE FROM technical_plan_content_sections WHERE node_id IN (${placeholders})`).run(...removedIds);
        db.prepare(`DELETE FROM technical_plan_content_plans WHERE node_id IN (${placeholders})`).run(...removedIds);
      }
    });
    transaction();
    return loadTechnicalPlan();
  }

  */
  function saveGlobalFacts(globalFacts) {
    const transaction = db.transaction(() => {
      replaceGlobalFacts(globalFacts);
      clearContentGenerationState();
      const timestamp = now();
      saveTask('global-facts-generation', {
        task_id: `manual-global-facts-${Date.now()}`,
        type: 'global-facts-generation',
        status: 'success',
        progress: 100,
        logs: ['全局事实已保存。'],
        started_at: timestamp,
        updated_at: timestamp,
      });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function saveContentGenerationOptions(contentGenerationOptions) {
    const { minimumWords, minimum_words, maxAiImages, maxHtmlImages, ...options } = contentGenerationOptions || {};
    return updateTechnicalPlan({ contentGenerationOptions: options, contentIllustrationPlan: undefined });
  }

  function saveContentIllustrationPlan(contentIllustrationPlan) {
    return updateTechnicalPlan({ contentIllustrationPlan });
  }

  function saveChapterContent({ nodeId, content }) {
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const timestamp = now();
      const node = db.prepare(`
        SELECT node_id, title, content, knowledge_item_ids_json, format_constraints_json, response_state_json
        FROM technical_plan_outline_nodes
        WHERE node_id = ?
      `).get(nodeId);
      if (!node) throw new Error('当前目录中未找到该章节');
      const legacyKnowledgeItemIds = normalizeStringArray(
        safeJsonParse(node.knowledge_item_ids_json, []),
        [],
        `目录节点 ${node.node_id}.knowledge_item_ids_json`,
      );
      const constraints = normalizeOutlineFormatConstraints(node.format_constraints_json);
      const responseState = normalizeOutlineResponseState(node.response_state_json, {
        content: node.content,
        knowledgeItemIds: legacyKnowledgeItemIds,
      });
      const nextContent = String(content || '');
      const nextResponseState = normalizeOutlineResponseState({
        ...responseState,
        response_status: nextContent.trim() ? 'responded-substantive' : 'pending',
        compliance_risk: 'none',
        compliance_message: undefined,
      }, {
        content: nextContent,
        knowledgeItemIds: responseState.knowledge_item_ids,
      });
      db.prepare(`
        UPDATE technical_plan_outline_nodes
        SET content = ?, response_state_json = ?, updated_at = ?
        WHERE node_id = ?
      `).run(nextContent, JSON.stringify(nextResponseState), timestamp, nodeId);
      db.prepare(`
        INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
        VALUES (?, ?, NULL, ?)
        ON CONFLICT(node_id) DO UPDATE SET status = excluded.status, error = NULL, updated_at = excluded.updated_at
      `).run(nodeId, nextContent.trim() ? 'success' : 'idle', timestamp);
      updateMeta({ content_illustration_plan_json: null });
    });
    transaction();
    return loadTechnicalPlan();
  }

  async function importTenderDocument() {
    if (!fileService?.importDocument) {
      throw new Error('文件导入服务尚未初始化');
    }

    const result = await fileService.importDocument({ multiple: true });
    if (!result?.success || !result.file_content) {
      return {
        success: false,
        message: result?.message || '未导入文件',
        state: loadTechnicalPlan(),
        markdown: '',
      };
    }

    const importedDocuments = Array.isArray(result.documents) && result.documents.length ? result.documents : [result];
    const markdown = combineTenderMarkdown(importedDocuments.map((item) => item.file_content));
    const fileName = importedDocuments.length > 1 ? `${importedDocuments.length} 份招标文件` : result.file_name || '未命名文件';
    const parserLabel = importedDocuments.length > 1 ? null : result.parser_label || null;
    cleanupPendingTenderSelection();

    return saveTenderMarkdownAndState(markdown, {
      fileName,
      parserLabel,
      message: result.message || '招标文件已导入',
      fallbackToLocal: result.fallbackToLocal === true,
      resetOriginal: true,
      sourceFiles: importedDocuments,
    });
  }

  async function importOriginalPlanDocument() {
    const importer = fileService?.importTechnicalPlanDocument || fileService?.importDocument;
    if (!importer) {
      throw new Error('文件导入服务尚未初始化');
    }

    const result = fileService.importTechnicalPlanDocument
      ? await fileService.importTechnicalPlanDocument('原方案')
      : await importer();
    if (!result?.success || !result.file_content) {
      return {
        success: false,
        message: result?.message || '未导入文件',
        state: loadTechnicalPlan(),
        markdown: '',
      };
    }

    const markdown = String(result.file_content || '').trim();
    const fileName = result.file_name || '未命名文件';
    const parserLabel = result.parser_label || null;
    const targetDir = path.dirname(originalPlanMarkdownPath);
    const tempPath = path.join(targetDir, `original-plan-${Date.now()}.tmp.md`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tempPath, `${markdown}\n`, 'utf-8');

    try {
      fs.renameSync(tempPath, originalPlanMarkdownPath);
      const timestamp = now();
      const transaction = db.transaction(() => {
        updateMeta({
          workflow_kind: 'existing-plan-expansion',
          original_plan_file_name: fileName,
          original_plan_markdown_path: originalPlanMarkdownRelativePath,
          original_plan_markdown_hash: stableHash(markdown),
          original_plan_markdown_chars: markdown.length,
          original_plan_parser_label: parserLabel || null,
          original_plan_imported_at: timestamp,
        });
        clearDownstreamFromOriginalPlan();
      });
      transaction();
      return {
        success: true,
        message: result.message || '原方案已导入',
        state: loadTechnicalPlan(),
        markdown,
      };
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  function saveTenderMarkdownAndState(markdown, { fileName, parserLabel, message, selectedSection, fallbackToLocal, resetOriginal, sourceFiles }) {
    const nextMarkdown = String(markdown || '').trim();
    if (Array.isArray(sourceFiles)) {
      clearTenderSourceFiles();
    }
    const tenderSourceFiles = Array.isArray(sourceFiles)
      ? sourceFiles.map(writeTenderSourceMarkdown)
      : undefined;
    writeMarkdownFile(tenderMarkdownPath, nextMarkdown, 'tender');
    if (resetOriginal) {
      writeMarkdownFile(tenderOriginalMarkdownPath, nextMarkdown, 'tender-original');
    }

    const timestamp = now();
    const transaction = db.transaction(() => {
      clearDownstreamFromTender();
      updateMeta({
        tender_file_name: fileName || '未命名文件',
        tender_markdown_path: tenderMarkdownRelativePath,
        tender_markdown_hash: stableHash(nextMarkdown),
        tender_markdown_chars: nextMarkdown.length,
        tender_original_markdown_path: resetOriginal ? tenderOriginalMarkdownRelativePath : undefined,
        tender_original_markdown_hash: resetOriginal ? stableHash(nextMarkdown) : undefined,
        tender_original_markdown_chars: resetOriginal ? nextMarkdown.length : undefined,
        tender_parser_label: parserLabel || null,
        tender_imported_at: timestamp,
        tender_files_json: tenderSourceFiles ? JSON.stringify(tenderSourceFiles) : undefined,
        selected_section_id: selectedSection?.id || null,
        selected_section_title: selectedSection?.title || null,
      });
    });
    transaction();
    return {
      success: true,
      message: message || (fallbackToLocal ? '文件解析完成，当前格式已自动使用本地解析' : '招标文件已导入'),
      state: loadTechnicalPlan(),
      markdown: nextMarkdown,
    };
  }

  function selectBidSection(selectedSection) {
    const selected = selectedSection || {};
    const meta = ensureMetaRow();
    const aiSections = normalizeBidSections(safeJsonParse(meta.bid_sections_json, []));

    if (aiSections.length >= 2) {
      const matched = aiSections.find((section) => section.id === selected.id) || selected;
      const originalMarkdown = readOriginalTenderMarkdown().trim();
      if (!originalMarkdown) {
        throw new Error('原始招标文件内容为空，请重新上传');
      }
      const workingMarkdown = buildSelectedSectionMarkdown(originalMarkdown, aiSections, matched.id);
      writeMarkdownFile(tenderMarkdownPath, workingMarkdown, 'tender');
      const transaction = db.transaction(() => {
        clearDownstreamFromBidSectionChange();
        updateMeta({
          tender_markdown_path: tenderMarkdownRelativePath,
          tender_markdown_hash: stableHash(workingMarkdown),
          tender_markdown_chars: workingMarkdown.length,
          bid_section_mode: 'multiple',
          selected_section_id: matched.id || null,
          selected_section_title: matched.title || null,
        });
      });
      transaction();
      return {
        success: true,
        message: `已选择【${matched.title || '投标范围'}】，招标文件解析将仅使用当前投标范围`,
        state: loadTechnicalPlan(),
        markdown: workingMarkdown,
      };
    }

    throw new Error('请先完成多标段识别，再选择投标范围');
  }

  function clearTechnicalPlan() {
    cleanupPendingTenderSelection();
    const workflowKind = normalizeWorkflowKind(ensureMetaRow().workflow_kind);
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM technical_plan_tasks').run();
      db.prepare('DELETE FROM technical_plan_bid_items').run();
      db.prepare('DELETE FROM technical_plan_response_templates').run();
      db.prepare('DELETE FROM technical_plan_reference_docs').run();
      db.prepare('DELETE FROM technical_plan_outline_nodes').run();
      db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
      db.prepare('DELETE FROM technical_plan_meta').run();
      ensureMetaRow();
      updateMeta({ workflow_kind: workflowKind });
    });
    transaction();
    if (fs.existsSync(tenderMarkdownPath)) {
      fs.rmSync(tenderMarkdownPath, { force: true });
    }
    if (fs.existsSync(tenderOriginalMarkdownPath)) {
      fs.rmSync(tenderOriginalMarkdownPath, { force: true });
    }
    clearTenderSourceFiles();
    if (fs.existsSync(originalPlanMarkdownPath)) {
      fs.rmSync(originalPlanMarkdownPath, { force: true });
    }
    clearOriginalOutlineRuntime();
    clearIllustrationFiles();
    deleteImportedImageBatches(app, 'technical-plan');
    return { success: true, message: '技术方案缓存已清空', state: loadTechnicalPlan() };
  }

  return {
    loadTechnicalPlan,
    updateTechnicalPlan,
    updateTechnicalPlanWithoutReload,
    saveContentGenerationItem,
    clearIllustrationFiles,
    clearTechnicalPlan,
    importTenderDocument,
    importOriginalPlanDocument,
    checkBidSections,
    prepareBidSectionExtraction,
    selectBidSection,
    readTenderMarkdown,
    readTenderSourceMarkdown,
    readOriginalTenderMarkdown,
    readOriginalPlanMarkdown,
    readIllustrationHtml,
    findIllustrationHtml,
    readIllustrationChart,
    readOriginalOutlineRuntime,
    saveOriginalOutlineRuntime,
    clearOriginalOutlineRuntime,
    updateStep,
    setWorkflowKind,
    switchWorkflowKind,
    saveBidAnalysisConfig,
    saveOutlineConfig,
    saveOutline,
    saveGlobalFacts,
    saveIllustrationHtml,
    saveIllustrationChart,
    saveIllustrationPng,
    saveContentGenerationOptions,
    saveContentIllustrationPlan,
    saveChapterContent,
  };
}

module.exports = {
  createTechnicalPlanStore,
  __test__: {
    bidItemFromRow,
    normalizeBidAnalysisItemContract,
    normalizeOutlineFormatConstraints,
  },
};
