const { fetch } = require('undici');
const { normalizeLanServerAddress } = require('./lanServerAddress.cjs');

function createLanManagementClient({ serverAddress, fetchImpl = fetch, timeoutMs = 10000 }) {
  const { baseUrl } = normalizeLanServerAddress(serverAddress);

  async function request(pathname, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('LAN_SERVER_UNREACHABLE');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('LAN_INVALID_RESPONSE');
    }
    if (!response.ok) {
      throw new Error(payload?.error?.code || 'LAN_REQUEST_FAILED');
    }
    return payload.data;
  }

  async function watchAuthorization({ watchToken, onEvent, signal }) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/authorization/watch`, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${String(watchToken || '')}`,
        },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) return;
      throw new Error('LAN_SERVER_UNREACHABLE');
    }
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      throw new Error(payload?.error?.code || 'LAN_REQUEST_FAILED');
    }
    if (!response.body) throw new Error('LAN_INVALID_RESPONSE');

    const decoder = new TextDecoder();
    let buffer = '';
    const dispatch = async (block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      let event;
      try { event = JSON.parse(data); } catch { throw new Error('LAN_INVALID_RESPONSE'); }
      await onEvent?.(event);
    };

    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || '\n\n';
          buffer = buffer.slice(boundary + separator.length);
          await dispatch(block);
          boundary = buffer.search(/\r?\n\r?\n/);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) await dispatch(buffer);
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
  }

  return {
    health: () => request('/api/v1/health'),
    submitApplication: (input) => request('/api/v1/authorization/applications', { method: 'POST', body: input }),
    getApplication: (applicationId) => request(`/api/v1/authorization/applications/${encodeURIComponent(applicationId)}`),
    login: (input) => request('/api/v1/authorization/login', { method: 'POST', body: input }),
    verify: (input) => request('/api/v1/authorization/verify', { method: 'POST', body: input }),
    watchAuthorization,
    acknowledgeRevocation: (input) => request('/api/v1/authorization/revocations/ack', { method: 'POST', body: input }),
    submitAnalytics: (events) => request('/api/v1/analytics/events', { method: 'POST', body: { events } }),
  };
}

module.exports = { createLanManagementClient };
