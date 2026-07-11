const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAnalyticsQueueStore } = require('./analyticsQueueStore.cjs');

test('keeps a bounded queue and discards expired events', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-analytics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  const store = createAnalyticsQueueStore({
    filePath: path.join(directory, 'queue.json'),
    now: () => new Date(nowMs),
    maxEvents: 3,
    maxAgeMs: 2 * 24 * 60 * 60 * 1000,
  });
  for (let index = 1; index <= 4; index += 1) {
    store.enqueue({ eventId: `event-${index}`, occurredAt: new Date(nowMs).toISOString() });
  }
  assert.deepEqual(store.list().map((event) => event.eventId), ['event-2', 'event-3', 'event-4']);

  nowMs += 3 * 24 * 60 * 60 * 1000;
  assert.deepEqual(store.list(), []);
});
