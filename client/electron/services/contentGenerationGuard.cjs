'use strict';

const {
  appendTaskLog,
  cloneValue,
  collectLeafItems,
  createServiceProxy,
  createTerminalHoldingUpdateTask,
  findOutlineItem,
  hasSubstantiveContent,
  parseSourceBlocks,
  snapshotPatch,
  unionPlanSourceIds,
  updateOutlineItemContent,
} = require('./technicalPlanGuardUtils.cjs');

function getNodeIdFromMessages(messages) {
  const text = (messages || []).map((message) => String(message?.content || '')).join('\n');
  return /章节ID:\s*([^\s]+)/u.exec(text)?.[1] || '';
}

function createContentAiGuard(aiService, context, workspaceStore) {
  async function call(methodName, options = {}) {
    const label = String(options.progressLabel || options.logTitle || '');
    const method = aiService?.[methodName];
    if (typeof method !== 'function') throw new Error(`AI 服务缺少 ${methodName}`);
    if (label === '正文编排决策') {
      const nodeId = getNodeIdFromMessages(options.messages);
      try {
        return await method.call(aiService, options);
      } catch (error) {
        context.planningFailures.set(nodeId || `unknown-${context.planningFailures.size + 1}`, error?.message || String(error));
        throw error;
      }
    }
    if (label === '原方案还原') {
      const text = (options.messages || []).map((message) => String(message?.content || '')).join('\n\n');
      for (const [id, info] of parseSourceBlocks(text)) context.originalSources.set(id, info);
      return method.call(aiService, options);
    }
    const result = await method.call(aiService, options);
    if (label !== '最低字数补目录' || !Array.isArray(result?.additions)) return result;
    const protectedIds = new Set(collectLeafItems(workspaceStore.loadTechnicalPlan()?.outlineData?.outline || [])
      .filter((item) => String(item?.content || '').trim())
      .map((item) => String(item.id || '').trim())
      .filter(Boolean));
    return {
      ...result,
      additions: result.additions.filter((addition) => {
        const parentId = String(addition?.parent_id || '').trim();
        if (!protectedIds.has(parentId)) return true;
        context.blockedExpansionParentIds.add(parentId);
        return false;
      }),
    };
  }
  return createServiceProxy(aiService, {
    collectJsonResponse: (options) => call('collectJsonResponse', options),
    requestJson: (options) => call('requestJson', options),
  });
}

function createContentAgentGuard(agentService, context) {
  if (!agentService || typeof agentService.runTask !== 'function') return agentService;
  return createServiceProxy(agentService, {
    async runTask(payload) {
      const isRestore = String(payload?.title || '').includes('原方案正文还原映射');
      if (isRestore) {
        const sourceFile = (payload.files || []).find((file) => file?.path === 'original-segments.md');
        for (const [id, info] of parseSourceBlocks(sourceFile?.content || '')) context.originalSources.set(id, info);
      }
      return agentService.runTask(payload);
    },
  });
}

function applyPlanningFailureProtection(state, baseline, planningFailures) {
  let outlineData = cloneValue(state.outlineData);
  const sections = cloneValue(state.contentGenerationSections || {});
  const plans = cloneValue(state.contentGenerationPlans || {});
  const affected = [];
  for (const [nodeId, message] of planningFailures) {
    if (!nodeId || nodeId.startsWith('unknown-')) continue;
    const currentItem = findOutlineItem(outlineData?.outline || [], nodeId);
    if (!currentItem) continue;
    const baselineItem = findOutlineItem(baseline?.outlineData?.outline || [], nodeId);
    const baselineSection = baseline?.contentGenerationSections?.[nodeId];
    const fallbackContent = String(baselineSection?.content ?? baselineItem?.content ?? '');
    outlineData = { ...outlineData, outline: updateOutlineItemContent(outlineData.outline || [], nodeId, fallbackContent) };
    sections[nodeId] = {
      id: nodeId,
      title: currentItem.title || baselineSection?.title || '未命名章节',
      status: 'error',
      content: fallbackContent,
      error: `正文编排失败，已阻止无约束正文落库：${message}`,
      updated_at: new Date().toISOString(),
    };
    delete plans[nodeId];
    affected.push(nodeId);
  }
  return { outlineData, sections, plans, affected };
}

