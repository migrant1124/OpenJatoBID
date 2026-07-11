const ALLOWED_EVENT_TYPES = new Set([
  'app_open',
  'page_view',
  'config_usage',
  'resource_click',
  'ai_request',
  'agent_runtime',
]);

const ALLOWED_PAYLOAD_FIELDS = new Set([
  'projectName', 'version', 'platform', 'arch', 'client_created_at', 'page',
  'license_status', 'license_plan', 'license_expires_at', 'source_trusted', 'untrusted_reason',
  'config_key', 'config_value', 'resource_key',
  'ai_request_type', 'ai_model_provider', 'ai_model_base_url', 'ai_model_name',
  'prompt_tokens', 'completion_tokens', 'total_tokens', 'text_model_name', 'image_model_name',
  'agent_runtime_status', 'agent_runtime_retry_count',
]);

function normalizeSourceIp(value) {
  const text = String(value || '').trim();
  return text.startsWith('::ffff:') ? text.slice(7) : text;
}

function sanitizePayload(event) {
  const payload = {};
  for (const [key, value] of Object.entries(event || {})) {
    if (!ALLOWED_PAYLOAD_FIELDS.has(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) continue;
    payload[key] = typeof value === 'string' ? value.slice(0, 256) : value;
  }
  return payload;
}

function normalizeEvent(event, now) {
  const eventId = String(event?.eventId || '').trim();
  const eventType = String(event?.event || '').trim();
  if (!eventId || eventId.length > 128 || !ALLOWED_EVENT_TYPES.has(eventType)) return null;
  const clientId = String(event?.client_id || '').trim().slice(0, 128);
  const occurredAtValue = Date.parse(String(event?.occurredAt || ''));
  return {
    eventId,
    eventType,
    clientId,
    occurredAt: Number.isFinite(occurredAtValue) ? new Date(occurredAtValue).toISOString() : now.toISOString(),
    payload: sanitizePayload(event),
  };
}

function createAnalyticsIngestService({ database, now = () => new Date() }) {
  const findDevice = database.prepare(`
    SELECT id, employee_id FROM devices
    WHERE client_id = ?
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  `);
  const insertEvent = database.prepare(`
    INSERT OR IGNORE INTO analytics_events (
      event_id, event_type, client_id, employee_id, device_id, source_ip,
      occurred_at, received_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteExpiredEvents = database.prepare('DELETE FROM analytics_events WHERE occurred_at < ?');

  const insertBatch = database.transaction((events, sourceIp, receivedAt) => {
    const retentionCutoff = new Date(receivedAt);
    retentionCutoff.setUTCMonth(retentionCutoff.getUTCMonth() - 24);
    deleteExpiredEvents.run(retentionCutoff.toISOString());
    const acceptedEventIds = [];
    for (const rawEvent of events.slice(0, 200)) {
      const event = normalizeEvent(rawEvent, new Date(receivedAt));
      if (!event) continue;
      const device = event.clientId ? findDevice.get(event.clientId) : null;
      insertEvent.run(
        event.eventId,
        event.eventType,
        event.clientId,
        device?.employee_id || null,
        device?.id || null,
        sourceIp,
        event.occurredAt,
        receivedAt,
        JSON.stringify(event.payload),
      );
      acceptedEventIds.push(event.eventId);
    }
    return { acceptedEventIds };
  });

  function ingest({ events, sourceIp = '' } = {}) {
    if (!Array.isArray(events)) throw new Error('INVALID_ANALYTICS_BATCH');
    return insertBatch(events, normalizeSourceIp(sourceIp), now().toISOString());
  }

  return { ingest };
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  ALLOWED_PAYLOAD_FIELDS,
  createAnalyticsIngestService,
  normalizeSourceIp,
  sanitizePayload,
};
