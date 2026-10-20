'use strict';

const crypto = require('node:crypto');
const { findProjectUnderstandingNode, getActiveResearchVersion, isProjectUnderstandingNode, normalizeProjectUnderstanding } = require('./projectUnderstanding.cjs');
const { assertPublicTopics, getProjectSearchProvider, runProjectUnderstandingResearchTask, waitForResearchOperation } = require('./projectUnderstandingResearch.cjs');

async function prepareContentProjectResearch(options) {
  const { configStore, aiService, workspaceStore, updateTask, taskControl, payload, previousState } = options;
  const plan = workspaceStore.loadTechnicalPlan() || {};
  const runtime = plan.contentGenerationRuntime || {};
  const resumeResearch = payload.resume && runtime.phase === 'researching' && runtime.research_request;
  const request = resumeResearch ? runtime.research_request : payload;
  const previousRuntime = resumeResearch ? { ...runtime, phase: runtime.research_previous_phase || 'planning' } : { ...(previousState?.contentGenerationRuntime || runtime) };
  delete previousRuntime.research_request;
  delete previousRuntime.research_previous_phase;
  const result = () => ({
    payload: request,
    previousState: {
      ...workspaceStore.loadTechnicalPlan(),
      contentGenerationRuntime: previousRuntime,
      ...(request.resume ? { contentGenerationTask: { ...(previousState?.contentGenerationTask || {}), status: 'paused' } } : {}),
    },
  });
  const projectNode = findProjectUnderstandingNode(plan.outlineData);
  const activeVersion = getActiveResearchVersion(plan.projectUnderstanding);
  const targetItemId = request.resume ? previousRuntime.target_item_id : request.targetItemId;
  if (plan.globalFactsTask?.status !== 'success' || !projectNode || projectNode.item.manual_input_required || projectNode.ancestors.some((item) => item.manual_input_required)
    || activeVersion?.evidence?.length || request.retryContentCorrection || request.retry_content_correction
    || request.rerunIllustrations || request.rerun_illustrations
    || (request.resume && ['illustration-planning', 'illustration-confirmation', 'illustration-generating'].includes(previousRuntime.phase))
    || (targetItemId && !isProjectUnderstandingNode(plan.outlineData, targetItemId))) {
    return resumeResearch ? result() : {};
  }

  const controller = new AbortController();
  taskControl.cancel = () => { controller.abort(); taskControl.pauseAiQueue?.(); };
  const timestamp = new Date().toISOString();
  const referenceDate = plan.projectUnderstanding?.reference_date || new Intl.DateTimeFormat('sv-SE').format(new Date());
  const config = configStore.load()?.project_research || {};
  const deadline = Date.now() + Number(config.overall_timeout_ms || 300000);
  const provider = getProjectSearchProvider(config);
  let researchTask = { task_id: crypto.randomUUID(), type: 'project-understanding-research', status: 'running', progress: 0, logs: [], started_at: timestamp, updated_at: timestamp };
  workspaceStore.updateTechnicalPlan({
    contentGenerationRuntime: { ...previousRuntime, phase: 'researching', research_request: request, research_previous_phase: previousRuntime.phase || 'planning' },
    projectUnderstanding: { ...normalizeProjectUnderstanding(plan.projectUnderstanding), placement: plan.projectUnderstanding?.placement || { status: 'reused', node_id: projectNode.item.id, reason: '复用现有项目理解章节' } },
  });
  const updateResearch = (partial, _state, eventPatch = {}) => {
    researchTask = { ...researchTask, ...partial, updated_at: new Date().toISOString() };
    const state = workspaceStore.updateTechnicalPlan({ projectUnderstandingTask: researchTask });
    const latestLog = researchTask.logs.at(-1) || '正在研究政府官网资料';
    updateTask({
      status: 'running', logs: researchTask.logs, stats: { content: { phase: 'researching' } },
      progress_detail: { phase: 'researching', phase_label: '项目理解资料研究', phase_progress: researchTask.progress, completed: researchTask.progress, total: 100, step: 'researching', step_label: latestLog },
    }, state, { ...eventPatch, technicalPlanPatch: { projectUnderstandingTask: researchTask, projectUnderstanding: state.projectUnderstanding, outlineData: state.outlineData } });
    return researchTask;
  };
  try {
    updateResearch({ logs: ['缺少项目理解证据，正在自动规划公开研究主题。'] });
    if (!provider.apiKey) throw new Error(`未配置${provider.name} API Key，请在“设置 > 组件设置 > 公开资料检索”中填写；其他正文仍可继续生成`);
    const topics = await waitForResearchOperation(aiService.requestJson({
      messages: [
        { role: 'system', content: '你只负责规划政府官网研究主题。仅提取行业、服务类别、地区及已经公开的机构名称；不得输出招标原文、项目专有名称、预算报价、个人信息、密钥或本地路径。不得编造单位、政策、文号和网址。' },
        { role: 'user', content: `根据当前项目背景生成最多 3 个简短公开检索主题，分别覆盖宏观/行业背景、上级公开部署/采购人公开职责、项目所属领域的相关要求。每个主题不超过 80 个字符，不带网址或搜索运算符。只返回 JSON：{"topics":["主题"]}。\n\n项目背景：\n${String(plan.projectOverview || plan.outlineData?.project_overview || '').slice(0, 8000)}\n\n技术需求：\n${String(plan.techRequirements || '').slice(0, 8000)}` },
      ],
      temperature: 0.1, response_format: { type: 'json_object' },
      normalizer: (value) => assertPublicTopics(value?.topics),
      validator: (value) => {
        if (value.length > 3 || value.some((topic) => topic.length > 80 || /https?:|site:/.test(topic))) throw new Error('自动研究主题应为最多 3 条、每条不超过 80 字的公开关键词');
      },
      progressLabel: '项目理解公开主题规划', failureMessage: '自动研究主题无效', logTitle: '项目理解公开主题规划', signal: controller.signal,
    }), deadline, controller.signal, () => controller.abort());
    if (taskControl.isPauseRequested()) {
      taskControl.cancel();
      throw Object.assign(new Error('项目理解自动研究已暂停'), { code: 'TASK_CANCELED' });
    }
    await runProjectUnderstandingResearchTask({ ...options, updateTask: updateResearch, payload: { topics: topics.map((topic) => `${topic} site:gov.cn`), reference_date: referenceDate, official_only: true, overall_deadline: deadline } });
    const researched = workspaceStore.loadTechnicalPlan().projectUnderstanding;
    const pending = researched?.versions?.find((version) => version.version_id === researched.pending_version_id);
    if (!getActiveResearchVersion(researched)?.evidence?.length && pending?.evidence?.length) {
      workspaceStore.updateProjectUnderstanding('apply-version', pending.version_id);
    }
    if (taskControl.isPauseRequested()) controller.abort();
    if (controller.signal.aborted) throw Object.assign(new Error('项目理解自动研究已暂停'), { code: 'TASK_CANCELED' });
    updateResearch({ status: 'success', logs: [...researchTask.logs, '自动研究已结束，继续正文生成；未获得有效证据的小节仍会跳过。'] });
  } catch (error) {
    if (taskControl.isPauseRequested() || error?.code === 'TASK_CANCELED') {
      updateResearch({ status: 'canceled', logs: [...researchTask.logs, '项目理解自动研究已暂停，继续正文任务后将重新获取。'] });
      const task = updateTask({ status: 'paused', pause_requested: false, logs: researchTask.logs }, workspaceStore.loadTechnicalPlan());
      workspaceStore.updateTechnicalPlan({ contentGenerationTask: task });
      return { paused: true };
    }
    updateResearch({ status: 'error', error: error.message, logs: [...researchTask.logs, `自动研究未完成：${error.message}`] });
  } finally {
    delete taskControl.cancel;
  }
  return result();
}

module.exports = { prepareContentProjectResearch };
