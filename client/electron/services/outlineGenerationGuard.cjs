'use strict';

const {
  appendTaskLog,
  cloneValue,
  createServiceProxy,
  createStagedWorkspaceStore,
  createTerminalHoldingUpdateTask,
  extractBalancedJson,
  extractOutlinePayload,
  sameValue,
  singleLine,
  titleKey,
} = require('./technicalPlanGuardUtils.cjs');

const FORMAT_CONSTRAINT_FIELDS = [
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
const RESPONSE_MODES = new Set([
  'freeform-markdown',
  'fixed-markdown-table',
  'locked-commitment',
  'evidence-markdown',
  'container',
  'explicit-none',
]);
const OUTLINE_COMMIT_FIELDS = [
  'outlineMode',
  'outlineExpansionMode',
  'referenceKnowledgeDocumentIds',
  'outlineData',
  'contentGenerationTask',
  'contentGenerationSections',
  'contentGenerationPlans',
  'contentGenerationRuntime',
];

function copyFormatConstraints(target, source) {
  const next = { ...target };
  for (const field of FORMAT_CONSTRAINT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source || {}, field)) continue;
    const value = source[field];
    if (field === 'response_mode') {
      if (RESPONSE_MODES.has(value)) next[field] = value;
    } else if (field === 'mapped_requirement_ids') {
      if (Array.isArray(value)) next[field] = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
    } else if (['manual_input_required', 'required_in_outline', 'response_required', 'title_locked', 'order_locked', 'level_locked', 'allow_ai_children'].includes(field)) {
      if (typeof value === 'boolean') next[field] = value;
    } else if (value !== undefined && value !== null) {
      next[field] = String(value);
    }
  }
  if (next.manual_input_required === true) {
    next.allow_ai_children = false;
    next.response_required = true;
  }
  return next;
}

function mergeRawConstraints(normalizedPayload, rawPayload) {
  const normalizedOutline = normalizedPayload?.outline;
  const rawOutline = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray(rawPayload?.outline) ? rawPayload.outline : [];
  if (!Array.isArray(normalizedOutline) || !rawOutline.length) return normalizedPayload;
  function mergeItems(normalizedItems, rawItems) {
    return (normalizedItems || []).map((item, index) => {
      const rawItem = rawItems[index]
        || rawItems.find((candidate) => titleKey(candidate?.title) === titleKey(item?.title))
        || {};
      const next = copyFormatConstraints(item, rawItem);
      if (item.children?.length) next.children = mergeItems(item.children, Array.isArray(rawItem.children) ? rawItem.children : []);
      return next;
    });
  }
  return { ...normalizedPayload, outline: mergeItems(normalizedOutline, rawOutline) };
}

function mergeSourceConstraints(finalItems, sourceItems, path = 'outline') {
  let cursor = 0;
  const next = cloneValue(finalItems || []);
  for (const sourceItem of sourceItems || []) {
    const sourceTitle = singleLine(sourceItem?.title);
    const foundIndex = next.findIndex((candidate, index) => index >= cursor && singleLine(candidate?.title) === sourceTitle);
    if (foundIndex < 0) throw new Error(`${path}: 来源目录“${sourceTitle || '未命名'}”缺失或顺序被改变`);
    const finalItem = next[foundIndex];
    const merged = copyFormatConstraints(finalItem, sourceItem);
    if (finalItem.children?.length) {
      merged.children = mergeSourceConstraints(finalItem.children, Array.isArray(sourceItem.children) ? sourceItem.children : [], `${path} > ${sourceTitle}`);
    }
    next[foundIndex] = merged;
    cursor = foundIndex + 1;
  }
  return next;
}

function collectTitleKeys(items, keys = new Set()) {
  for (const item of items || []) {
    const key = titleKey(item?.title);
    if (key) keys.add(key);
    collectTitleKeys(item?.children, keys);
  }
  return keys;
}

function outlineDepth(items) {
  return items?.length ? 1 + Math.max(...items.map((item) => outlineDepth(item?.children || []))) : 0;
}

