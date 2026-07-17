const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEVICE_CODE_VERSION,
  createDeviceCode,
  createLicenseService,
  serializeLicensePayload,
} = require('./licenseService.cjs');
const { createDeviceBootstrapStore } = require('./deviceBootstrapStore.cjs');

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

function createFixture(options = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-license-'));
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  let remoteResult = null;
  let remoteError = null;
  let verifyCalls = 0;
  let loginCalls = 0;
  let applicationCalls = 0;
  let lastLoginInput = null;
  let lastVerifyInput = null;
  let lastApplicationInput = null;
  let bootstrap = options.bootstrap || null;
  let intervalCallback = null;
  let intervalMs = null;
  const statusEvents = [];
  let config = options.config || {
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
    login: async (input) => {
      loginCalls += 1;
      lastLoginInput = input;
      if (remoteError) throw remoteError;
      return remoteResult;
    },
    verify: async (input) => {
      verifyCalls += 1;
      lastVerifyInput = input;
      if (remoteError) throw remoteError;
      return remoteResult;
    },
    health: async () => ({ status: 'ok' }),
    submitApplication: async (input) => {
      applicationCalls += 1;
      lastApplicationInput = input;
      return { id: 'application-1', status: 'PENDING', ...input };
    },
    getApplication: async () => remoteResult,
    watchAuthorization: options.watchAuthorization || (async () => new Promise(() => {})),
    acknowledgeRevocation: options.acknowledgeRevocation || (async () => ({ acknowledged: true })),
  };
  const deviceBootstrapStore = {
    load: () => structuredClone(bootstrap),
    save: (value) => {
      bootstrap = { ...(bootstrap || {}), ...value };
      return structuredClone(bootstrap);
    },
  };
  const service = createLicenseService({
    app: { isPackaged: true, getPath: () => userData },
    configStore,
    now: () => new Date(nowMs),
    machineFingerprintFactory: () => 'fingerprint-1',
    deviceCodeFactory: () => 'device-code-1',
    deviceBootstrapStore,
    lanClientFactory: () => client,
    reconnectDelay: options.reconnectDelay || (() => new Promise(() => {})),
    setIntervalFn: (callback, milliseconds) => {
      intervalCallback = callback;
      intervalMs = milliseconds;
      return { unref() {} };
    },
    clearIntervalFn: () => {},
    debugLicenseDisabled: false,
  });
  service.onStatusChanged?.((status) => statusEvents.push(status));
  return {
    service,
    issuer: createIssuer(),
    getConfig: () => config,
    getBootstrap: () => bootstrap,
    getLastLoginInput: () => lastLoginInput,
    getLastVerifyInput: () => lastVerifyInput,
    getLastApplicationInput: () => lastApplicationInput,
    getLoginCalls: () => loginCalls,
    getApplicationCalls: () => applicationCalls,
    getStatusEvents: () => statusEvents,
    getIntervalMs: () => intervalMs,
    runPeriodicVerify: async () => intervalCallback?.(),
    getVerifyCalls: () => verifyCalls,
    setRemoteResult: (value) => { remoteResult = value; remoteError = null; },
    setRemoteError: (error) => { remoteError = error; },
    setBootstrap: (value) => { bootstrap = value; },
    advanceDays: (days) => { nowMs += days * 24 * 60 * 60 * 1000; },
    close: () => {
      service.close?.();
      fs.rmSync(userData, { recursive: true, force: true });
    },
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

function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('WAIT_TIMEOUT'));
      setImmediate(poll);
    };
    poll();
  });
}

test('builds a stable Device Code from the OS machine id without Client ID, MAC, or app version', () => {
  const base = {
    appId: 'com.jdt.jatoaibid',
    platform: 'win32',
    machineId: 'A1B2-C3D4',
    deviceCodeVersion: DEVICE_CODE_VERSION,
  };
  const first = createDeviceCode({ ...base, clientId: 'install-1', mac: '00:11:22:33:44:55', appVersion: '1.4.1' });
  const second = createDeviceCode({ ...base, clientId: 'install-2', mac: 'AA:BB:CC:DD:EE:FF', appVersion: '9.9.9' });

  assert.equal(first, second);
  assert.notEqual(first, createDeviceCode({ ...base, machineId: 'OTHER-MACHINE' }));
  assert.equal(createDeviceCode({ ...base, machineId: '' }), '');
});

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

test('validates new licenses by Device Code before the legacy fingerprint', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({
    status: 'ACTIVE',
    license: fixture.issuer.sign(activePayload({
      deviceCode: 'device-code-1',
      deviceCodeVersion: DEVICE_CODE_VERSION,
      deviceFingerprint: 'stale-fingerprint',
    })),
  });

  const status = await fixture.service.login({ name: '张三', phone: '13800138000' });

  assert.equal(status.status, 'active');
  assert.equal((await fixture.service.getStatus()).status, 'active');
  fixture.close();
});

