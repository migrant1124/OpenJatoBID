const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabaseService } = require('./databaseService.cjs');
const { createAnalyticsIngestService } = require('./analyticsIngestService.cjs');
const { createAnalyticsQueryService } = require('./analyticsQueryService.cjs');

test('aggregates Beijing-day activity, AI usage, agents and distributions', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  let nowMs = Date.parse('2026-07-10T04:00:00.000Z');
  const ingest = createAnalyticsIngestService({ database: databaseService.database, now: () => new Date(nowMs) });
  const query = createAnalyticsQueryService({ database: databaseService.database, now: () => new Date(nowMs) });

  ingest.ingest({ sourceIp: '10.0.0.8', events: [
    { eventId: 'before-today', event: 'app_open', client_id: 'older-client', occurredAt: '2026-07-09T15:59:59.000Z', version: '0.9.0' },
    { eventId: 'open-1', event: 'app_open', client_id: 'client-1', occurredAt: '2026-07-09T16:00:00.000Z', version: '1.0.0', platform: 'win32', arch: 'x64' },
    { eventId: 'ai-1', event: 'ai_request', client_id: 'client-1', occurredAt: '2026-07-10T03:55:00.000Z', ai_request_type: 'text', ai_model_provider: 'jinlong', ai_model_base_url: 'api.example.com', ai_model_name: 'gpt-test', prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
    { eventId: 'agent-1', event: 'agent_runtime', client_id: 'client-2', occurredAt: '2026-07-10T03:58:00.000Z', agent_runtime_status: 'success', agent_runtime_retry_count: 1 },
    { eventId: 'page-1', event: 'page_view', client_id: 'client-1', occurredAt: '2026-07-10T03:59:00.000Z', page: 'settings' },
  ] });

  const result = query.getDashboard('today');

  assert.deepEqual(result.summary, {
    totalClients: 3,
    newClients: 2,
    activeClients: 2,
    onlineClients: 2,
    totalEvents: 4,
    aiRequests: 1,
    promptTokens: 20,
    completionTokens: 30,
    totalTokens: 50,
    agentSuccess: 1,
    agentFailed: 0,
    agentRetries: 1,
  });
  assert.deepEqual(result.versions, [{ name: '1.0.0', value: 1 }]);
  assert.deepEqual(result.pages, [{ name: 'settings', value: 1 }]);
  assert.equal(result.models[0].provider, 'jinlong');
  assert.deepEqual(result.dailyActive, [{ date: '2026-07-10', clients: 2, events: 4 }]);
  assert.equal(result.recentEvents.length, 4);
  databaseService.close();
});

test('supports all-history range and manual retention cleanup', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const now = () => new Date('2026-07-10T04:00:00.000Z');
  const ingest = createAnalyticsIngestService({ database: databaseService.database, now });
  const query = createAnalyticsQueryService({ database: databaseService.database, now });
  ingest.ingest({ sourceIp: '10.0.0.8', events: [
    { eventId: 'old', event: 'app_open', client_id: 'old-client', occurredAt: '2024-06-01T00:00:00.000Z' },
    { eventId: 'new', event: 'app_open', client_id: 'new-client', occurredAt: '2026-07-10T00:00:00.000Z' },
  ] });

  assert.equal(query.getDashboard('all').summary.totalEvents, 2);
  assert.equal(query.cleanupOlderThanMonths(24), 1);
  assert.equal(query.getDashboard('all').summary.totalEvents, 1);
  databaseService.close();
});