function extractRequirementIds(item) {
  const direct = item?.source_requirement_id === undefined || item.source_requirement_id === null
    ? []
    : String(item.source_requirement_id).split(',').map((id) => id.trim()).filter(Boolean);
  if (direct.length) return [...new Set(direct)];
  return [...new Set((Array.isArray(item?.mapped_requirement_ids) ? item.mapped_requirement_ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
}

function normalizeAndValidateOutline(outlineData, context = {}) {
  if (!outlineData || !Array.isArray(outlineData.outline) || !outlineData.outline.length) throw new Error('最终目录不能为空');
  const sourceOutline = context.sourceOutline?.outline || [];
  const groups = Array.isArray(context.groups) ? context.groups : [];
  const groupById = new Map(groups.map((group) => [String(group?.requirement_id || '').trim(), group]).filter(([id]) => Boolean(id)));
  const groupIds = new Set(groupById.keys());
  const mappedGroupIds = new Set();
  const allowedTitles = context.outlineExpansionMode === 'original-only'
    ? collectTitleKeys([...(sourceOutline || []), ...((context.originalOutline?.outline) || [])])
    : null;

  if (sourceOutline.length) {
    if (outlineData.outline.length !== sourceOutline.length) throw new Error('一级目录数量必须与目录来源完全一致');
    outlineData.outline.forEach((item, index) => {
      if (singleLine(item?.title) !== singleLine(sourceOutline[index]?.title)) {
        throw new Error(`一级目录必须保持来源顺序和标题：${sourceOutline[index]?.title || '未命名目录'}`);
      }
    });
  }

  function normalizeItems(items, parentId = '', level = 1, path = 'outline') {
    const seenTitles = new Set();
    return items.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error(`${path}[${index}] 必须是对象`);
      const id = parentId ? `${parentId}.${index + 1}` : String(index + 1);
      const title = singleLine(rawItem.title);
      if (!title) throw new Error(`${path}[${index}].title 不能为空`);
      const key = titleKey(title);
      if (seenTitles.has(key)) throw new Error(`${path}[${index}].title 与同级目录重复：${title}`);
      seenTitles.add(key);
      const children = Array.isArray(rawItem.children) ? rawItem.children : [];
      if (level > 4) throw new Error(`${path}[${index}] 目录层级不能超过四级`);
      if (rawItem.manual_input_required === true && children.length) throw new Error(`${path}[${index}] 人工填写节点必须是叶子节点`);
      if (level >= 2 && allowedTitles && !allowedTitles.has(key)) throw new Error(`仅参考原方案模式不允许新增原方案或来源骨架之外的目录：${title}`);

      const requirementIds = extractRequirementIds(rawItem);
      if (level === 1 && requirementIds.length) throw new Error(`一级目录不能绑定技术评分项：${title}`);
      for (const requirementId of requirementIds) {
        if (!groupIds.has(requirementId)) throw new Error(`目录绑定了未知技术评分项：${requirementId}`);
        mappedGroupIds.add(requirementId);
      }

      const next = copyFormatConstraints({ ...rawItem, id, title, description: String(rawItem.description || '').trim() || title }, rawItem);
      delete next.content;
      delete next.children;
      if (requirementIds.length === 1) {
        next.source_requirement_id = requirementIds[0];
        next.source_requirement_title = singleLine(groupById.get(requirementIds[0])?.title) || singleLine(rawItem.source_requirement_title);
      } else if (requirementIds.length > 1) {
        next.source_requirement_id = requirementIds.join(',');
        next.mapped_requirement_ids = requirementIds;
        delete next.source_requirement_title;
      }
      if (children.length) next.children = normalizeItems(children, id, level + 1, `${path}[${index}].children`);
      return next;
    });
  }

  const outline = normalizeItems(sourceOutline.length ? mergeSourceConstraints(outlineData.outline, sourceOutline) : outlineData.outline);
  const depth = outlineDepth(outline);
  if (depth < 3) throw new Error('完整目录至少需要三级结构');
  if (depth > 4) throw new Error('最终目录层级不能超过四级');
  const missing = [...groupIds].filter((id) => !mappedGroupIds.has(id));
  if (missing.length) throw new Error(`技术评分项未映射到目录：${missing.map((id) => singleLine(groupById.get(id)?.title) || id).join('、')}`);
  return { ...cloneValue(outlineData), outline };
}

function extractOriginalOutlineFromMessages(messages) {
  const text = (messages || []).map((message) => String(message?.content || '')).join('\n\n');
  const marker = '原方案目录（仅补充下级）：';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const candidate = extractBalancedJson(text, markerIndex + marker.length);
  if (!candidate) return null;
  try { return extractOutlinePayload(candidate); } catch { return null; }
}

function buildFormatConstraintInstruction() {
  return {
    role: 'user',
    content: `请同时保留来源明确规定的目录约束字段。仅在来源有明确依据时填写：
- 固定表格：response_mode="fixed-markdown-table"；固定承诺函：response_mode="locked-commitment"；证明材料：response_mode="evidence-markdown"；纯容器：response_mode="container"；明确要求填写“无/不适用”：response_mode="explicit-none"。
- 来源明确要求保留的节点设置 required_in_outline=true；标题、顺序、层级固定时分别设置 title_locked、order_locked、level_locked=true。
- 不允许 AI 增加子目录时设置 allow_ai_children=false；来源有原编号时写入 source_number，title 仍只写纯标题。
没有明确依据的字段不要臆造。`,
  };
}

function buildOriginalOnlyInstruction() {
  return {
    role: 'user',
    content: `当前为“仅参考原方案下级目录”模式：
1. 冻结来源骨架已有目录；新增或补充的二级及以下目录标题只能来自原方案目录或来源骨架，禁止根据评分项、常识或知识库自行创造新目录标题。
2. 技术评分项只能映射到现有或从原方案复制的下级目录。
3. 无法找到合理承载节点时，不得虚构目录；应让本次校验失败并由用户选择“AI补充下级目录”模式。`,
  };
}

function createOutlineAiGuard(aiService, capture) {
  async function call(methodName, options = {}) {
    const label = String(options.progressLabel || options.logTitle || '');
    let rawValue;
    const nextOptions = { ...options, messages: [...(options.messages || [])] };
    if (label === '格式目录骨架') nextOptions.messages.push(buildFormatConstraintInstruction());
    if (label === '目录下级补充' && capture.outlineExpansionMode === 'original-only') nextOptions.messages.push(buildOriginalOnlyInstruction());
    if (typeof options.normalizer === 'function') {
      nextOptions.normalizer = (value) => {
        rawValue = cloneValue(value);
        return options.normalizer(value);
      };
    }
    const method = aiService?.[methodName];
    if (typeof method !== 'function') throw new Error(`AI 服务缺少 ${methodName}`);
    let result = await method.call(aiService, nextOptions);
    if (label === '格式目录骨架' || label === '知识库目录骨架') {
      result = mergeRawConstraints(result, rawValue);
      capture.sourceOutline = cloneValue(result);
    } else if (label === '技术评分大类') {
      capture.groups = cloneValue(result?.groups || []);
    } else if (label === '目录下级补充') {
      capture.originalOutline = extractOriginalOutlineFromMessages(nextOptions.messages);
    }
    return result;
  }
  return createServiceProxy(aiService, {
    collectJsonResponse: (options) => call('collectJsonResponse', options),
    requestJson: (options) => call('requestJson', options),
  });
}

function normalizeReviewResult(value) {
  const source = value?.result && typeof value.result === 'object' ? value.result : value || {};
  return {
    passed: source.passed === true || String(source.passed || '').toLowerCase() === 'true',
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.map((item) => singleLine(item)).filter(Boolean) : [],
  };
}

function compactOutline(items) {
  return (items || []).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    source_requirement_id: item.source_requirement_id,
    mapped_requirement_ids: item.mapped_requirement_ids,
    children: item.children?.length ? compactOutline(item.children) : undefined,
  }));
}

