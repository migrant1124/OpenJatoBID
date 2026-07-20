'use strict';

const crypto = require('node:crypto');

const CONTENT_PLAN_VERSION = 5;
const CONTENT_PLAN_PROMPT_VERSION = 'content-plan-v5';
const WRITING_PROFILES = new Set(['standard', 'deep', 'creative-proposal']);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function compactText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => compactText(item))
    .filter(Boolean))];
}

function normalizeTargetWords(value, fallback = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const min = Math.max(80, Math.round(Number(source.min ?? fallback.min) || 300));
  const preferred = Math.max(min, Math.round(Number(source.preferred ?? fallback.preferred) || Math.max(500, min)));
  const max = Math.max(preferred, Math.round(Number(source.max ?? fallback.max) || Math.max(800, preferred)));
  return { min, preferred, max };
}

function outlineNodeSnapshot(item = {}) {
  return {
    id: String(item.id || ''),
    title: compactText(item.title),
    description: compactText(item.description),
    manual_input_required: item.manual_input_required === true,
    focus_priority: compactText(item.focus_priority),
    focus_scoring_point_ids: uniqueStrings(item.focus_scoring_point_ids),
  };
}

function resolveWritingProfile(item = {}, parents = []) {
  return [item, ...(Array.isArray(parents) ? parents : [])]
    .some((node) => Boolean(node?.focus_priority))
    ? 'deep'
    : 'standard';
}

function buildContentPlanFingerprint({ context, requirementResponseMatrix, globalFacts, knowledgeDocumentRevisions, originalPlanMarkdown }) {
  const item = context?.item || {};
  const parents = Array.isArray(context?.parentChapters) ? context.parentChapters : [];
  return {
    outline_node_hash: hash(outlineNodeSnapshot(item)),
    parent_outline_hash: hash(parents.map(outlineNodeSnapshot)),
    scoring_matrix_revision: String(requirementResponseMatrix?.revision || ''),
    global_facts_revision: hash((Array.isArray(globalFacts) ? globalFacts : []).map((group) => ({
      id: String(group?.id || ''), title: compactText(group?.title), content: String(group?.content || ''), updated_at: String(group?.updated_at || ''),
    }))),
    knowledge_document_revisions: [...new Set((Array.isArray(knowledgeDocumentRevisions) ? knowledgeDocumentRevisions : [])
      .map((revision) => String(revision || '').trim())
      .filter(Boolean))].sort(),
    ...(String(originalPlanMarkdown || '').trim() ? { original_plan_hash: hash(String(originalPlanMarkdown || '')) } : {}),
    prompt_version: CONTENT_PLAN_PROMPT_VERSION,
    writing_profile: resolveWritingProfile(item, parents),
  };
}

function isSameContentPlanFingerprint(left, right) {
  if (!left || !right) return false;
  const fields = [
    'outline_node_hash', 'parent_outline_hash', 'scoring_matrix_revision', 'global_facts_revision',
    'original_plan_hash', 'prompt_version', 'writing_profile',
  ];
  if (!fields.every((field) => String(left[field] || '') === String(right[field] || ''))) return false;
  return JSON.stringify([...(left.knowledge_document_revisions || [])].sort())
    === JSON.stringify([...(right.knowledge_document_revisions || [])].sort());
}

function getSecondLevelChapter(context) {
  const path = [...(context?.parentChapters || []), context?.item].filter(Boolean);
  return path.find((item) => String(item?.id || '').split('.').length === 2) || null;
}

function buildChapterWritingTask(contexts, requirementResponseMatrix) {
  const firstContext = contexts?.[0];
  const chapter = getSecondLevelChapter(firstContext);
  const matrix = requirementResponseMatrix || {};
  const focusPointIds = uniqueStrings((contexts || []).flatMap((context) => [
    ...(context?.item?.focus_scoring_point_ids || []),
    ...((context?.parentChapters || []).flatMap((item) => item?.focus_scoring_point_ids || [])),
  ]));
  const scoringPoints = (matrix.scoring_points || [])
    .filter((point) => focusPointIds.includes(String(point?.scoring_point_id || '')));
  const leafResponsibilities = (contexts || []).map((context) => ({
    node_id: String(context?.item?.id || ''),
    title: compactText(context?.item?.title),
    role: compactText(context?.item?.description) || compactText(context?.item?.title),
  })).filter((item) => item.node_id);
  return {
    chapter_node_id: String(chapter?.id || '').trim(),
    chapter_title: compactText(chapter?.title),
    chapter_goal: compactText(chapter?.description) || compactText(chapter?.title),
    scoring_point_ids: scoringPoints.map((point) => String(point.scoring_point_id || '')).filter(Boolean),
    high_score_conditions: uniqueStrings(scoringPoints.flatMap((point) => point.high_score_conditions || [])),
    value_anchor_ids: [],
    leaf_responsibilities: leafResponsibilities,
    cross_section_boundaries: {
      owns: [compactText(chapter?.title)].filter(Boolean),
      excludes: [],
      related_node_ids: leafResponsibilities.map((item) => item.node_id),
    },
  };
}

function validateSectionWritingContract(contract) {
  if (!contract || typeof contract !== 'object') throw new Error('章节写作合同必须是对象');
  if (!WRITING_PROFILES.has(contract.writing_profile)) throw new Error('章节写作合同缺少有效 writing_profile');
  if (!compactText(contract.section_role)) throw new Error('章节写作合同缺少 section_role');
  const arrayFields = [
    'scoring_point_ids', 'value_anchor_ids', 'must_answer_questions', 'key_claims', 'implementation_steps',
    'quantitative_details', 'deliverables', 'acceptance_criteria', 'evidence_requirements', 'table_briefs',
    'illustration_briefs', 'forbidden_repetition',
  ];
  for (const field of arrayFields) {
    if (!Array.isArray(contract[field])) throw new Error(`章节写作合同缺少 ${field}`);
  }
  if (!contract.cross_section_boundaries || typeof contract.cross_section_boundaries !== 'object') {
    throw new Error('章节写作合同缺少 cross_section_boundaries');
  }
  if (!Array.isArray(contract.knowledge?.item_ids) || !Array.isArray(contract.facts?.titles)) {
    throw new Error('章节写作合同缺少知识库或事实变量约束');
  }
  const target = contract.target_words || {};
  if (!(target.min > 0 && target.preferred >= target.min && target.max >= target.preferred)) {
    throw new Error('章节写作合同 target_words 无效');
  }
}

module.exports = {
  CONTENT_PLAN_PROMPT_VERSION,
  CONTENT_PLAN_VERSION,
  buildChapterWritingTask,
  buildContentPlanFingerprint,
  compactText,
  isSameContentPlanFingerprint,
  normalizeTargetWords,
  resolveWritingProfile,
  uniqueStrings,
  validateSectionWritingContract,
};
