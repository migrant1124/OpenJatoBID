const { normalizeOutlineDeepeningPatch, applyOutlineDeepeningPatch } = require('./outlineDeepeningPatch.cjs');

function collectJson(aiService, options) {
  if (typeof aiService?.collectJsonResponse === 'function') return aiService.collectJsonResponse(options);
  if (typeof aiService?.requestJson === 'function') return aiService.requestJson(options);
  throw new Error('AI 服务尚未初始化');
}

function findItem(items, nodeId) {
  for (const item of items || []) {
    if (String(item.id) === nodeId) return item;
    const child = findItem(item.children, nodeId);
    if (child) return child;
  }
  return null;
}

function buildOutlineDeepeningPrompt({ target, matrix, allowAiValueAdditions }) {
  return [
    '你正在对投标技术文件的一个二级目录执行“AI 深化本节”。只返回 JSON Patch，绝不返回完整目录。',
    '',
    '硬性规则：',
    '1. target_node_id 必须等于 ' + target.id + '；不得删除、移动或改名任何现有标题，也不得修改目标子树之外的节点。',
    '2. 只能完善现有 description，或通过 additions 新增三级、四级、五级节点。每个 addition 只含 parent_id、可选 client_id、title、description；若要引用本次新增父节点，用其 client_id 作为后续 parent_id。',
    '3. 必须设置 deep_writing=true，并使目标子树存在完整二级→三级→四级→五级路径；禁止六级目录。',
    '4. 固定、锁定、人工填写和受控响应节点不可更新或新增子节点。',
    '5. mapped_scoring_point_ids 只能保留当前二级目录已承担的评分点；value_anchor_ids 只能使用已确认锚点。不得虚构企业能力、案例、人员或资质。',
    allowAiValueAdditions ? '6. 已允许新增有评分价值的目录标题。' : '6. 未允许新增来源外增值标题；仅完善既有标题下的结构。',
    '',
    '返回格式：',
    JSON.stringify({
      schema_version: 1,
      target_node_id: target.id,
      deep_writing: true,
      writing_profile: 'deep',
      deep_writing_reason: '深化原因',
      mapped_scoring_point_ids: ['评分点 ID'],
      value_anchor_ids: ['已确认锚点 ID'],
      updates: [{ node_id: '现有节点 ID', description: '完善后的说明' }],
      additions: [{ parent_id: '现有节点 ID 或 client_id', client_id: 'new-1', title: '新增标题', description: '具体写作任务' }],
    }, null, 2),
    '',
    '目标二级目录：',
    JSON.stringify(target, null, 2),
    '',
    '当前评分矩阵：',
    JSON.stringify({
      scoring_points: matrix.scoring_points,
      value_anchors: matrix.value_anchors.filter((anchor) => anchor.status === 'accepted'),
    }, null, 2),
  ].join('\n');
}

async function runOutlineDeepeningTask({ aiService, workspaceStore, updateTask, payload }) {
  const plan = workspaceStore.loadTechnicalPlan() || {};
  const targetNodeId = String(payload?.target_node_id || '').trim();
  const target = findItem(plan.outlineData?.outline, targetNodeId);
  if (!target || targetNodeId.split('.').length !== 2) throw new Error('请选择一个真实的二级目录后再执行 AI 深化');
  if (!plan.requirementResponseMatrix) throw new Error('评分响应矩阵不存在，不能执行局部深化');
  const allowAiValueAdditions = payload?.allow_ai_value_additions === true;
  const logs = ['正在分析目标二级目录的评分点、锚点和现有结构'];
  updateTask({ status: 'running', progress: 10, logs }, plan);

  const patch = await collectJson(aiService, {
    temperature: 0.35,
    messages: [
      { role: 'system', content: '你是投标技术文件目录深化助手。严格按局部 Patch 返回 JSON。' },
      { role: 'user', content: buildOutlineDeepeningPrompt({ target, matrix: plan.requirementResponseMatrix, allowAiValueAdditions }) },
    ],
    normalizer: normalizeOutlineDeepeningPatch,
    validator: (value) => applyOutlineDeepeningPatch({
      outlineData: plan.outlineData,
      requirementResponseMatrix: plan.requirementResponseMatrix,
      patch: value,
      outlineExpansionMode: plan.outlineExpansionMode,
      allowAiValueAdditions,
    }),
    progressLabel: 'AI 深化本节目录',
    failureMessage: 'AI 深化本节返回的 Patch 无效',
  });
  const candidate = applyOutlineDeepeningPatch({
    outlineData: plan.outlineData,
    requirementResponseMatrix: plan.requirementResponseMatrix,
    patch,
    outlineExpansionMode: plan.outlineExpansionMode,
    allowAiValueAdditions,
  });
  const latest = workspaceStore.loadTechnicalPlan();
  updateTask({
    status: 'success',
    progress: 100,
    error: undefined,
    logs: [...logs, '已生成局部深化候选：新增 ' + candidate.diff.added_node_ids.length + ' 个目录节点，等待确认应用'],
    stats: {
      target_node_id: targetNodeId,
      allow_ai_value_additions: allowAiValueAdditions,
      patch: candidate.patch,
      diff: candidate.diff,
    },
  }, latest);
}

module.exports = {
  buildOutlineDeepeningPrompt,
  runOutlineDeepeningTask,
};
