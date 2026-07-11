const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLanServerAddress } = require('./lanServerAddress.cjs');

test('adds the default management port to a plain LAN IP', () => {
  assert.deepEqual(normalizeLanServerAddress(' 192.168.10.8 '), {
    host: '192.168.10.8',
    port: 47821,
    baseUrl: 'http://192.168.10.8:47821',
    serverAddress: '192.168.10.8',
  });
});

test('preserves an explicitly configured port', () => {
  assert.deepEqual(normalizeLanServerAddress('192.168.10.8:5000'), {
    host: '192.168.10.8',
    port: 5000,
    baseUrl: 'http://192.168.10.8:5000',
    serverAddress: '192.168.10.8:5000',
  });
});

test('rejects paths, credentials, public protocols, and invalid ports', () => {
  for (const value of ['https://192.168.10.8', 'http://user@192.168.10.8', '192.168.10.8/path', '192.168.10.8:99999', '']) {
    assert.throws(() => normalizeLanServerAddress(value), /INVALID_LAN_SERVER_ADDRESS/);
  }
});
