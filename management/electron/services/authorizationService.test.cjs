const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabaseService } = require('./databaseService.cjs');
const { MIGRATIONS } = require('./migrations.cjs');
const { createSigningService } = require('./signingService.cjs');
const { createAuthorizationService } = require('./authorizationService.cjs');

function createFixture({ migrate } = {}) {
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  let nextId = 0;
  const databaseService = createDatabaseService({
    databasePath: ':memory:',
    ...(migrate ? { migrate } : {}),
  });
  const authorization = createAuthorizationService({
    database: databaseService.database,
    signingService: createSigningService({ database: databaseService.database }),
    now: () => new Date(nowMs),
    idFactory: (prefix) => `${prefix}-${++nextId}`,
  });
  return {
    authorization,
    database: databaseService.database,
    close: () => databaseService.close(),
    advanceDays: (days) => { nowMs += days * 24 * 60 * 60 * 1000; },
    advanceMinutes: (minutes) => { nowMs += minutes * 60 * 1000; },
  };
}

function migrateLegacyDatabaseWithoutFingerprintUniqueness(database) {
  for (const migration of MIGRATIONS) {
    const sql = migration.version === 1
      ? migration.sql.replace(/,\s+UNIQUE \(employee_id, device_fingerprint\)/, '')
      : migration.sql;
    database.exec(sql);
    database.pragma(`user_version = ${migration.version}`);
  }
}

function applicationInput(index) {
  return {
    name: ' 张三 ',
    phone: '138 0013 8000',
    deviceFingerprint: `fingerprint-${index}`,
    clientId: `client-${index}`,
    platform: 'win32',
    arch: 'x64',
  };
}

function deviceCodeInput(index, overrides = {}) {
  return {
    ...applicationInput(index),
    deviceCode: `device-code-${index}`,
    deviceCodeVersion: 'jato-device-v1',
    ...overrides,
  };
}

test('approves one device for one year and returns a thirty-day offline license', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));

  const approved = fixture.authorization.approveApplication(application.id);

  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.license.payload.name, '张三');
  assert.equal(approved.license.payload.phone, '13800138000');
  assert.equal(approved.license.payload.issuedAt, '2026-07-10T00:00:00.000Z');
  assert.equal(approved.license.payload.expiresAt, '2027-07-10T00:00:00.000Z');
  assert.equal(approved.license.payload.offlineValidUntil, '2026-08-09T00:00:00.000Z');
  assert.equal(fixture.authorization.getApplication(application.id).status, 'APPROVED');
  fixture.close();
});

test('blocks a fourth active device until an existing license is revoked', () => {
  const fixture = createFixture();
  const approved = [];
  for (let index = 1; index <= 3; index += 1) {
    const application = fixture.authorization.submitApplication(applicationInput(index));
    approved.push(fixture.authorization.approveApplication(application.id));
  }
  const fourth = fixture.authorization.submitApplication(applicationInput(4));

  assert.equal(fixture.authorization.approveApplication(fourth.id).status, 'DEVICE_LIMIT');
  fixture.authorization.revokeLicense(approved[0].license.payload.licenseId);
  assert.equal(fixture.authorization.approveApplication(fourth.id).status, 'APPROVED');
  fixture.close();
});

test('rejects duplicate pending requests and reports revocation on the next login', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));
  assert.throws(() => fixture.authorization.submitApplication(applicationInput(1)), /APPLICATION_CONFLICT/);
  const approved = fixture.authorization.approveApplication(application.id);

  assert.equal(fixture.authorization.login(applicationInput(1)).status, 'ACTIVE');
  fixture.authorization.revokeLicense(approved.license.payload.licenseId);
  assert.equal(fixture.authorization.login(applicationInput(1)).status, 'REVOKED');
  fixture.close();
});

test('expires licenses after one year and never extends the offline window beyond expiry', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));
  const approved = fixture.authorization.approveApplication(application.id);
  fixture.advanceDays(350);

  const verified = fixture.authorization.verifyLicense({
    licenseId: approved.license.payload.licenseId,
    deviceFingerprint: applicationInput(1).deviceFingerprint,
  });

  assert.equal(verified.status, 'ACTIVE');
  assert.equal(verified.license.payload.offlineValidUntil, '2027-07-10T00:00:00.000Z');
  fixture.advanceDays(16);
  assert.equal(fixture.authorization.login(applicationInput(1)).status, 'EXPIRED');
  fixture.close();
});