async function collectJson(aiService, options) {
  if (typeof aiService?.collectJsonResponse === 'function') return aiService.collectJsonResponse(options);
  if (typeof aiService?.requestJson === 'function') return aiService.requestJson(options);
  throw new Error('AI JSON 服务尚未初始化');
}

async function reviewOutlineSemantics(aiService, context) {
  if (!context.groups?.length) return { passed: true, suggestions: [] };
  return collectJson(aiService, {
    temperature: 0.1,
    logTitle: '目录最终安全审核',
    progressLabel: '目录最终安全审核',
    messages: [{
      role: 'system',
      content: '你是严格的技术标目录审核器。只返回 JSON，不修改目录。',
    }, {
      role: 'user',
      content: `请审核技术评分项与目录下级节点的语义映射是否合理。
通过条件：一级目录保持来源骨架；每个评分项映射到语义相关的二级及以下节点；不能只因为 ID 出现就视为覆盖；不存在明显错位、重复堆叠或无关通用节点承载全部评分项；${context.outlineExpansionMode === 'original-only' ? '新增标题只能来自原方案或来源骨架。' : 'AI 补充目录不能偏离项目和评分主题。'}

技术评分项：
${JSON.stringify(context.groups, null, 2)}

目录：
${JSON.stringify({ outline: compactOutline(context.outlineData.outline) }, null, 2)}

只返回 {"passed":true,"suggestions":[]}。不通过时 suggestions 给出具体局部问题。`,
    }],
    normalizer: normalizeReviewResult,
    validator(value) {
      if (typeof value?.passed !== 'boolean' || !Array.isArray(value?.suggestions)) throw new Error('目录最终审核结果格式无效');
    },
    failureMessage: '目录最终安全审核结果格式无效',
  });
}