test('keeps validating legacy licenses that only contain deviceFingerprint', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });

  await fixture.service.login({ name: '张三', phone: '13800138000' });

  assert.equal((await fixture.service.getStatus()).status, 'active');
  fixture.close();
});

test('sends both stable Device Code and legacy identifiers without using Client ID as the device identity', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({
    status: 'ACTIVE',
    license: fixture.issuer.sign(activePayload({ deviceCode: 'device-code-1', deviceCodeVersion: DEVICE_CODE_VERSION })),
  });

  await fixture.service.login({ name: '张三', phone: '13800138000' });
  await fixture.service.verify();

  assert.deepEqual(fixture.getLastLoginInput(), {
    name: '张三',
    phone: '13800138000',
    deviceCode: 'device-code-1',
    deviceCodeVersion: DEVICE_CODE_VERSION,
    deviceFingerprint: 'fingerprint-1',
    clientId: 'client-1',
  });
  assert.equal(fixture.getLastVerifyInput().deviceCode, 'device-code-1');
  assert.equal(fixture.getLastVerifyInput().deviceCodeVersion, DEVICE_CODE_VERSION);
  assert.equal(fixture.getLastVerifyInput().deviceFingerprint, 'fingerprint-1');
  fixture.close();
});

test('includes Device Code and legacy identifiers in authorization applications', async () => {
  const fixture = createFixture();

  await fixture.service.submitApplication({
    name: '张三',
    phone: '13800138000',
    serverAddress: '192.168.10.8:47821',
  });

  assert.equal(fixture.getLastApplicationInput().deviceCode, 'device-code-1');
  assert.equal(fixture.getLastApplicationInput().deviceCodeVersion, DEVICE_CODE_VERSION);
  assert.equal(fixture.getLastApplicationInput().deviceFingerprint, 'fingerprint-1');
  assert.equal(fixture.getLastApplicationInput().clientId, 'client-1');
  assert.equal(fixture.getBootstrap().serverAddress, '192.168.10.8:47821');
  fixture.close();
});

test('starts the real-time watch as soon as a pending application is approved', async () => {
  const watchTokens = [];
  const fixture = createFixture({
    config: {
      analytics_client_id: 'client-1',
      lan_management: {
        server_address: '192.168.10.8:47821',
        employee_name: '张三',
        employee_phone: '13800138000',
        management_public_key: '',
        application_id: 'application-1',
      },
    },
    watchAuthorization: async ({ watchToken }) => {
      watchTokens.push(watchToken);
      return new Promise(() => {});
    },
  });
  fixture.setRemoteResult({
    id: 'application-1',
    status: 'APPROVED',
    watchToken: 'application-watch-token',
    watchExpiresAt: '2026-07-10T00:10:00.000Z',
    license: fixture.issuer.sign(activePayload()),
  });

  const application = await fixture.service.getApplicationStatus();
  await waitFor(() => watchTokens.length === 1);

  assert.equal(application.runtimeStatus.status, 'active');
  assert.deepEqual(watchTokens, ['application-watch-token']);
  fixture.close();
});

test('restores the management address and pinned key from Bootstrap after reinstall and logs in without a new application', async () => {
  const fixture = createFixture({
    config: { analytics_client_id: 'new-install-client', lan_management: {} },
  });
  fixture.setBootstrap({
    serverAddress: '192.168.10.8:47821',
    managementPublicKey: fixture.issuer.publicKey,
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    license: fixture.issuer.sign(activePayload({
      clientId: 'old-install-client',
      deviceCode: 'device-code-1',
      deviceCodeVersion: DEVICE_CODE_VERSION,
    })),
  });

  const status = await fixture.service.login({ name: '张三', phone: '13800138000' });

  assert.equal(status.status, 'active');
  assert.equal(fixture.getLoginCalls(), 1);
  assert.equal(fixture.getApplicationCalls(), 0);
  assert.equal(fixture.getLastLoginInput().clientId, 'new-install-client');
  assert.equal(fixture.getConfig().lan_management.server_address, '192.168.10.8:47821');
  fixture.close();
});

test('uses a manually restored management address for normal login without opening an application flow', async () => {
  const fixture = createFixture({
    config: { analytics_client_id: 'new-install-client', lan_management: {} },
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    license: fixture.issuer.sign(activePayload({ deviceCode: 'device-code-1', deviceCodeVersion: DEVICE_CODE_VERSION })),
  });

  const status = await fixture.service.login({
    name: '张三',
    phone: '13800138000',
    serverAddress: '192.168.10.8:47821',
  });

  assert.equal(status.status, 'active');
  assert.equal(fixture.getApplicationCalls(), 0);
  assert.equal(fixture.getBootstrap().serverAddress, '192.168.10.8:47821');
  fixture.close();
});