test('lists employees with their bound devices and license state for the management UI', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));
  const approved = fixture.authorization.approveApplication(application.id);

  const employees = fixture.authorization.listEmployees();

  assert.equal(employees.length, 1);
  assert.equal(employees[0].name, '张三');
  assert.equal(employees[0].activeDeviceCount, 1);
  assert.deepEqual(employees[0].devices[0], {
    id: approved.license.payload.deviceId,
    clientId: 'client-1',
    platform: 'win32',
    arch: 'x64',
    status: 'ACTIVE',
    lastSeenAt: '2026-07-10T00:00:00.000Z',
    licenseId: approved.license.payload.licenseId,
    licenseStatus: 'ACTIVE',
    expiresAt: '2027-07-10T00:00:00.000Z',
    lastVerifiedAt: '2026-07-10T00:00:00.000Z',
  });
  fixture.close();
});

test('marks elapsed licenses expired when the management list is refreshed', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));
  fixture.authorization.approveApplication(application.id);
  fixture.advanceDays(366);

  const employees = fixture.authorization.listEmployees();

  assert.equal(employees[0].activeDeviceCount, 0);
  assert.equal(employees[0].devices[0].licenseStatus, 'EXPIRED');
  fixture.close();
});

test('never returns an approved license envelope after it was revoked', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));
  const approved = fixture.authorization.approveApplication(application.id);

  fixture.authorization.revokeLicense(approved.license.payload.licenseId);
  const revokedApplication = fixture.authorization.getApplication(application.id);

  assert.equal(revokedApplication.status, 'REVOKED');
  assert.equal(revokedApplication.license, null);
  fixture.close();
});

test('hides legacy revoked rows from employee and device statistics after schema upgrade', () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(applicationInput(1));
  const approved = fixture.authorization.approveApplication(application.id);
  fixture.database.prepare("UPDATE licenses SET status = 'REVOKED' WHERE id = ?")
    .run(approved.license.payload.licenseId);
  fixture.database.prepare("UPDATE devices SET status = 'REVOKED' WHERE id = ?")
    .run(approved.license.payload.deviceId);

  assert.equal(fixture.authorization.listEmployees().length, 0);
  assert.equal(fixture.authorization.getSummary().employeeCount, 0);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 0);
  fixture.close();
});

test('reports applications, pending applications, employees, and unique active devices independently', () => {
  const fixture = createFixture();
  const approvedApplication = fixture.authorization.submitApplication(deviceCodeInput(1));
  fixture.authorization.approveApplication(approvedApplication.id);
  fixture.authorization.submitApplication({
    ...deviceCodeInput(2),
    name: '李四',
    phone: '13900139000',
  });

  assert.deepEqual(fixture.authorization.getSummary(), {
    applicationCount: 2,
    pendingApplicationCount: 1,
    employeeCount: 1,
    activeDeviceBindingCount: 1,
  });
  fixture.close();
});

test('repeated approval for one Device Code keeps one device and one ACTIVE license without consuming quota', () => {
  const fixture = createFixture();
  const first = fixture.authorization.submitApplication(deviceCodeInput(1));
  fixture.authorization.approveApplication(first.id);
  const repeated = fixture.authorization.submitApplication(deviceCodeInput(1, {
    deviceFingerprint: 'fingerprint-after-reinstall',
    clientId: 'client-after-reinstall',
  }));
  assert.equal(fixture.authorization.approveApplication(repeated.id).status, 'APPROVED');

  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'ACTIVE'").get().count, 1);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 1);
  fixture.close();
});

test('approval merges explicit legacy duplicates before issuing the Device Code License', () => {
  const fixture = createFixture();
  for (let index = 1; index <= 2; index += 1) {
    const legacyApplication = fixture.authorization.submitApplication(applicationInput(index));
    fixture.authorization.approveApplication(legacyApplication.id);
    fixture.advanceDays(1);
  }
  fixture.database.prepare(`
    UPDATE devices SET client_id = 'shared-legacy-client'
    WHERE device_code IS NULL OR device_code = ''
  `).run();
  const currentApplication = fixture.authorization.submitApplication(deviceCodeInput(9, {
    deviceFingerprint: 'fingerprint-1',
    clientId: 'shared-legacy-client',
  }));

  assert.equal(fixture.authorization.approveApplication(currentApplication.id).status, 'APPROVED');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'ACTIVE'").get().count, 1);
  assert.equal(fixture.database.prepare('SELECT device_code FROM devices').get().device_code, 'device-code-9');
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 1);
  fixture.close();
});

