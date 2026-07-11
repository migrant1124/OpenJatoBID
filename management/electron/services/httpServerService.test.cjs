const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpRouter } = require('./httpRouter.cjs');
const { createHttpServerService } = require('./httpServerService.cjs');

test('serves a versioned health response with consistent JSON headers', async () => {
  const router = createHttpRouter({
    getServiceInfo: () => ({ managementVersion: '1.0.0' }),
    now: () => new Date('2026-07-10T00:00:00.000Z'),
  });
  const server = createHttpServerService({ router });
  const address = await server.start({ host: '127.0.0.1', port: 0 });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(body, {
    data: { status: 'ok', apiVersion: 'v1', managementVersion: '1.0.0', serverTime: '2026-07-10T00:00:00.000Z' },
  });
  await server.stop();
});

test('returns the shared API error shape for an unknown route', async () => {
  const server = createHttpServerService({ router: createHttpRouter({ getServiceInfo: () => ({}) }) });
  const address = await server.start({ host: '127.0.0.1', port: 0 });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/missing`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: '请求的接口不存在' },
  });
  await server.stop();
});

test('accepts a valid authorization application and rejects invalid phone input at the boundary', async () => {
  const authorizationService = {
    submitApplication: (input) => ({ id: 'application-1', status: 'PENDING', ...input }),
  };
  const router = createHttpRouter({ getServiceInfo: () => ({}), authorizationService });
  const server = createHttpServerService({ router });
  const address = await server.start({ host: '127.0.0.1', port: 0 });
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/authorization/applications`;

  const validResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '张三', phone: '13800138000', deviceFingerprint: 'fingerprint-1',
      clientId: 'client-1', platform: 'win32', arch: 'x64',
    }),
  });
  const invalidResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '张三', phone: '123', deviceFingerprint: 'fingerprint-1',
      clientId: 'client-1', platform: 'win32', arch: 'x64',
    }),
  });

  assert.equal(validResponse.status, 201);
  assert.equal((await validResponse.json()).data.status, 'PENDING');
  assert.equal(invalidResponse.status, 422);
  assert.equal((await invalidResponse.json()).error.code, 'VALIDATION_ERROR');
  await server.stop();
});

test('accepts a bounded analytics batch and forwards the LAN source IP', async () => {
  let received = null;
  const analyticsIngestService = {
    ingest(input) {
      received = input;
      return { acceptedEventIds: input.events.map((event) => event.eventId) };
    },
  };
  const server = createHttpServerService({
    router: createHttpRouter({ getServiceInfo: () => ({}), analyticsIngestService }),
  });
  const address = await server.start({ host: '127.0.0.1', port: 0 });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events: [{ eventId: 'event-1', event: 'app_open' }] }),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { data: { acceptedEventIds: ['event-1'] } });
  assert.equal(received.sourceIp, '127.0.0.1');
  await server.stop();
});