test('refuses to replace a public key pinned in Bootstrap', async () => {
  const fixture = createFixture({
    config: { analytics_client_id: 'new-install-client', lan_management: {} },
  });
  const pinnedIssuer = createIssuer();
  fixture.setBootstrap({
    serverAddress: '192.168.10.8:47821',
    managementPublicKey: pinnedIssuer.publicKey,
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    license: fixture.issuer.sign(activePayload({ deviceCode: 'device-code-1', deviceCodeVersion: DEVICE_CODE_VERSION })),
  });

  const status = await fixture.service.login({ name: '张三', phone: '13800138000' });

  assert.equal(status.status, 'invalid');
  assert.equal(status.untrustedReason, 'management_public_key_changed');
  assert.equal(fixture.getBootstrap().managementPublicKey, pinnedIssuer.publicKey);
  fixture.close();
});

test('treats conflicting user-config and Bootstrap public keys as a trust failure', async () => {
  const configuredIssuer = createIssuer();
  const bootstrapIssuer = createIssuer();
  const fixture = createFixture({
    config: {
      analytics_client_id: 'client-1',
      lan_management: {
        server_address: '192.168.10.8:47821',
        management_public_key: configuredIssuer.publicKey,
      },
    },
    bootstrap: {
      serverAddress: '192.168.10.8:47821',
      managementPublicKey: bootstrapIssuer.publicKey,
    },
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    license: configuredIssuer.sign(activePayload({ deviceCode: 'device-code-1', deviceCodeVersion: DEVICE_CODE_VERSION })),
  });

  const status = await fixture.service.login({ name: '张三', phone: '13800138000' });

  assert.equal(status.status, 'invalid');
  assert.equal(status.untrustedReason, 'management_public_key_changed');
  assert.equal(fixture.getBootstrap().managementPublicKey, bootstrapIssuer.publicKey);
  fixture.close();
});

for (const invalidStatus of ['REVOKED', 'NOT_AUTHORIZED']) {
  test(`persists ${invalidStatus} in the local License and never falls back to offline authorization`, async () => {
    const fixture = createFixture();
    fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });
    await fixture.service.login({ name: '张三', phone: '13800138000' });
    const licenseFile = fixture.service.getLicenseFilePath();
    fixture.setRemoteResult({ status: invalidStatus });

    const remoteStatus = await fixture.service.login({ name: '张三', phone: '13800138000' });
    const stored = JSON.parse(fs.readFileSync(licenseFile, 'utf8'));
    fixture.setRemoteError(new Error('LAN_SERVER_UNREACHABLE'));
    const offlineStatus = await fixture.service.login({ name: '张三', phone: '13800138000' });

    assert.equal(remoteStatus.status, invalidStatus === 'REVOKED' ? 'revoked' : 'not_authorized');
    assert.equal(stored.local.serverStatus, invalidStatus);
    assert.match(stored.local.serverConfirmedAt, /^2026-07-10T/);
    assert.equal(fs.existsSync(licenseFile), true);
    assert.equal(offlineStatus.status, remoteStatus.status);
    fixture.close();
  });
}

test('handles an SSE revocation immediately, persists it, acknowledges it, and emits an unauthorized status', async () => {
  let acknowledged = null;
  const fixture = createFixture({
    watchAuthorization: async ({ watchToken, onEvent }) => {
      assert.equal(watchToken, 'watch-1');
      await onEvent({ status: 'REVOKED', licenseId: 'license-1', revokedAt: '2026-07-10T00:05:00.000Z' });
    },
    acknowledgeRevocation: async (input) => { acknowledged = input; return { acknowledged: true }; },
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    watchToken: 'watch-1',
    watchExpiresAt: '2026-07-10T00:10:00.000Z',
    license: fixture.issuer.sign(activePayload()),
  });

  await fixture.service.login({ name: '张三', phone: '13800138000' });
  await waitFor(() => fixture.getStatusEvents().some((status) => status.status === 'revoked'));

  assert.deepEqual(acknowledged, { watchToken: 'watch-1' });
  assert.equal((await fixture.service.getStatus()).status, 'revoked');
  fixture.close();
});

test('emits an SSE revocation without waiting for an acknowledgement request that never settles', async () => {
  const fixture = createFixture({
    watchAuthorization: async ({ onEvent }) => {
      await onEvent({ status: 'REVOKED', licenseId: 'license-1', revokedAt: '2026-07-10T00:05:00.000Z' });
    },
    acknowledgeRevocation: async () => new Promise(() => {}),
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    watchToken: 'watch-1',
    license: fixture.issuer.sign(activePayload()),
  });

  try {
    await fixture.service.login({ name: '张三', phone: '13800138000' });
    await waitFor(() => fixture.getStatusEvents().some((status) => status.status === 'revoked'), 100);
    assert.equal((await fixture.service.getStatus()).status, 'revoked');
  } finally {
    fixture.close();
  }
});