test('approval normalizes an unrelated legacy client duplicate before issuing a third unique Device Code', () => {
  const fixture = createFixture();
  const secondBinding = fixture.authorization.submitApplication(deviceCodeInput(3));
  fixture.authorization.approveApplication(secondBinding.id);
  for (let index = 1; index <= 2; index += 1) {
    const legacyApplication = fixture.authorization.submitApplication(applicationInput(index));
    fixture.authorization.approveApplication(legacyApplication.id);
  }
  fixture.database.prepare(`
    UPDATE devices SET client_id = 'shared-legacy-client'
    WHERE device_code IS NULL OR device_code = ''
  `).run();

  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 3);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 2);

  const thirdBinding = fixture.authorization.submitApplication(deviceCodeInput(4));
  assert.equal(fixture.authorization.approveApplication(thirdBinding.id).status, 'APPROVED');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 3);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'ACTIVE'").get().count, 3);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 3);
  fixture.close();
});

test('approval normalizes an unrelated legacy fingerprint duplicate when Client IDs are empty', () => {
  const fixture = createFixture({ migrate: migrateLegacyDatabaseWithoutFingerprintUniqueness });
  const secondBinding = fixture.authorization.submitApplication(deviceCodeInput(3));
  fixture.authorization.approveApplication(secondBinding.id);
  for (let index = 1; index <= 2; index += 1) {
    const legacyApplication = fixture.authorization.submitApplication({
      ...applicationInput(index),
      clientId: '',
    });
    fixture.authorization.approveApplication(legacyApplication.id);
  }
  fixture.database.prepare(`
    UPDATE devices SET device_fingerprint = 'shared-legacy-fingerprint'
    WHERE device_code IS NULL OR device_code = ''
  `).run();

  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 3);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 2);

  const thirdBinding = fixture.authorization.submitApplication(deviceCodeInput(4));
  assert.equal(fixture.authorization.approveApplication(thirdBinding.id).status, 'APPROVED');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 3);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'ACTIVE'").get().count, 3);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 3);
  fixture.close();
});

test('allows three distinct Device Codes, rejects a fourth, and still reapproves an existing code', () => {
  const fixture = createFixture();
  for (let index = 1; index <= 3; index += 1) {
    const application = fixture.authorization.submitApplication(deviceCodeInput(index));
    assert.equal(fixture.authorization.approveApplication(application.id).status, 'APPROVED');
  }
  const fourth = fixture.authorization.submitApplication(deviceCodeInput(4));
  assert.equal(fixture.authorization.approveApplication(fourth.id).status, 'DEVICE_LIMIT');
  const repeated = fixture.authorization.submitApplication(deviceCodeInput(2, {
    deviceFingerprint: 'fingerprint-2-reinstalled',
    clientId: 'client-2-reinstalled',
  }));
  assert.equal(fixture.authorization.approveApplication(repeated.id).status, 'APPROVED');
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 3);
  fixture.close();
});

test('does not bind a sole legacy device when Device Code, Client ID, and fingerprint all changed', () => {
  const fixture = createFixture();
  const legacy = fixture.authorization.submitApplication(applicationInput(1));
  fixture.authorization.approveApplication(legacy.id);

  const login = fixture.authorization.login(deviceCodeInput(9, {
    name: '张三',
    phone: '13800138000',
    deviceFingerprint: 'new-fingerprint',
    clientId: 'new-client-id',
  }));

  assert.equal(login.status, 'NOT_AUTHORIZED');
  assert.deepEqual(
    fixture.database.prepare('SELECT device_code, client_id, device_fingerprint FROM devices').get(),
    { device_code: null, client_id: 'client-1', device_fingerprint: 'fingerprint-1' },
  );
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  fixture.close();
});

test('old client login keeps authorization when its fingerprint changes but stable Client ID matches', () => {
  const fixture = createFixture();
  const legacy = fixture.authorization.submitApplication(applicationInput(1));
  fixture.authorization.approveApplication(legacy.id);

  const login = fixture.authorization.login({
    ...applicationInput(1),
    deviceFingerprint: 'fingerprint-after-network-change',
  });

  assert.equal(login.status, 'ACTIVE');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
  fixture.close();
});