function createGuardedContentRunner(baseRunner) {
  if (typeof baseRunner !== 'function') throw new TypeError('baseRunner 必须是函数');
  return async function guardedContentRunner(args) {
    const realStore = args.workspaceStore;
    const baseline = cloneValue(args.previousState || realStore.loadTechnicalPlan() || {});
    const terminal = createTerminalHoldingUpdateTask(args.updateTask);
    const targetItemId = String(args.payload?.targetItemId || '').trim();
    const retryCorrection = Boolean(args.payload?.retryContentCorrection ?? args.payload?.retry_content_correction);
    const rerunIllustrations = Boolean(args.payload?.rerunIllustrations ?? args.payload?.rerun_illustrations);
    const fullRegenerate = !args.payload?.resume && !retryCorrection && !rerunIllustrations && Boolean(args.payload?.regenerate) && !targetItemId;
    const context = {
      planningFailures: new Map(),
      originalSources: new Map(),
      blockedExpansionParentIds: new Set(),
    };
    const payload = cloneValue(args.payload || {});
    const workflowKind = baseline.workflowKind || realStore.loadTechnicalPlan()?.workflowKind;
    if (workflowKind === 'existing-plan-expansion' && !targetItemId && !retryCorrection && !rerunIllustrations) {
      const options = cloneValue(payload.generationOptions || payload.generation_options || baseline.contentGenerationOptions || {});
      options.enableOriginalPlanCoverageAudit = true;
      options.enable_original_plan_coverage_audit = true;
      payload.generationOptions = options;
      payload.generation_options = options;
    }

    try {
      await baseRunner({
        ...args,
        payload,
        aiService: createContentAiGuard(args.aiService, context, realStore),
        agentService: createContentAgentGuard(args.agentService, context),
        updateTask: terminal.updateTask,
      });
    } catch (error) {
      if (fullRegenerate && hasSubstantiveContent(baseline)) {
        const restored = realStore.updateTechnicalPlan(snapshotPatch(baseline));
        appendTaskLog({
          workspaceStore: realStore,
          updateTask: args.updateTask,
          taskField: 'contentGenerationTask',
          message: `正文整体重生成失败，已恢复生成前版本：${error?.message || String(error)}`,
          progress: restored.contentGenerationTask?.progress || 0,
        });
      }
      throw error;
    }

    let state = realStore.loadTechnicalPlan() || {};
    if (state.contentGenerationTask?.status === 'paused' || state.contentGenerationTask?.status === 'pausing') return;
    const terminalPartial = terminal.getTerminal()?.partial || state.contentGenerationTask || { status: 'success', progress: 100, logs: [] };
    const issues = [];
    let patch = {};

    if (context.planningFailures.size) {
      const protectedResult = applyPlanningFailureProtection(state, baseline, context.planningFailures);
      patch = {
        outlineData: protectedResult.outlineData,
        contentGenerationSections: protectedResult.sections,
        contentGenerationPlans: protectedResult.plans,
        contentIllustrationPlan: undefined,
        contentGenerationRuntime: undefined,
      };
      if (protectedResult.affected.length) issues.push(`正文编排失败节点：${protectedResult.affected.join('、')}`);
    }

    const substantiveSourceIds = [...context.originalSources.values()].filter((item) => item.substantive).map((item) => item.id);
    if (workflowKind === 'existing-plan-expansion' && substantiveSourceIds.length) {
      const planSourceIds = unionPlanSourceIds(patch.contentGenerationPlans || state.contentGenerationPlans);
      const missing = substantiveSourceIds.filter((id) => !planSourceIds.has(id));
      if (missing.length) issues.push(`原方案实质段未分配：${missing.join('、')}`);
    }
    if (context.blockedExpansionParentIds.size) issues.push(`已阻止在有正文节点下补目录：${[...context.blockedExpansionParentIds].join('、')}`);

    const baseFailed = terminalPartial.status === 'error';
    const qualityFailed = issues.some((issue) => issue.startsWith('正文编排失败节点') || issue.startsWith('原方案实质段未分配'));
    if (fullRegenerate && baseFailed && hasSubstantiveContent(baseline)) {
      patch = { ...patch, ...snapshotPatch(baseline) };
      issues.push('整体重生成失败，已恢复生成前正文');
    }
    if (Object.keys(patch).length) state = realStore.updateTechnicalPlan(patch);

    const finalStatus = baseFailed || qualityFailed ? 'error' : 'success';
    const contentStats = { ...(cloneValue(terminalPartial.stats?.content) || {}) };
    if (context.planningFailures.size) contentStats.planning_failure_node_ids = [...context.planningFailures.keys()];
    if (substantiveSourceIds.length) {
      const planSourceIds = unionPlanSourceIds(patch.contentGenerationPlans || state.contentGenerationPlans);
      contentStats.original_restore_unassigned_source_ids = substantiveSourceIds.filter((id) => !planSourceIds.has(id));
    }
    if (context.blockedExpansionParentIds.size) contentStats.blocked_outline_expansion_parent_ids = [...context.blockedExpansionParentIds];
    const eventPatch = { technicalPlanPatch: patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'outlineData')) eventPatch.outlineData = patch.outlineData;
    args.updateTask({
      ...terminalPartial,
      status: finalStatus,
      progress: Number(terminalPartial.progress ?? 100) || 100,
      logs: [...(terminalPartial.logs || []), ...issues.map((issue) => `[安全校验] ${issue}`)],
      stats: { ...(terminalPartial.stats || {}), content: contentStats },
      error: finalStatus === 'error'
        ? issues.find((issue) => !issue.startsWith('已阻止')) || terminalPartial.error || '正文生成未通过安全校验'
        : undefined,
      pause_requested: false,
    }, state, eventPatch);
  };
}

module.exports = { createGuardedContentRunner };