test('verifies immediately before reconnecting a disconnected real-time watch', async () => {
  let watchCalls = 0;
  const watchTokens = [];
  let fixture;
  fixture = createFixture({
    reconnectDelay: async () => {},
    watchAuthorization: async ({ watchToken }) => {
      watchCalls += 1;
      watchTokens.push(watchToken);
      if (watchCalls === 1) {
        fixture.setRemoteResult({
          status: 'ACTIVE',
          watchToken: 'watch-2',
          license: fixture.issuer.sign(activePayload()),
        });
        throw new Error('LAN_SERVER_UNREACHABLE');
      }
      return new Promise(() => {});
    },
  });
  fixture.setRemoteResult({
    status: 'ACTIVE',
    watchToken: 'watch-1',
    license: fixture.issuer.sign(activePayload()),
  });

  await fixture.service.login({ name: '张三', phone: '13800138000' });
  await waitFor(() => watchCalls === 2);

  assert.equal(fixture.getVerifyCalls(), 1);
  assert.deepEqual(watchTokens, ['watch-1', 'watch-2']);
  fixture.close();
});

test('keeps the thirty-minute verification interval as a fallback', async () => {
  const fixture = createFixture();
  fixture.setRemoteResult({ status: 'ACTIVE', license: fixture.issuer.sign(activePayload()) });
  await fixture.service.login({ name: '张三', phone: '13800138000' });
  fixture.service.startLifecycle();
  fixture.setRemoteResult({ status: 'REVOKED' });

  await fixture.runPeriodicVerify();

  assert.equal(fixture.getIntervalMs(), 30 * 60 * 1000);
  assert.equal((await fixture.service.getStatus()).status, 'revoked');
  fixture.close();
});

test('restores a reinstalled client through a real temporary Bootstrap file after user config and License are deleted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-reinstall-'));
  const userData = path.join(root, 'userData');
  const configFile = path.join(userData, 'user_config.json');
  const bootstrapFile = path.join(root, 'fixed-bootstrap', 'bootstrap.json');
  const bootstrapStore = createDeviceBootstrapStore({
    filePath: bootstrapFile,
    now: () => new Date('2026-07-10T00:00:00.000Z'),
  });
  const issuer = createIssuer();
  let fallbackClientId = 'client-before-reinstall';
  let lastLoginInput = null;
  let applicationCalls = 0;
  const remoteResult = {
    status: 'ACTIVE',
    license: issuer.sign(activePayload({
      clientId: 'client-before-reinstall',
      deviceCode: 'stable-device-code',
      deviceCodeVersion: DEVICE_CODE_VERSION,
    })),
  };
  const configStore = {
    load() {
      try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch {
        return { analytics_client_id: fallbackClientId, lan_management: {} };
      }
    },
    save(value) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      return { success: true };
    },
  };
  const client = {
    login: async (input) => { lastLoginInput = input; return remoteResult; },
    submitApplication: async () => { applicationCalls += 1; return { id: 'unexpected' }; },
    verify: async () => remoteResult,
  };
  const createService = () => createLicenseService({
    app: { isPackaged: true, getPath: () => userData },
    configStore,
    machineFingerprintFactory: ({ clientId }) => `fingerprint-${clientId}`,
    deviceCodeFactory: () => 'stable-device-code',
    deviceBootstrapStore: bootstrapStore,
    lanClientFactory: () => client,
    reconnectDelay: () => new Promise(() => {}),
    debugLicenseDisabled: false,
  });

  try {
    const firstService = createService();
    assert.equal((await firstService.login({
      name: '张三',
      phone: '13800138000',
      serverAddress: '192.168.10.8:47821',
    })).status, 'active');
    const licenseFile = firstService.getLicenseFilePath();
    firstService.close();
    assert.equal(fs.existsSync(configFile), true);
    assert.equal(fs.existsSync(licenseFile), true);
    assert.equal(fs.existsSync(bootstrapFile), true);

    fs.rmSync(configFile, { force: true });
    fs.rmSync(licenseFile, { force: true });
    fallbackClientId = 'client-after-reinstall';

    const reinstalledService = createService();
    const restoredStatus = await reinstalledService.login({ name: '张三', phone: '13800138000' });

    assert.equal(restoredStatus.status, 'active');
    assert.equal(lastLoginInput.clientId, 'client-after-reinstall');
    assert.equal(lastLoginInput.deviceCode, 'stable-device-code');
    assert.equal(applicationCalls, 0);
    assert.equal(fs.existsSync(reinstalledService.getLicenseFilePath()), true);
    assert.equal(bootstrapStore.load().managementPublicKey, issuer.publicKey);
    reinstalledService.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