test('keeps the legacy fingerprint usable after a new client binds Device Code to the same License', () => {
  const fixture = createFixture();
  const legacyApplication = fixture.authorization.submitApplication(applicationInput(1));
  const approved = fixture.authorization.approveApplication(legacyApplication.id);

  assert.equal(fixture.authorization.login(deviceCodeInput(9, {
    name: '张三',
    phone: '13800138000',
    deviceFingerprint: 'new-install-fingerprint',
    clientId: 'client-1',
  })).status, 'ACTIVE');
  assert.equal(fixture.authorization.verifyLicense({
    licenseId: approved.license.payload.licenseId,
    deviceFingerprint: 'fingerprint-1',
  }).status, 'ACTIVE');
  fixture.close();
});

test('returns a migration conflict instead of binding a new Device Code to multiple legacy candidates', () => {
  const fixture = createFixture();
  for (let index = 1; index <= 2; index += 1) {
    const application = fixture.authorization.submitApplication(applicationInput(index));
    fixture.authorization.approveApplication(application.id);
  }

  const login = fixture.authorization.login(deviceCodeInput(9, {
    name: '张三',
    phone: '13800138000',
    deviceFingerprint: 'unknown-fingerprint',
    clientId: 'unknown-client',
  }));

  assert.equal(login.status, 'DEVICE_MIGRATION_CONFLICT');
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM devices WHERE device_code IS NOT NULL AND device_code <> ''").get().count, 0);
  fixture.close();
});

test('merges explicit legacy duplicates by canonical priority and keeps the maximum license dates', () => {
  const fixture = createFixture();
  const firstApplication = fixture.authorization.submitApplication(applicationInput(1));
  const first = fixture.authorization.approveApplication(firstApplication.id);
  fixture.advanceDays(1);
  const secondApplication = fixture.authorization.submitApplication(applicationInput(2));
  const second = fixture.authorization.approveApplication(secondApplication.id);
  fixture.database.prepare(`
    UPDATE devices SET client_id = 'shared-legacy-client'
    WHERE device_code IS NULL OR device_code = ''
  `).run();
  fixture.database.prepare('UPDATE licenses SET expires_at = ? WHERE id = ?')
    .run('2028-07-10T00:00:00.000Z', first.license.payload.licenseId);
  fixture.advanceDays(1);

  const login = fixture.authorization.login(deviceCodeInput(9, {
    name: '张三',
    phone: '13800138000',
    deviceFingerprint: 'current-fingerprint',
    clientId: 'shared-legacy-client',
    platform: 'darwin',
    arch: 'arm64',
  }));

  assert.equal(login.status, 'ACTIVE');
  assert.equal(login.license.payload.deviceId, second.license.payload.deviceId);
  assert.equal(login.license.payload.licenseId, second.license.payload.licenseId);
  assert.equal(login.license.payload.expiresAt, '2028-07-10T00:00:00.000Z');
  assert.equal(login.license.payload.verifiedAt, '2026-07-12T00:00:00.000Z');
  assert.deepEqual(
    fixture.database.prepare('SELECT device_code, client_id, device_fingerprint, platform, arch FROM devices').get(),
    {
      device_code: 'device-code-9',
      client_id: 'shared-legacy-client',
      device_fingerprint: 'fingerprint-2',
      platform: 'darwin',
      arch: 'arm64',
    },
  );
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'ACTIVE'").get().count, 1);
  fixture.close();
});

test('revocation deletes the ordinary device, releases quota, publishes an event, and supports acknowledgement', async () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(deviceCodeInput(1));
  const approved = fixture.authorization.approveApplication(application.id);
  const login = fixture.authorization.login(deviceCodeInput(1));
  const events = [];
  const unsubscribe = fixture.authorization.subscribeRevocations(login.watchToken, (event) => events.push(event));

  fixture.authorization.revokeLicense(approved.license.payload.licenseId);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'REVOKED');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM authorization_revocations').get().count, 1);
  assert.equal(fixture.authorization.getSummary().activeDeviceBindingCount, 0);
  assert.equal(fixture.authorization.listEmployees().length, 0);
  assert.equal(fixture.authorization.verifyLicense({
    licenseId: approved.license.payload.licenseId,
    deviceCode: 'device-code-1',
    deviceFingerprint: 'fingerprint-1',
  }).status, 'REVOKED');

  fixture.authorization.acknowledgeRevocation(login.watchToken);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM authorization_revocations').get().count, 0);
  assert.equal(fixture.authorization.verifyLicense({
    licenseId: approved.license.payload.licenseId,
    deviceCode: 'device-code-1',
    deviceFingerprint: 'fingerprint-1',
  }).status, 'NOT_AUTHORIZED');
  unsubscribe();
  fixture.close();
});

