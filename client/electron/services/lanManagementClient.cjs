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

  return {
    health: () => request('/api/v1/health'),
    submitApplication: (input) => request('/api/v1/authorization/applications', { method: 'POST', body: input }),
    getApplication: (applicationId) => request(`/api/v1/authorization/applications/${encodeURIComponent(applicationId)}`),
    login: (input) => request('/api/v1/authorization/login', { method: 'POST', body: input }),
    verify: (input) => request('/api/v1/authorization/verify', { method: 'POST', body: input }),
    submitAnalytics: (events) => request('/api/v1/analytics/events', { method: 'POST', body: { events } }),
  };
}

module.exports = { createLanManagementClient };
