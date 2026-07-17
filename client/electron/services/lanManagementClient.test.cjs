const test = require('node:test');
const assert = require('node:assert/strict');
const { createLanManagementClient } = require('./lanManagementClient.cjs');

test('sends authorization requests only to the configured LAN management address', async () => {
  const requests = [];
  const client = createLanManagementClient({
    serverAddress: '192.168.10.8:5000',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { id: 'application-1', status: 'PENDING' } }),
      };
    },
  });

  const result = await client.submitApplication({ name: '张三' });

  assert.deepEqual(result, { id: 'application-1', status: 'PENDING' });
  assert.equal(requests[0].url, 'http://192.168.10.8:5000/api/v1/authorization/applications');
  assert.equal(JSON.parse(requests[0].options.body).name, '张三');
});

test('maps network failures to a stable unreachable error', async () => {
  const client = createLanManagementClient({
    serverAddress: '192.168.10.8',
    fetchImpl: async () => { throw new Error('socket details must not escape'); },
  });

  await assert.rejects(() => client.health(), /LAN_SERVER_UNREACHABLE/);
});

test('subscribes to authorization SSE with a Bearer watch token and never puts credentials in the URL', async () => {
  const requests = [];
  const events = [];
  const encoder = new TextEncoder();
  const client = createLanManagementClient({
    serverAddress: '192.168.10.8:47821',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: revoked\n'));
            controller.enqueue(encoder.encode('data: {"status":"REVOKED","licenseId":"license-1","revokedAt":"2026-07-10T00:05:00.000Z"}\n\n'));
            controller.close();
          },
        }),
      };
    },
  });

  await client.watchAuthorization({
    watchToken: 'short-watch-token',
    onEvent: async (event) => events.push(event),
  });

  assert.equal(requests[0].url, 'http://192.168.10.8:47821/api/v1/authorization/watch');
  assert.equal(requests[0].url.includes('short-watch-token'), false);
  assert.equal(requests[0].options.headers.authorization, 'Bearer short-watch-token');
  assert.deepEqual(events, [{ status: 'REVOKED', licenseId: 'license-1', revokedAt: '2026-07-10T00:05:00.000Z' }]);
});

test('acknowledges a revocation with the short watch token in a POST body', async () => {
  const requests = [];
  const client = createLanManagementClient({
    serverAddress: '192.168.10.8:47821',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { acknowledged: true } }),
      };
    },
  });

  await client.acknowledgeRevocation({ watchToken: 'short-watch-token' });

  assert.equal(requests[0].url, 'http://192.168.10.8:47821/api/v1/authorization/revocations/ack');
  assert.deepEqual(JSON.parse(requests[0].options.body), { watchToken: 'short-watch-token' });
});
