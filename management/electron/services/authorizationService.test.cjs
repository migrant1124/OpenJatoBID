const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabaseService } = require('./databaseService.cjs');
const { createSigningService } = require('./signingService.cjs');
const { createAuthorizationService } = require('./authorizationService.cjs');

function createFixture() {
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  let nextId = 0;
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const authorization = createAuthorizationService({
    database: databaseService.database,
    signingService: createSigningService({ database: databaseService.database }),
    now: () => new Date(nowMs),
    idFactory: (prefix) => `${prefix}-${++nextId}`,
  });
  return {
    authorization,
    close: () => databaseService.close(),
    advanceDays: (days) => { nowMs += days * 24 * 60 * 60 * 1000; },
  };
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
