const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalyticsService } = require('./analyticsService.cjs');

function createQueueStore() {
  let events = [];
  return {
    enqueue: (event) => { events.push(event); },
    list: () => [...events],
    replace: (next) => { events = [...next]; },
  };
}

test('queues an event locally when no LAN server has been configured', async () => {
  const queueStore = createQueueStore();
  const service = createAnalyticsService({
    app: { getVersion: () => '1.0.0' },
    configStore: { load: () => ({ analytics_client_id: 'client-1', analytics_created_at: '2026-07-10', lan_management: {} }) },
    queueStore,
    eventIdFactory: () => 'event-1',
    now: () => new Date('2026-07-10T00:00:00.000Z'),
  });

  await service.track({ event: 'app_open' });

  assert.equal(queueStore.list().length, 1);
  assert.equal(queueStore.list()[0].eventId, 'event-1');
  assert.equal(queueStore.list()[0].client_id, 'client-1');
});

test('flushes queued events to the configured LAN manager and removes accepted ids', async () => {
  const queueStore = createQueueStore();
  const batches = [];
  const service = createAnalyticsService({
    app: { getVersion: () => '1.0.0' },
    configStore: { load: () => ({ analytics_client_id: 'client-1', analytics_created_at: '2026-07-10', lan_management: { server_address: '192.168.10.8' } }) },
    queueStore,
    eventIdFactory: () => 'event-1',
    lanClientFactory: () => ({
      submitAnalytics: async (events) => {
        batches.push(events);
        return { acceptedEventIds: events.map((event) => event.eventId) };
      },
    }),
  });

  await service.track({ event: 'page_view', page: 'bid-generation' });

  assert.equal(batches.length, 1);
  assert.equal(batches[0][0].event, 'page_view');
  assert.deepEqual(queueStore.list(), []);
});
