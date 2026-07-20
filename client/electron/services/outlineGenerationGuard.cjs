'use strict';

const {
  cloneValue,
  createStagedWorkspaceStore,
  createTerminalHoldingUpdateTask,
  sameValue,
  singleLine,
} = require('./technicalPlanGuardUtils.cjs');

const OUTLINE_COMMIT_FIELDS = [
  'outlineMode',
  'outlineExpansionMode',
  'referenceKnowledgeDocumentIds',
  'requirementResponseMatrix',
  'outlineQualityReview',
  'outlineData',
  'contentGenerationTask',
  'contentGenerationSections',
  'contentGenerationPlans',
  'contentGenerationRuntime',
];

const LEGACY_FIELDS = [
  'source_requirement_id',
  'source_requirement_title',
  'mapped_requirement_ids',
  'primary_requirement_ids',
  'evidence_requirement_ids',
  'supplemental_requirement_ids',
  'mapped_scoring_point_ids',
  'value_anchor_ids',
  'deep_writing',
  'deep_writing_recommended',
  'deep_writing_source',
  'deep_writing_reason',
  'writing_profile',
  'response_mode',
  'response_status',
];

function normalizeAndValidateOutline(outlineData, context = {}) {
  const rawOutline = Array.isArray(outlineData?.outline) ? outlineData.outline : [];
  if (!rawOutline.length) throw new Error('最终目录不能为空');
  const sourceOutline = Array.isArray(context.sourceOutline?.outline) ? context.sourceOutline.outline : [];

  if (sourceOutline.length) {
    if (rawOutline.length !== sourceOutline.length) throw new Error('一级目录必须保持目录来源骨架的数量和顺序');
    rawOutline.forEach((item, index) => {
      if (singleLine(item?.title) !== singleLine(sourceOutline[index]?.title)) {
        throw new Error(`一级目录必须保持目录来源骨架：${singleLine(sourceOutline[index]?.title) || '未命名目录'}`);
      }
    });
  }

  function normalizeItems(items, parentId = '', path = 'outline') {
    const titles = new Set();
    return items.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error(`${path}[${index}] 必须是对象`);
      const title = singleLine(rawItem.title);
      if (!title) throw new Error(`${path}[${index}].title 不能为空`);
      const titleKey = title.toLocaleLowerCase();
      if (titles.has(titleKey)) throw new Error(`${path}[${index}].title 与同级目录重复：${title}`);
      titles.add(titleKey);

      const id = parentId ? `${parentId}.${index + 1}` : String(index + 1);
      const next = { ...rawItem, id, title, description: singleLine(rawItem.description) || title, manual_input_required: false };
      for (const field of LEGACY_FIELDS) delete next[field];
      if (rawItem.service_plan_section === true) next.service_plan_section = true;
      else delete next.service_plan_section;
      if (Array.isArray(rawItem.focus_scoring_point_ids)) {
        next.focus_scoring_point_ids = [...new Set(rawItem.focus_scoring_point_ids.map((value) => singleLine(value)).filter(Boolean))];
      } else {
        delete next.focus_scoring_point_ids;
      }
      if (['service-plan', 'score-first', 'score-second'].includes(rawItem.focus_priority)) {
        next.focus_priority = rawItem.focus_priority;
      } else {
        delete next.focus_priority;
      }
      delete next.content;
      const children = Array.isArray(rawItem.children) ? rawItem.children : [];
      if (children.length) next.children = normalizeItems(children, id, `${path}[${index}].children`);
      else delete next.children;
      return next;
    });
  }

  return { ...cloneValue(outlineData), outline: normalizeItems(rawOutline) };
}

function buildChangedPatch(initialState, stagedState) {
  const patch = {};
  for (const field of OUTLINE_COMMIT_FIELDS) {
    if (!sameValue(initialState?.[field], stagedState?.[field])) patch[field] = cloneValue(stagedState?.[field]);
  }
  return patch;
}

function createGuardedOutlineRunner(baseRunner) {
  if (typeof baseRunner !== 'function') throw new TypeError('baseRunner 必须是函数');
  return async function guardedOutlineRunner(args) {
    const realStore = args.workspaceStore;
    const initialState = realStore.loadTechnicalPlan() || {};
    const staged = createStagedWorkspaceStore(realStore, initialState);
    const terminal = createTerminalHoldingUpdateTask(args.updateTask);

    await baseRunner({
      ...args,
      workspaceStore: staged.store,
      updateTask: terminal.updateTask,
    });

    const stagedState = staged.getState();
    const outlineData = normalizeAndValidateOutline(stagedState.outlineData, {});
    const patch = buildChangedPatch(initialState, stagedState);
    patch.outlineData = outlineData;
    patch.contentIllustrationPlan = undefined;
    const saved = realStore.updateTechnicalPlan(patch);
    const terminalState = terminal.getTerminal();
    args.updateTask({
      ...(terminalState?.partial || {}),
      status: 'success',
      progress: 100,
      error: undefined,
    }, saved, {
      outlineData: saved.outlineData || outlineData,
      technicalPlanPatch: { ...patch, outlineData: saved.outlineData || outlineData },
    });
  };
}

module.exports = {
  createGuardedOutlineRunner,
  normalizeAndValidateOutline,
};
