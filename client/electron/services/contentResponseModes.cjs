const RESPONSE_MODES = [
  'freeform-markdown',
  'fixed-markdown-table',
  'locked-commitment',
  'evidence-markdown',
  'container',
  'explicit-none',
];

const VALID_RESPONSE_STATUSES = new Set([
  'pending',
  'responded-substantive',
  'responded-none',
  'needs-manual-input',
  'missing-required-evidence',
]);

const VALID_COMPLIANCE_RISKS = new Set(['none', 'warning', 'high', 'potential-rejection']);

const SPECIALIZED_WRITE_OPERATIONS = Object.freeze({
  'evidence-markdown': new Set(['render-evidence', 'save-evidence-response', 'deterministic-evidence-write']),
  'locked-commitment': new Set(['render-locked-template', 'save-locked-template-values']),
  'fixed-markdown-table': new Set(['render-fixed-table', 'save-fixed-table-values']),
  'explicit-none': new Set(['render-explicit-none']),
  container: new Set(),
});

function normalizeResponseMode(value) {
  if (value === undefined || value === null || value === '') return 'freeform-markdown';
  return RESPONSE_MODES.includes(value) ? value : null;
}

function normalizeOperation(value) {
  const raw = typeof value === 'string' ? value : value?.type ?? value?.operation;
  return String(raw || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function partitionOutlineResponseTargets(outlineItems) {
  const byMode = Object.fromEntries(RESPONSE_MODES.map((mode) => [mode, []]));
  const targets = [];

  function visit(items) {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue;
      const mode = normalizeResponseMode(item.response_mode);
      if (!mode) throw new Error(`未知的目录响应模式：${item.response_mode}`);
      byMode[mode].push(item);
      if (mode !== 'container') targets.push(item);
      visit(item.children);
    }
  }

  visit(outlineItems);
  return { byMode, targets, containers: byMode.container };
}

function normalizeRisk(value, fallback = 'none') {
  return VALID_COMPLIANCE_RISKS.has(value) ? value : fallback;
}

function buildDeterministicExplicitNone(item = {}) {
  const content = String(item.empty_response_text || '').trim() || '无。';
  const complianceRisk = normalizeRisk(
    item.compliance_risk,
    'none',
  );
  return {
    content,
    knowledge_item_ids: [],
    response_status: 'responded-none',
    compliance_risk: complianceRisk,
    ...(complianceRisk === 'none'
      ? {}
      : { compliance_message: String(item.compliance_message || '').trim() || '该节点已按无实质内容响应，请核对投标风险' }),
  };
}

function selectedKnowledgeIds(value) {
  const raw = Array.isArray(value)
    ? value
    : value?.knowledge_item_ids ?? value?.selected_ids ?? value?.selectedIds ?? [];
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of raw) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function escapeMarkdownInline(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_{}\[\]<>])/g, '\\$1');
}

function buildEvidenceMarkdown(item = {}, candidateKnowledgeItems, selectedIdsOrAgentResult) {
  const knownById = new Map();
  for (const candidate of Array.isArray(candidateKnowledgeItems) ? candidateKnowledgeItems : []) {
    const id = String(candidate?.id || candidate?.knowledge_item_id || '').trim();
    if (id && !knownById.has(id)) knownById.set(id, candidate);
  }

  const requestedIds = selectedKnowledgeIds(selectedIdsOrAgentResult);
  const knowledgeItemIds = requestedIds.filter((id) => knownById.has(id));
  const discardedKnowledgeItemIds = requestedIds.filter((id) => !knownById.has(id));

  if (!knowledgeItemIds.length) {
    const complianceRisk = normalizeRisk(item.missing_evidence_risk, 'high');
    const required = Boolean(item.response_required);
    return {
      content: '无。',
      knowledge_item_ids: [],
      discarded_knowledge_item_ids: discardedKnowledgeItemIds,
      response_status: required ? 'missing-required-evidence' : 'responded-none',
      compliance_risk: complianceRisk,
      compliance_message: required
        ? '强制证明材料缺失，确认风险后方可导出'
        : '未匹配到证明材料，已按“无”响应',
    };
  }

  const lines = ['### 材料索引', ''];
  knowledgeItemIds.forEach((id, index) => {
    const candidate = knownById.get(id);
    const title = escapeMarkdownInline(candidate?.title || candidate?.name || id) || escapeMarkdownInline(id);
    lines.push(`${index + 1}. ${title}（知识条目 ID：\`${escapeMarkdownInline(id)}\`）`);
  });

  return {
    content: lines.join('\n'),
    knowledge_item_ids: knowledgeItemIds,
    discarded_knowledge_item_ids: discardedKnowledgeItemIds,
    response_status: 'responded-substantive',
    compliance_risk: 'none',
  };
}