test('late revocation subscribers receive an already persisted tombstone immediately', async () => {
  const fixture = createFixture();
  const application = fixture.authorization.submitApplication(deviceCodeInput(1));
  const approved = fixture.authorization.approveApplication(application.id);
  fixture.authorization.revokeLicense(approved.license.payload.licenseId);
  const events = [];

  const unsubscribe = fixture.authorization.subscribeRevocations(
    approved.watchToken,
    (event) => events.push(event),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    status: 'REVOKED',
    licenseId: approved.license.payload.licenseId,
    revokedAt: '2026-07-10T00:00:00.000Z',
  });
  unsubscribe();
  fixture.close();
});

test('an authenticated subscriber can acknowledge after token TTL while unbound expired tokens stay invalid', () => {
  const fixture = createFixture();
  const subscribedApplication = fixture.authorization.submitApplication(deviceCodeInput(1));
  const subscribed = fixture.authorization.approveApplication(subscribedApplication.id);
  const events = [];
  const unsubscribe = fixture.authorization.subscribeRevocations(
    subscribed.watchToken,
    (event) => events.push(event),
  );
  fixture.advanceMinutes(6);

  fixture.authorization.revokeLicense(subscribed.license.payload.licenseId);
  assert.equal(events.length, 1);
  assert.doesNotThrow(() => fixture.authorization.acknowledgeRevocation(subscribed.watchToken));
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM authorization_revocations').get().count, 0);
  unsubscribe();

  const unboundApplication = fixture.authorization.submitApplication(deviceCodeInput(2));
  const unbound = fixture.authorization.approveApplication(unboundApplication.id);
  fixture.advanceMinutes(6);
  fixture.authorization.revokeLicense(unbound.license.payload.licenseId);
  assert.throws(
    () => fixture.authorization.acknowledgeRevocation(unbound.watchToken),
    /INVALID_WATCH_TOKEN/,
  );
  assert.throws(
    () => fixture.authorization.acknowledgeRevocation('arbitrary-expired-token'),
    /INVALID_WATCH_TOKEN/,
  );
  fixture.close();
});

test('allows a revoked Device Code to log in after a new approved application while the old License stays revoked', () => {
  const fixture = createFixture();
  const originalApplication = fixture.authorization.submitApplication(deviceCodeInput(1));
  const original = fixture.authorization.approveApplication(originalApplication.id);
  fixture.authorization.revokeLicense(original.license.payload.licenseId);

  const replacementApplication = fixture.authorization.submitApplication(deviceCodeInput(1, {
    deviceFingerprint: 'fingerprint-after-reapproval',
    clientId: 'client-after-reapproval',
  }));
  const replacement = fixture.authorization.approveApplication(replacementApplication.id);

  assert.equal(fixture.authorization.login(deviceCodeInput(1, {
    deviceFingerprint: 'fingerprint-after-reapproval',
    clientId: 'client-after-reapproval',
  })).status, 'ACTIVE');
  assert.notEqual(replacement.license.payload.licenseId, original.license.payload.licenseId);
  assert.equal(fixture.authorization.verifyLicense({
    licenseId: original.license.payload.licenseId,
    deviceCode: 'device-code-1',
    deviceFingerprint: 'fingerprint-1',
  }).status, 'REVOKED');
  fixture.close();
});

test('purges unacknowledged tombstones after thirty days without touching normal or expired devices', () => {
  const fixture = createFixture();
  const revokedApplication = fixture.authorization.submitApplication(deviceCodeInput(1));
  const revoked = fixture.authorization.approveApplication(revokedApplication.id);
  const activeApplication = fixture.authorization.submitApplication(deviceCodeInput(2));
  fixture.authorization.approveApplication(activeApplication.id);
  fixture.authorization.revokeLicense(revoked.license.payload.licenseId);
  fixture.advanceDays(31);

  assert.equal(fixture.authorization.cleanupRevocations(), 1);
  assert.equal(fixture.authorization.verifyLicense({
    licenseId: revoked.license.payload.licenseId,
    deviceCode: 'device-code-1',
    deviceFingerprint: 'fingerprint-1',
  }).status, 'NOT_AUTHORIZED');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
  fixture.close();
});
