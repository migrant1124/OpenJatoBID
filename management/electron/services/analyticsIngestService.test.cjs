const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabaseService } = require('./databaseService.cjs');
const { createAnalyticsIngestService } = require('./analyticsIngestService.cjs');

function createFixture() {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const database = databaseService.database;
  database.prepare(`
    INSERT INTO employees (id, name, phone, normalized_name, normalized_phone, created_at, updated_at)
    VALUES ('employee-1', '张三', '13800138000', '张三', '13800138000', ?, ?)
  `).run('2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z');
  database.prepare(`
    INSERT INTO devices (id, employee_id, device_fingerprint, client_id, platform, arch, status, created_at, updated_at)
    VALUES ('device-1', 'employee-1', 'fingerprint-1', 'client-1', 'win32', 'x64', 'ACTIVE', ?, ?)
  `).run('2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z');
  return { databaseService, database };
}

test('stores allowlisted analytics fields, source IP and authorized device identity', () => {
  const fixture = createFixture();
  const service = createAnalyticsIngestService({
    database: fixture.database,
    now: () => new Date('2026-07-10T02:00:00.000Z'),
  });

  const result = service.ingest({
    sourceIp: '::ffff:192.168.1.18',
    events: [{
      eventId: 'event-1',
      event: 'ai_request',
      occurredAt: '2026-07-10T01:59:00.000Z',
      client_id: 'client-1',
      version: '1.0.0',
      ai_request_type: 'text',
      ai_model_provider: 'jinlong',
      total_tokens: 128,
      prompt: '不得入库',
      api_key: 'secret',
      file_path: 'D:/secret.docx',
    }],
  });

  assert.deepEqual(result.acceptedEventIds, ['event-1']);
  const stored = fixture.database.prepare('SELECT * FROM analytics_events WHERE event_id = ?').get('event-1');
  const payload = JSON.parse(stored.payload_json);
  assert.equal(stored.event_type, 'ai_request');
  assert.equal(stored.employee_id, 'employee-1');
  assert.equal(stored.device_id, 'device-1');
  assert.equal(stored.source_ip, '192.168.1.18');
  assert.equal(payload.total_tokens, 128);
  assert.equal(Object.hasOwn(payload, 'prompt'), false);
  assert.equal(Object.hasOwn(payload, 'api_key'), false);
  assert.equal(Object.hasOwn(payload, 'file_path'), false);
  fixture.databaseService.close();
});

test('deduplicates event IDs while acknowledging safe retries', () => {
  const fixture = createFixture();
  const service = createAnalyticsIngestService({ database: fixture.database });
  const event = { eventId: 'event-1', event: 'app_open', client_id: 'client-1' };

  assert.deepEqual(service.ingest({ sourceIp: '192.168.1.18', events: [event] }).acceptedEventIds, ['event-1']);
  assert.deepEqual(service.ingest({ sourceIp: '192.168.1.18', events: [event] }).acceptedEventIds, ['event-1']);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS total FROM analytics_events').get().total, 1);
  fixture.databaseService.close();
});

test('rejects malformed batches and invalid event identities', () => {
  const fixture = createFixture();
  const service = createAnalyticsIngestService({ database: fixture.database });

  assert.throws(() => service.ingest({ events: 'bad' }), /INVALID_ANALYTICS_BATCH/);
  assert.deepEqual(service.ingest({ events: [{ event: 'app_open' }, { eventId: '2' }] }).acceptedEventIds, []);
  fixture.databaseService.close();
});

test('automatically keeps only the latest twenty-four months of analytics', () => {
  const fixture = createFixture();
  fixture.database.prepare(`
    INSERT INTO analytics_events (
      event_id, event_type, client_id, employee_id, device_id, source_ip,
      occurred_at, received_at, payload_json
    ) VALUES ('expired-event', 'app_open', 'client-1', NULL, NULL, '', ?, ?, '{}')
  `).run('2024-06-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z');
  const service = createAnalyticsIngestService({
    database: fixture.database,
    now: () => new Date('2026-07-10T02:00:00.000Z'),
  });

  service.ingest({ events: [{ eventId: 'current-event', event: 'app_open', client_id: 'client-1' }] });

  assert.deepEqual(
    fixture.database.prepare('SELECT event_id FROM analytics_events ORDER BY event_id').all(),
    [{ event_id: 'current-event' }],
  );
  fixture.databaseService.close();
});
