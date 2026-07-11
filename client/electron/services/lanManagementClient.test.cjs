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
