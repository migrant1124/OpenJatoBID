const DEFAULT_LAN_MANAGEMENT_PORT = 47821;

function normalizeLanServerAddress(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('INVALID_LAN_SERVER_ADDRESS');
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw new Error('INVALID_LAN_SERVER_ADDRESS');
  }
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password
    || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('INVALID_LAN_SERVER_ADDRESS');
  }
  const port = url.port ? Number(url.port) : DEFAULT_LAN_MANAGEMENT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INVALID_LAN_SERVER_ADDRESS');
  }
  const explicitPort = Boolean(url.port);
  const serverAddress = explicitPort ? url.host : url.hostname;
  return {
    host: url.hostname,
    port,
    baseUrl: `http://${url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname}:${port}`,
    serverAddress,
  };
}

module.exports = { DEFAULT_LAN_MANAGEMENT_PORT, normalizeLanServerAddress };
