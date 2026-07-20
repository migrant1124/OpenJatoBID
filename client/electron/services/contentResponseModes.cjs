function collectLeafItems(items, leaves = []) {
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item.children) && item.children.length) collectLeafItems(item.children, leaves);
    else leaves.push(item);
  }
  return leaves;
}

function validateResponseModeCompletion(item = {}) {
  const manual = item.manual_input_required === true;
  const hasContent = Boolean(String(item.content || '').trim());
  const complete = manual || hasContent;
  return {
    node_id: String(item.id || ''),
    is_target: true,
    response_status: manual ? 'manual' : hasContent ? 'responded-substantive' : 'pending',
    compliance_risk: 'none',
    response_complete: complete,
    compliant: complete,
    requires_attention: false,
    risk_acknowledgeable: false,
    ...(!complete ? { reason: '该 AI 编制小节尚未生成正文' } : {}),
  };
}

function deriveResponseCompletion(outlineItems, options = {}) {
  const taskStatus = String(options.taskStatus || options.task_status || 'success');
  const validations = collectLeafItems(outlineItems).map(validateResponseModeCompletion);
  const pendingNodeIds = validations.filter((item) => !item.response_complete).map((item) => item.node_id);
  const responseComplete = validations.every((item) => item.response_complete);
  return {
    task_status: taskStatus,
    task_execution_success: taskStatus === 'success',
    response_complete: responseComplete,
    compliance_complete: responseComplete,
    outcome: taskStatus !== 'success'
      ? `execution-${taskStatus}`
      : responseComplete ? 'compliant' : 'completed-with-actions-required',
    target_count: validations.length,
    response_complete_count: validations.filter((item) => item.response_complete).length,
    compliant_count: validations.filter((item) => item.compliant).length,
    pending_node_ids: pendingNodeIds,
    attention_node_ids: [],
    missing_evidence_node_ids: [],
    validations,
  };
}

function protectWriteForResponseMode(item = {}, operation) {
  const normalizedOperation = String(operation || '').trim();
  if (item.manual_input_required === true) {
    return {
      decision: 'reject',
      allowed: false,
      operation: normalizedOperation,
      reason: '该章节已确认由人工编制，AI 和自动处理不得修改',
    };
  }
  return { decision: 'allow', allowed: true, operation: normalizedOperation };
}

module.exports = {
  deriveResponseCompletion,
  protectWriteForResponseMode,
  validateResponseModeCompletion,
};
