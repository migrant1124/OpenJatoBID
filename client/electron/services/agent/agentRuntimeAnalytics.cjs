const MAX_RETRY_COUNT = 3;

function normalizeEndpointHost(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const candidates = text.includes('://') ? [text] : [`https://${text}`];
  for (const candidate of candidates) {
    try {
      return new URL(candidate).hostname.toLowerCase();
    } catch {}
  }
  return text.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
}

// 上报最终 Agent 执行状态，不包含任务内容、路径或错误详情。
function trackAgentRuntime(app, configStore, analyticsService, runtimeId, status, meta = {}) {
  if (!analyticsService || typeof analyticsService.track !== 'function') return;
  const runtimeStatus = status === 'success' ? 'success' : 'failed';
  const retryCount = Math.max(0, Math.min(MAX_RETRY_COUNT, Math.floor(Number(meta.retryCount || 0) || 0)));
  void Promise.resolve()
    .then(() => {
      const config = configStore.load();
      return analyticsService.track({
        event: 'agent_runtime',
        version: typeof app?.getVersion === 'function' ? app.getVersion() : '',
        platform: process.platform,
        arch: process.arch,
        agent_runtime_kind: runtimeId,
        agent_runtime_status: runtimeStatus,
        agent_runtime_retry_count: retryCount,
        ai_model_provider: config.text_model_provider || '',
        ai_model_base_url: normalizeEndpointHost(config.base_url || ''),
        ai_model_name: config.model_name || '',
      });
    })
    .catch(() => undefined);
}

module.exports = {
  trackAgentRuntime,
};
