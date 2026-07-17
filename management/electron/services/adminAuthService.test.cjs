const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDatabaseService } = require('./databaseService.cjs');
const {
  ADMIN_CREDENTIAL_STATES,
  createAdminAuthService,
} = require('./adminAuthService.cjs');

function createInitialCredential({
  username = 'initial-owner',
  password = 'Initial-Password-123',
  passwordSalt = '0123456789abcdef0123456789abcdef',
  credentialVersion = 'test-v1',
} = {}) {
  return {
    username,
    passwordSalt,
    passwordHash: crypto.scryptSync(password, passwordSalt, 64).toString('hex'),
    credentialVersion,
  };
}

test('bootstraps an empty database, forces the initial change, and never restores the initial password', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const initialCredential = createInitialCredential();
  const auth = createAdminAuthService({
    database: databaseService.database,
    initialCredential,
    allowInitialBootstrap: databaseService.isNewDatabase,
  });

  assert.deepEqual(auth.getStatus(), {
    username: 'initial-owner',
    credentialState: ADMIN_CREDENTIAL_STATES.INITIAL_PASSWORD_REQUIRED,
    mustChangePassword: true,
  });
  assert.equal(auth.login({ username: 'wrong-owner', password: 'Initial-Password-123' }).success, false);
  assert.equal(auth.login({ username: 'initial-owner', password: 'wrong-password' }).success, false);
  assert.deepEqual(auth.login({ username: 'initial-owner', password: 'Initial-Password-123' }), {
    success: true,
    username: 'initial-owner',
    mustChangePassword: true,
  });
  assert.throws(
    () => auth.completeInitialPasswordChange('Initial-Password-123'),
    /NEW_PASSWORD_MUST_DIFFER/,
  );
  assert.equal(auth.getStatus().mustChangePassword, true);

  auth.completeInitialPasswordChange('Owner-Password-456');
  assert.deepEqual(auth.getStatus(), {
    username: 'initial-owner',
    credentialState: ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE,
    mustChangePassword: false,
  });
  assert.equal(auth.login({ username: 'initial-owner', password: 'Initial-Password-123' }).success, false);
  assert.equal(auth.login({ username: 'initial-owner', password: 'Owner-Password-456' }).success, true);

  const restarted = createAdminAuthService({
    database: databaseService.database,
    initialCredential: createInitialCredential({
      username: 'replacement-owner',
      password: 'Replacement-Password-789',
      credentialVersion: 'test-v2',
    }),
    allowInitialBootstrap: false,
  });
  assert.equal(restarted.login({ username: 'replacement-owner', password: 'Replacement-Password-789' }).success, false);
  assert.equal(restarted.login({ username: 'initial-owner', password: 'Owner-Password-456' }).success, true);
  assert.equal(restarted.getStatus().credentialState, ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE);
  databaseService.close();
});

test('migrates LEGACY authentication without replacing its password hash or salt', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const timestamp = '2026-07-10T00:00:00.000Z';
  const legacyPassword = 'Legacy-Password-123';
  const legacySalt = 'legacy-salt-0123456789abcdef';
  const legacyHash = crypto.scryptSync(legacyPassword, legacySalt, 64).toString('hex');
  databaseService.database.prepare(`
    INSERT INTO admin_auth (
      id, username, password_hash, password_salt, credential_state,
      initial_credential_version, created_at, updated_at
    ) VALUES (1, '', ?, ?, 'LEGACY', NULL, ?, ?)
  `).run(legacyHash, legacySalt, timestamp, timestamp);
  databaseService.database.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES
      ('smtp_config', '{"authorizationCode":"legacy-secret"}', ?),
      ('server_config', '{"host":"0.0.0.0","port":47821}', ?),
      ('license_signing_key', '{"issuerId":"issuer-1"}', ?)
  `).run(timestamp, timestamp, timestamp);

  const auth = createAdminAuthService({
    database: databaseService.database,
    initialCredential: createInitialCredential(),
    allowInitialBootstrap: false,
  });

  assert.equal(auth.login({ username: 'initial-owner', password: legacyPassword }).success, true);
  assert.equal(auth.login({ username: 'initial-owner', password: 'Initial-Password-123' }).success, false);
  assert.deepEqual(
    databaseService.database.prepare('SELECT password_hash, password_salt, credential_state FROM admin_auth WHERE id = 1').get(),
    {
      password_hash: legacyHash,
      password_salt: legacySalt,
      credential_state: ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE,
    },
  );
  assert.equal(databaseService.database.prepare('SELECT 1 FROM settings WHERE key = ?').get('smtp_config'), undefined);
  assert.equal(databaseService.database.prepare('SELECT 1 FROM settings WHERE key = ?').get('server_config')['1'], 1);
  assert.equal(databaseService.database.prepare('SELECT 1 FROM settings WHERE key = ?').get('license_signing_key')['1'], 1);
  databaseService.close();
});

test('keeps the original INITIAL_PASSWORD_REQUIRED credential when the packaged credential changes', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const original = createInitialCredential({
    username: 'original-owner',
    password: 'Original-Initial-123',
    credentialVersion: 'initial-v1',
  });
  createAdminAuthService({
    database: databaseService.database,
    initialCredential: original,
    allowInitialBootstrap: databaseService.isNewDatabase,
  });
  const before = databaseService.database.prepare('SELECT * FROM admin_auth WHERE id = 1').get();

  const restarted = createAdminAuthService({
    database: databaseService.database,
    initialCredential: createInitialCredential({
      username: 'replacement-owner',
      password: 'Replacement-Initial-456',
      credentialVersion: 'initial-v2',
    }),
    allowInitialBootstrap: false,
  });
  const after = databaseService.database.prepare('SELECT * FROM admin_auth WHERE id = 1').get();

  assert.equal(restarted.login({ username: 'original-owner', password: 'Original-Initial-123' }).success, true);
  assert.equal(restarted.login({ username: 'replacement-owner', password: 'Replacement-Initial-456' }).success, false);
  assert.deepEqual(after, before);
  databaseService.close();
});

test('changes an active owner password only when the current password matches', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const auth = createAdminAuthService({
    database: databaseService.database,
    initialCredential: createInitialCredential(),
    allowInitialBootstrap: databaseService.isNewDatabase,
  });
  auth.completeInitialPasswordChange('Owner-Password-456');

  assert.throws(
    () => auth.changePassword({ currentPassword: 'wrong-password', newPassword: 'Owner-Password-789' }),
    /CURRENT_PASSWORD_INCORRECT/,
  );
  assert.throws(
    () => auth.changePassword({ currentPassword: 'Owner-Password-456', newPassword: 'Owner-Password-456' }),
    /NEW_PASSWORD_MUST_DIFFER/,
  );
  assert.equal(auth.login({ username: 'initial-owner', password: 'Owner-Password-456' }).success, true);

  auth.changePassword({
    currentPassword: 'Owner-Password-456',
    newPassword: 'Owner-Password-789',
  });
  assert.equal(auth.login({ username: 'initial-owner', password: 'Owner-Password-456' }).success, false);
  assert.equal(auth.login({ username: 'initial-owner', password: 'Owner-Password-789' }).success, true);
  assert.throws(
    () => auth.completeInitialPasswordChange('Another-Password-123'),
    /INITIAL_PASSWORD_CHANGE_NOT_REQUIRED/,
  );
  databaseService.close();
});
