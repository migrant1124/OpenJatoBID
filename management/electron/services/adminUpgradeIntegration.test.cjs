const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  ADMIN_CREDENTIAL_STATES,
  createAdminAuthService,
} = require('./adminAuthService.cjs');
const { createAuthorizationService } = require('./authorizationService.cjs');
const { createDatabaseService } = require('./databaseService.cjs');
const { getFixedManagementDataRoot } = require('./managementDataService.cjs');
const { MIGRATIONS } = require('./migrations.cjs');
const { createSigningService } = require('./signingService.cjs');

function createInitialCredential({
  username,
  password,
  credentialVersion,
  passwordSalt = '0123456789abcdef0123456789abcdef',
}) {
  return {
    username,
    passwordSalt,
    passwordHash: crypto.scryptSync(password, passwordSalt, 64).toString('hex'),
    credentialVersion,
  };
}

const originalCredential = createInitialCredential({
  username: 'original-owner',
  password: 'Original-Initial-123',
  credentialVersion: 'v1.4.1',
});

const replacementCredential = createInitialCredential({
  username: 'replacement-owner',
  password: 'Replacement-Initial-456',
  credentialVersion: 'v1.4.2',
  passwordSalt: 'fedcba9876543210fedcba9876543210',
});

test('real-file OWNER survives update and reinstall while protected settings and authorization data remain', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-management-owner-upgrade-'));
  const localAppData = path.join(root, 'LocalAppData');
  const firstDataRoot = getFixedManagementDataRoot({
    platform: 'win32',
    env: { LOCALAPPDATA: localAppData, APP_VERSION: '1.4.1' },
    homeDir: root,
  });
  const upgradedDataRoot = getFixedManagementDataRoot({
    platform: 'win32',
    env: { LOCALAPPDATA: localAppData, APP_VERSION: '1.4.2' },
    homeDir: root,
  });
  const databasePath = path.join(firstDataRoot, 'management.sqlite3');
  let service = null;
  try {
    assert.equal(upgradedDataRoot, firstDataRoot);
    service = createDatabaseService({ databasePath });
    const auth = createAdminAuthService({
      database: service.database,
      initialCredential: originalCredential,
      allowInitialBootstrap: service.isNewDatabase,
    });
    auth.completeInitialPasswordChange('Owner-Password-789');
    service.database.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('server_config', '{"host":"0.0.0.0","port":47821}', '2026-07-10T00:00:00.000Z');
    const signingService = createSigningService({ database: service.database });
    const issuerId = signingService.getIssuerId();
    let nextId = 0;
    const authorization = createAuthorizationService({
      database: service.database,
      signingService,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      idFactory: (prefix) => `${prefix}-${++nextId}`,
    });
    const application = authorization.submitApplication({
      name: '张三',
      phone: '13800138000',
      deviceCode: 'device-code-1',
      deviceCodeVersion: 'jato-device-v1',
      deviceFingerprint: 'fingerprint-1',
      clientId: 'client-1',
      platform: 'win32',
      arch: 'x64',
    });
    const approved = authorization.approveApplication(application.id);
    service.close();
    service = null;

    service = createDatabaseService({ databasePath: path.join(upgradedDataRoot, 'management.sqlite3') });
    const restartedAuth = createAdminAuthService({
      database: service.database,
      initialCredential: replacementCredential,
      allowInitialBootstrap: service.isNewDatabase,
    });
    assert.equal(restartedAuth.login({ username: 'original-owner', password: 'Owner-Password-789' }).success, true);
    assert.equal(restartedAuth.login({ username: 'replacement-owner', password: 'Replacement-Initial-456' }).success, false);
    assert.equal(createSigningService({ database: service.database }).getIssuerId(), issuerId);
    assert.equal(
      service.database.prepare('SELECT value_json FROM settings WHERE key = ?').get('server_config').value_json,
      '{"host":"0.0.0.0","port":47821}',
    );
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM employees').get().count, 1);
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
    assert.equal(service.database.prepare('SELECT id FROM licenses').get().id, approved.license.payload.licenseId);
  } finally {
    service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real-file INITIAL credential remains unchanged when a newer package is reopened', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-management-initial-upgrade-'));
  const databasePath = path.join(root, 'management.sqlite3');
  let service = null;
  try {
    service = createDatabaseService({ databasePath });
    createAdminAuthService({
      database: service.database,
      initialCredential: originalCredential,
      allowInitialBootstrap: service.isNewDatabase,
    });
    service.close();
    service = null;

    service = createDatabaseService({ databasePath });
    const restartedAuth = createAdminAuthService({
      database: service.database,
      initialCredential: replacementCredential,
      allowInitialBootstrap: service.isNewDatabase,
    });
    assert.deepEqual(
      restartedAuth.login({ username: 'original-owner', password: 'Original-Initial-123' }),
      { success: true, username: 'original-owner', mustChangePassword: true },
    );
    assert.equal(restartedAuth.login({
      username: 'replacement-owner',
      password: 'Replacement-Initial-456',
    }).success, false);
  } finally {
    service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real-file LEGACY migration preserves its hash, salt, password, settings, and authorization rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-management-legacy-upgrade-'));
  const databasePath = path.join(root, 'management.sqlite3');
  let service = null;
  const legacyPassword = 'Legacy-Password-123';
  const legacySalt = 'legacy-salt-0123456789abcdef';
  const legacyHash = crypto.scryptSync(legacyPassword, legacySalt, 64).toString('hex');
  const timestamp = '2026-07-10T00:00:00.000Z';
  try {
    const legacy = new Database(databasePath);
    legacy.pragma('foreign_keys = ON');
    for (const migration of MIGRATIONS.filter((item) => item.version <= 2)) {
      legacy.exec(migration.sql);
      legacy.pragma(`user_version = ${migration.version}`);
    }
    legacy.prepare(`
      INSERT INTO admin_auth (
        id, password_hash, password_salt, must_change_password,
        temp_password_hash, temp_password_salt, temp_password_expires_at,
        created_at, updated_at
      ) VALUES (1, ?, ?, 0, NULL, NULL, NULL, ?, ?)
    `).run(legacyHash, legacySalt, timestamp, timestamp);
    legacy.prepare(`
      INSERT INTO settings (key, value_json, updated_at) VALUES
        ('server_config', '{"host":"0.0.0.0","port":47821}', ?),
        ('license_signing_key', '{"issuerId":"legacy-issuer"}', ?)
    `).run(timestamp, timestamp);
    legacy.prepare(`
      INSERT INTO employees (id, name, phone, normalized_name, normalized_phone, created_at, updated_at)
      VALUES ('employee-1', '张三', '13800138000', '张三', '13800138000', ?, ?)
    `).run(timestamp, timestamp);
    legacy.prepare(`
      INSERT INTO devices (id, employee_id, device_fingerprint, client_id, platform, arch, created_at, updated_at)
      VALUES ('device-1', 'employee-1', 'fingerprint-1', 'client-1', 'win32', 'x64', ?, ?)
    `).run(timestamp, timestamp);
    legacy.prepare(`
      INSERT INTO licenses (id, employee_id, device_id, status, issued_at, expires_at, last_verified_at, created_at, updated_at)
      VALUES ('license-1', 'employee-1', 'device-1', 'ACTIVE', ?, '2027-07-10T00:00:00.000Z', ?, ?, ?)
    `).run(timestamp, timestamp, timestamp, timestamp);
    legacy.close();

    service = createDatabaseService({ databasePath });
    const migratedAuth = createAdminAuthService({
      database: service.database,
      initialCredential: replacementCredential,
      allowInitialBootstrap: service.isNewDatabase,
    });
    assert.equal(migratedAuth.login({ username: 'replacement-owner', password: legacyPassword }).success, true);
    assert.equal(migratedAuth.login({ username: 'replacement-owner', password: 'Replacement-Initial-456' }).success, false);
    assert.deepEqual(
      service.database.prepare(`
        SELECT password_hash, password_salt, credential_state FROM admin_auth WHERE id = 1
      `).get(),
      {
        password_hash: legacyHash,
        password_salt: legacySalt,
        credential_state: ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE,
      },
    );
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM settings WHERE key IN (?, ?)')
      .get('server_config', 'license_signing_key').count, 2);
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM employees').get().count, 1);
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
  } finally {
    service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing real-file business database without admin_auth refuses packaged initial credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-management-missing-admin-'));
  const databasePath = path.join(root, 'management.sqlite3');
  let service = null;
  let settingsBeforeGate = [];
  try {
    service = createDatabaseService({ databasePath });
    assert.equal(service.isNewDatabase, true);
    service.database.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('server_config', '{"host":"0.0.0.0","port":47821}', '2026-07-10T00:00:00.000Z');
    settingsBeforeGate = service.database.prepare(`
      SELECT key, value_json, updated_at FROM settings ORDER BY key
    `).all();
    service.close();
    service = null;

    service = createDatabaseService({ databasePath });
    assert.equal(service.isNewDatabase, false);
    assert.throws(
      () => createAdminAuthService({
        database: service.database,
        initialCredential: replacementCredential,
        allowInitialBootstrap: service.isNewDatabase,
      }),
      /ADMIN_AUTH_MISSING_FROM_EXISTING_DATABASE/,
    );
    assert.equal(service.database.prepare('SELECT COUNT(*) AS count FROM admin_auth').get().count, 0);
    assert.deepEqual(service.database.prepare(`
      SELECT key, value_json, updated_at FROM settings ORDER BY key
    `).all(), settingsBeforeGate);
  } finally {
    service?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main gates admin ownership before signing and authorization services can write', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const bootstrap = source.slice(source.indexOf('databaseService = createDatabaseService'));
  const adminGateIndex = bootstrap.indexOf('createAdminAuthService({');
  assert.ok(adminGateIndex >= 0);
  assert.ok(adminGateIndex < bootstrap.indexOf('createSigningService({'));
  assert.ok(adminGateIndex < bootstrap.indexOf('createAuthorizationService({'));
  assert.ok(adminGateIndex < bootstrap.indexOf('cleanupRevocations()'));
});
