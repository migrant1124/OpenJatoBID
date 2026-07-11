const crypto = require('node:crypto');
const { createLanManagementClient } = require('./lanManagementClient.cjs');

const SENSITIVE_EVENT_FIELDS = new Set([
  'api_key', 'prompt', 'user_input', 'input_text', 'output_text', 'document_content',
  'file_name', 'file_path', 'local_path', 'request_body', 'response_body',
]);

function sanitizeEventPayload(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([key]) => !SENSITIVE_EVENT_FIELDS.has(key)));
}

function createAnalyticsService({
  app,
  configStore,
  queueStore,
  lanClientFactory = (options) => createLanManagementClient(options),
  eventIdFactory = () => crypto.randomUUID(),
  now = () => new Date(),
}) {
  let flushPromise = null;

  function buildEvent(input) {
    const config = configStore.load();
    return {
      ...sanitizeEventPayload(input),
      eventId: input.eventId || eventIdFactory(),
      occurredAt: input.occurredAt || now().toISOString(),
      projectName: 'yibiao-client',
      version: input.version || app.getVersion?.() || '',
      platform: input.platform || process.platform,
      arch: input.arch || process.arch,
      client_id: config.analytics_client_id || '',
      client_created_at: config.analytics_created_at || '',
    };
  }

  async function performFlush() {
    const events = queueStore.list();
    if (!events.length) return { sent: 0, remaining: 0 };
    const config = configStore.load();
    const serverAddress = config.lan_management?.server_address;
    if (!serverAddress) return { sent: 0, remaining: events.length };
    try {
      const result = await lanClientFactory({ serverAddress }).submitAnalytics(events.slice(0, 200));
      const accepted = new Set(result.acceptedEventIds || []);
      const remaining = queueStore.list().filter((event) => !accepted.has(event.eventId));
      queueStore.replace(remaining);
      return { sent: accepted.size, remaining: remaining.length };
    } catch {
      return { sent: 0, remaining: events.length };
    }
  }

  function flush() {
    if (flushPromise) return flushPromise;
    flushPromise = performFlush().finally(() => { flushPromise = null; });
    return flushPromise;
  }

  async function track(input) {
    const event = buildEvent(input);
    queueStore.enqueue(event);
    await flush();
    return { success: true, eventId: event.eventId };
  }

  return { flush, track };
}

module.exports = { SENSITIVE_EVENT_FIELDS, createAnalyticsService, sanitizeEventPayload };
