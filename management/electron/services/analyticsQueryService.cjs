const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function getBeijingDayStart(now) {
  const shifted = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - BEIJING_OFFSET_MS);
}

function resolveRange(range, now) {
  if (range === 'all') return { start: null, end: now.toISOString() };
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 1;
  const start = getBeijingDayStart(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString(), end: now.toISOString() };
}

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function createAnalyticsQueryService({ database, now = () => new Date() }) {
  function buildFilter(range, alias = 'analytics_events') {
    const bounds = resolveRange(range, now());
    const prefix = alias ? `${alias}.` : '';
    return bounds.start
      ? { sql: `${prefix}occurred_at >= ? AND ${prefix}occurred_at <= ?`, params: [bounds.start, bounds.end], bounds }
      : { sql: `${prefix}occurred_at <= ?`, params: [bounds.end], bounds };
  }

  function groupPayloadField(range, field, eventType = null) {
    const filter = buildFilter(range, '');
    const eventFilter = eventType ? 'AND event_type = ?' : '';
    const rows = database.prepare(`
      SELECT CAST(json_extract(payload_json, ?) AS TEXT) AS name, COUNT(*) AS value
      FROM analytics_events
      WHERE ${filter.sql}
        ${eventFilter}
        AND NULLIF(TRIM(CAST(json_extract(payload_json, ?) AS TEXT)), '') IS NOT NULL
      GROUP BY name
      ORDER BY value DESC, name ASC
    `).all(`$.${field}`, ...filter.params, ...(eventType ? [eventType] : []), `$.${field}`);
    return rows.map((row) => ({ name: row.name, value: Number(row.value) }));
  }

  function getDashboard(range = '7d') {
    const generatedAt = now();
    const normalizedRange = ['today', '7d', '30d', 'all'].includes(range) ? range : '7d';
    const filter = buildFilter(normalizedRange, '');
    const summary = database.prepare(`
      SELECT
        COUNT(*) AS totalEvents,
        COUNT(DISTINCT NULLIF(client_id, '')) AS activeClients,
        SUM(CASE WHEN event_type = 'ai_request' THEN 1 ELSE 0 END) AS aiRequests,
        COALESCE(SUM(CASE WHEN event_type = 'ai_request' THEN CAST(json_extract(payload_json, '$.prompt_tokens') AS INTEGER) ELSE 0 END), 0) AS promptTokens,
        COALESCE(SUM(CASE WHEN event_type = 'ai_request' THEN CAST(json_extract(payload_json, '$.completion_tokens') AS INTEGER) ELSE 0 END), 0) AS completionTokens,
        COALESCE(SUM(CASE WHEN event_type = 'ai_request' THEN CAST(json_extract(payload_json, '$.total_tokens') AS INTEGER) ELSE 0 END), 0) AS totalTokens,
        SUM(CASE WHEN event_type = 'agent_runtime' AND json_extract(payload_json, '$.agent_runtime_status') = 'success' THEN 1 ELSE 0 END) AS agentSuccess,
        SUM(CASE WHEN event_type = 'agent_runtime' AND json_extract(payload_json, '$.agent_runtime_status') = 'failed' THEN 1 ELSE 0 END) AS agentFailed,
        COALESCE(SUM(CASE WHEN event_type = 'agent_runtime' THEN CAST(json_extract(payload_json, '$.agent_runtime_retry_count') AS INTEGER) ELSE 0 END), 0) AS agentRetries
      FROM analytics_events
      WHERE ${filter.sql}
    `).get(...filter.params);
    const totalClients = database.prepare(`
      SELECT COUNT(DISTINCT client_id) AS total
      FROM analytics_events
      WHERE client_id <> '' AND occurred_at <= ?
    `).get(filter.bounds.end).total;
    const newClients = filter.bounds.start
      ? database.prepare(`
          SELECT COUNT(*) AS total FROM (
            SELECT client_id, MIN(occurred_at) AS first_seen_at
            FROM analytics_events
            WHERE client_id <> '' AND occurred_at <= ?
            GROUP BY client_id
          ) WHERE first_seen_at >= ? AND first_seen_at <= ?
        `).get(filter.bounds.end, filter.bounds.start, filter.bounds.end).total
      : totalClients;
    const onlineCutoff = new Date(generatedAt.getTime() - 10 * 60 * 1000).toISOString();
    const onlineClients = database.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT client_id FROM analytics_events
        WHERE occurred_at >= ? AND occurred_at <= ? AND client_id <> ''
        UNION
        SELECT client_id FROM devices
        WHERE last_seen_at >= ? AND last_seen_at <= ? AND client_id <> ''
      )
    `).get(onlineCutoff, generatedAt.toISOString(), onlineCutoff, generatedAt.toISOString()).total;
    const sourceIps = database.prepare(`
      SELECT source_ip AS name, COUNT(*) AS value
      FROM analytics_events
      WHERE ${filter.sql} AND source_ip <> ''
      GROUP BY source_ip
      ORDER BY value DESC, name ASC
    `).all(...filter.params).map((row) => ({ name: row.name, value: Number(row.value) }));
    const configs = database.prepare(`
      SELECT
        CAST(json_extract(payload_json, '$.config_key') AS TEXT) AS key,
        CAST(json_extract(payload_json, '$.config_value') AS TEXT) AS value,
        COUNT(*) AS count
      FROM analytics_events
      WHERE ${filter.sql} AND event_type = 'config_usage'
        AND COALESCE(json_extract(payload_json, '$.config_key'), json_extract(payload_json, '$.config_value')) IS NOT NULL
      GROUP BY key, value
      ORDER BY count DESC, key ASC, value ASC
    `).all(...filter.params).map((row) => ({ key: row.key || '', value: row.value || '', count: Number(row.count) }));
    const models = database.prepare(`
      SELECT
        COALESCE(CAST(json_extract(payload_json, '$.ai_model_provider') AS TEXT), '') AS provider,
        COALESCE(CAST(json_extract(payload_json, '$.ai_model_base_url') AS TEXT), '') AS endpoint,
        COALESCE(CAST(json_extract(payload_json, '$.ai_model_name') AS TEXT), '') AS model,
        COUNT(*) AS requests,
        COALESCE(SUM(CAST(json_extract(payload_json, '$.total_tokens') AS INTEGER)), 0) AS totalTokens
      FROM analytics_events
      WHERE ${filter.sql} AND event_type = 'ai_request'
      GROUP BY provider, endpoint, model
      ORDER BY requests DESC, provider ASC, model ASC
    `).all(...filter.params).map((row) => ({ ...row, requests: Number(row.requests), totalTokens: Number(row.totalTokens) }));
    const dailyActive = database.prepare(`
      SELECT
        strftime('%Y-%m-%d', datetime(occurred_at, '+8 hours')) AS date,
        COUNT(DISTINCT NULLIF(client_id, '')) AS clients,
        COUNT(*) AS events
      FROM analytics_events
      WHERE ${filter.sql}
      GROUP BY date
      ORDER BY date ASC
    `).all(...filter.params).map((row) => ({ date: row.date, clients: Number(row.clients), events: Number(row.events) }));
    const recentEvents = database.prepare(`
      SELECT event_id, event_type, client_id, employee_id, device_id, source_ip, occurred_at, payload_json
      FROM analytics_events
      WHERE ${filter.sql}
      ORDER BY occurred_at DESC
      LIMIT 100
    `).all(...filter.params).map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      clientId: row.client_id,
      employeeId: row.employee_id,
      deviceId: row.device_id,
      sourceIp: row.source_ip,
      occurredAt: row.occurred_at,
      payload: parsePayload(row.payload_json),
    }));

    return {
      range: normalizedRange,
      generatedAt: generatedAt.toISOString(),
      summary: {
        totalClients: Number(totalClients),
        newClients: Number(newClients),
        activeClients: Number(summary.activeClients),
        onlineClients: Number(onlineClients),
        totalEvents: Number(summary.totalEvents),
        aiRequests: Number(summary.aiRequests),
        promptTokens: Number(summary.promptTokens),
        completionTokens: Number(summary.completionTokens),
        totalTokens: Number(summary.totalTokens),
        agentSuccess: Number(summary.agentSuccess),
        agentFailed: Number(summary.agentFailed),
        agentRetries: Number(summary.agentRetries),
      },
      versions: groupPayloadField(normalizedRange, 'version', 'app_open'),
      platforms: groupPayloadField(normalizedRange, 'platform'),
      architectures: groupPayloadField(normalizedRange, 'arch'),
      sourceIps,
      pages: groupPayloadField(normalizedRange, 'page', 'page_view'),
      configs,
      resources: groupPayloadField(normalizedRange, 'resource_key', 'resource_click'),
      models,
      licenseStatuses: groupPayloadField(normalizedRange, 'license_status'),
      dailyActive,
      authorization: {
        employees: database.prepare('SELECT COUNT(*) AS total FROM employees').get().total,
        activeDevices: database.prepare("SELECT COUNT(*) AS total FROM devices WHERE status = 'ACTIVE'").get().total,
        activeLicenses: database.prepare("SELECT COUNT(*) AS total FROM licenses WHERE status = 'ACTIVE' AND expires_at > ?").get(generatedAt.toISOString()).total,
        revokedLicenses: database.prepare("SELECT COUNT(*) AS total FROM licenses WHERE status = 'REVOKED'").get().total,
      },
      recentEvents,
    };
  }

  function cleanupOlderThanMonths(months = 24) {
    const cutoff = new Date(now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - Math.max(1, Number(months) || 24));
    return database.prepare('DELETE FROM analytics_events WHERE occurred_at < ?').run(cutoff.toISOString()).changes;
  }

  return { cleanupOlderThanMonths, getDashboard };
}

module.exports = { createAnalyticsQueryService, getBeijingDayStart, resolveRange };