async function repairOutlineWithAgent(agentService, context) {
  if (typeof agentService?.runTask !== 'function') throw new Error('目录审核未通过，且 Agent 服务不可用');
  const result = await agentService.runTask({
    title: '技术方案目录安全修复',
    prompt: `请修复 candidate-outline.json，并把最终结果写入 safe-outline-result.json。
必须保持 source-outline.json 的一级目录和已有格式约束；每个节点必须有非空 title、description；深度为三级或四级；评分项只能映射到二级及以下节点且全部覆盖；${context.outlineExpansionMode === 'original-only' ? '新增标题只能来自 original-outline.json 或 source-outline.json。' : '可按评分项和原方案补充必要下级目录。'}
只输出 {"outline":[...]}，不要输出正文或解释。`,
    output_file: 'safe-outline-result.json',
    files: [
      { path: 'candidate-outline.json', content: JSON.stringify(context.outlineData, null, 2) },
      { path: 'source-outline.json', content: JSON.stringify(context.sourceOutline || { outline: [] }, null, 2) },
      { path: 'requirement-groups.json', content: JSON.stringify({ groups: context.groups || [] }, null, 2) },
      { path: 'original-outline.json', content: JSON.stringify(context.originalOutline || { outline: [] }, null, 2) },
    ],
    timeout_ms: 15 * 60 * 1000,
    max_retries: 1,
  });
  if (result?.status === 'busy' || result?.skipped === true) throw new Error('Agent 正在处理其他任务，无法修复目录');
  const content = String(result?.output_content || result?.assistant_text || '').trim();
  if (!content) throw new Error('Agent 未返回目录修复结果');
  return extractOutlinePayload(content);
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
    const capture = {
      sourceOutline: null,
      originalOutline: null,
      groups: [],
      outlineExpansionMode: args.payload?.outline_expansion_mode === 'original-only' ? 'original-only' : 'ai-complement',
    };

    await baseRunner({
      ...args,
      aiService: createOutlineAiGuard(args.aiService, capture),
      workspaceStore: staged.store,
      updateTask: terminal.updateTask,
    });

    let stagedState = staged.getState();
    let outlineData = normalizeAndValidateOutline(stagedState.outlineData, capture);
    appendTaskLog({
      workspaceStore: realStore,
      updateTask: args.updateTask,
      taskField: 'outlineGenerationTask',
      message: '目录结构与评分映射程序校验通过，正在执行最终语义审核。',
    });

    let review = await reviewOutlineSemantics(args.aiService, { ...capture, outlineData });
    if (args.payload?.debug_force_outline_agent_repair || !review.passed) {
      appendTaskLog({
        workspaceStore: realStore,
        updateTask: args.updateTask,
        taskField: 'outlineGenerationTask',
        message: args.payload?.debug_force_outline_agent_repair
          ? '开发者模式强制执行 Agent 目录修复。'
          : `最终语义审核未通过：${review.suggestions.join('；') || '存在评分项映射问题'}`,
      });
      const repaired = await repairOutlineWithAgent(args.agentService, { ...capture, outlineData });
      outlineData = normalizeAndValidateOutline(repaired, capture);
      review = await reviewOutlineSemantics(args.aiService, { ...capture, outlineData });
      if (!review.passed) throw new Error(`Agent 修复后目录审核仍未通过：${review.suggestions.join('；') || '评分项映射不合理'}`);
    }

    stagedState = { ...stagedState, outlineData };
    const patch = buildChangedPatch(initialState, stagedState);
    patch.outlineData = outlineData;
    patch.contentIllustrationPlan = undefined;
    const saved = realStore.updateTechnicalPlan(patch);
    const committedOutlineData = saved.outlineData || outlineData;
    const terminalState = terminal.getTerminal();
    args.updateTask({
      ...(terminalState?.partial || {}),
      status: 'success',
      progress: 100,
      error: undefined,
      logs: [
        ...(terminalState?.partial?.logs || saved.outlineGenerationTask?.logs || []),
        '目录最终安全审核通过，已原子提交新目录。',
      ],
    }, saved, {
      outlineData: committedOutlineData,
      technicalPlanPatch: { ...patch, outlineData: committedOutlineData },
    });
  };
}

module.exports = {
  createGuardedOutlineRunner,
  normalizeAndValidateOutline,
};
