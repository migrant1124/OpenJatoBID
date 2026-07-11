const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLicenseService, serializeLicensePayload } = require('./licenseService.cjs');

function createIssuer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKey,
    sign(payload) {
      return {
        algorithm: 'ECDSA_P256_SHA256',
        issuerId: 'issuer-1',
        publicKey,
        payload,
        signature: crypto.sign('sha256', Buffer.from(serializeLicensePayload(payload)), privateKey).toString('base64'),
      };
    },
  };
}

function createFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-license-'));
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  let remoteResult = null;
  let remoteError = null;
  let verifyCalls = 0;
  let config = {
    analytics_client_id: 'client-1',
    analytics_created_at: '2026-07-10',
    lan_management: {
      server_address: '192.168.10.8', employee_name: '', employee_phone: '',
      management_public_key: '', application_id: '',
    },
  };
  const configStore = {
    load: () => structuredClone(config),
    save: (next) => {
      config = { ...config, ...next, lan_management: { ...config.lan_management, ...next.lan_management } };
      return { success: true };
    },
  };
  const client = {
    login: async () => { if (remoteError) throw remoteError; return remoteResult; },
    verify: async () => { verifyCalls += 1; if (remoteError) throw remoteError; return remoteResult; },
    health: async () => ({ status: 'ok' }),
    submitApplication: async (input) => ({ id: 'application-1', status: 'PENDING', ...input }),
    getApplication: async () => remoteResult,
  };
  const service = createLicenseService({
    app: { isPackaged: true, getPath: () => userData },
    configStore,
    now: () => new Date(nowMs),
    machineFingerprintFactory: () => 'fingerprint-1',
    lanClientFactory: () => client,
    debugLicenseDisabled: false,
  });
  return {
    service,
    issuer: createIssuer(),
    getConfig: () => config,
    getVerifyCalls: () => verifyCalls,
    setRemoteResult: (value) => { remoteResult = value; remoteError = null; },
    setRemoteError: (error) => { remoteError = error; },
    advanceDays: (days) => { nowMs += days * 24 * 60 * 60 * 1000; },
    close: () => fs.rmSync(userData, { recursive: true, force: true }),
  };
}

function activePayload(overrides = {}) {
  return {
    licenseId: 'license-1', employeeId: 'employee-1', deviceId: 'device-1',
    name: '张三', phone: '13800138000', deviceFingerprint: 'fingerprint-1', clientId: 'client-1',
    platform: process.platform, arch: process.arch,
    issuedAt: '2026-07-10T00:00:00.000Z', expiresAt: '2027-07-10T00:00:00.000Z',
    verifiedAt: '2026-07-10T00:00:00.000Z', offlineValidUntil: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

test('logs in through the LAN manager, pins its public key, and saves a local signed license', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });

  const status = await fixture.service.login({ name: '张三', phone: '13800138000' });

  assert.equal(status.status, 'active');
  assert.equal(status.offline, false);
  assert.equal(fixture.getConfig().lan_management.management_public_key, fixture.issuer.publicKey);
  assert.equal((await fixture.service.getStatus()).status, 'active');
  fixture.close();
});

test('allows local login during the thirty-day window but pauses after the deadline', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });
  await fixture.service.login({ name: '张三', phone: '13800138000' });
  fixture.setRemoteError(new Error('LAN_SERVER_UNREACHABLE'));
  fixture.advanceDays(29);

  assert.equal((await fixture.service.login({ name: '张三', phone: '13800138000' })).status, 'active');
  fixture.advanceDays(2);
  assert.equal((await fixture.service.login({ name: '张三', phone: '13800138000' })).status, 'offline_expired');
  fixture.close();
});

test('records a server revocation immediately and refuses later offline login', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });
  await fixture.service.login({ name: '张三', phone: '13800138000' });
  fixture.setRemoteResult({ status: 'REVOKED' });

  assert.equal((await fixture.service.login({ name: '张三', phone: '13800138000' })).status, 'revoked');
  fixture.setRemoteError(new Error('LAN_SERVER_UNREACHABLE'));
  assert.equal((await fixture.service.login({ name: '张三', phone: '13800138000' })).status, 'revoked');
  fixture.close();
});

test('rejects a different management public key after first trust is established', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });
  await fixture.service.login({ name: '张三', phone: '13800138000' });
  const secondIssuer = createIssuer();
  fixture.setRemoteResult({ status: 'ACTIVE', license: secondIssuer.sign(activePayload()) });

  assert.equal((await fixture.service.login({ name: '张三', phone: '13800138000' })).status, 'invalid');
  assert.equal(fixture.getConfig().lan_management.management_public_key, fixture.issuer.publicKey);
  fixture.close();
});

test('coalesces concurrent lifecycle verification requests', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });
  await fixture.service.login({ name: '张三', phone: '13800138000' });

  await Promise.all([fixture.service.verify(), fixture.service.verify()]);

  assert.equal(fixture.getVerifyCalls(), 1);
  fixture.close();
});