function validateResponseModeCompletion(item = {}) {
  const mode = normalizeResponseMode(item.response_mode);
  if (!mode) {
    return {
      node_id: String(item.id || ''),
      response_mode: String(item.response_mode || ''),
      is_target: true,
      response_status: 'pending',
      compliance_risk: 'high',
      response_complete: false,
      compliant: false,
      requires_attention: true,
      risk_acknowledgeable: false,
      reason: '该节点使用未知的响应模式',
    };
  }
  if (mode === 'container') {
    return {
      node_id: String(item.id || ''),
      response_mode: mode,
      is_target: false,
      response_complete: true,
      compliant: true,
      requires_attention: false,
      risk_acknowledgeable: false,
    };
  }

  const status = VALID_RESPONSE_STATUSES.has(item.response_status) ? item.response_status : 'pending';
  const risk = normalizeRisk(item.compliance_risk);
  const hasContent = Boolean(String(item.content || '').trim());
  const responseComplete = hasContent && (
    status === 'responded-substantive'
    || status === 'responded-none'
    || status === 'missing-required-evidence'
  );
  const highRisk = risk === 'high' || risk === 'potential-rejection';
  const compliant = responseComplete && status !== 'missing-required-evidence' && !highRisk;
  const requiresAttention = !compliant || risk === 'warning';

  let reason = '';
  if (status === 'pending') reason = '该节点尚未响应';
  else if (status === 'needs-manual-input') reason = '该节点尚需人工补充';
  else if (status === 'missing-required-evidence') reason = '强制证明材料缺失';
  else if (!hasContent) reason = '该节点正文为空';
  else if (highRisk) reason = '该节点存在高风险';
  else if (risk === 'warning') reason = '该节点需要风险提示';

  return {
    node_id: String(item.id || ''),
    response_mode: mode,
    is_target: true,
    response_status: status,
    compliance_risk: risk,
    response_complete: responseComplete,
    compliant,
    requires_attention: requiresAttention,
    risk_acknowledgeable: status === 'missing-required-evidence',
    ...(reason ? { reason } : {}),
  };
}

function deriveResponseCompletion(outlineItems, options = {}) {
  const taskStatus = String(options.taskStatus || options.task_status || 'success');
  const { targets } = partitionOutlineResponseTargets(outlineItems);
  const requiredTargets = targets.filter((item) => (!Array.isArray(item.children) || item.children.length === 0)
    && item.response_required !== false);
  const validations = requiredTargets.map(validateResponseModeCompletion);
  const pendingNodeIds = validations.filter((item) => !item.response_complete).map((item) => item.node_id);
  const attentionNodeIds = validations.filter((item) => item.requires_attention).map((item) => item.node_id);
  const missingEvidenceNodeIds = validations
    .filter((item) => item.response_status === 'missing-required-evidence')
    .map((item) => item.node_id);
  const taskExecutionSuccess = taskStatus === 'success';
  const responseComplete = validations.every((item) => item.response_complete);
  const complianceComplete = validations.every((item) => item.compliant);

  return {
    task_status: taskStatus,
    task_execution_success: taskExecutionSuccess,
    response_complete: responseComplete,
    compliance_complete: complianceComplete,
    outcome: !taskExecutionSuccess
      ? `execution-${taskStatus}`
      : complianceComplete ? 'compliant' : 'completed-with-actions-required',
    target_count: requiredTargets.length,
    response_complete_count: validations.filter((item) => item.response_complete).length,
    compliant_count: validations.filter((item) => item.compliant).length,
    pending_node_ids: pendingNodeIds,
    attention_node_ids: attentionNodeIds,
    missing_evidence_node_ids: missingEvidenceNodeIds,
    validations,
  };
}

function protectWriteForResponseMode(item = {}, operation) {
  const mode = normalizeResponseMode(item.response_mode);
  const normalizedOperation = normalizeOperation(operation);
  if (!mode) {
    return {
      decision: 'reject',
      allowed: false,
      response_mode: String(item.response_mode || ''),
      operation: normalizedOperation,
      reason: '未知的响应模式，已阻止写入',
    };
  }
  if (mode === 'freeform-markdown') {
    return { decision: 'allow', allowed: true, response_mode: mode, operation: normalizedOperation };
  }

  const allowed = SPECIALIZED_WRITE_OPERATIONS[mode]?.has(normalizedOperation) || false;
  return {
    decision: allowed ? 'allow' : 'reject',
    allowed,
    response_mode: mode,
    operation: normalizedOperation,
    ...(!allowed ? { reason: mode === 'container' ? '容器节点不生成正文' : '该章节使用受控响应，不能通过通用写入覆盖' } : {}),
  };
}

function reduceResponseModeRunState(state = {}, event = {}) {
  const current = {
    status: state.status || 'idle',
    completed: Number.isFinite(state.completed) ? state.completed : 0,
    ...state,
  };
  const type = normalizeOperation(event.type);
  if (type === 'start' && ['idle', 'error', 'success'].includes(current.status)) {
    return { ...current, status: 'running', error: undefined };
  }
  if (type === 'pause' && current.status === 'running') return { ...current, status: 'paused' };
  if (type === 'resume' && current.status === 'paused') return { ...current, status: 'running' };
  if (type === 'advance' && current.status === 'running') {
    const increment = Number.isFinite(event.count) ? event.count : 1;
    return { ...current, completed: Math.max(0, current.completed + increment) };
  }
  if (type === 'complete' && current.status === 'running') return { ...current, status: 'success' };
  if (type === 'fail' && current.status === 'running') {
    return { ...current, status: 'error', error: String(event.error || '任务执行失败') };
  }
  return current;
}

module.exports = {
  RESPONSE_MODES,
  partitionOutlineResponseTargets,
  buildDeterministicExplicitNone,
  buildEvidenceMarkdown,
  validateResponseModeCompletion,
  deriveResponseCompletion,
  protectWriteForResponseMode,
  reduceResponseModeRunState,
};
