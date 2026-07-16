const crypto = require('node:crypto');

const ADMIN_CREDENTIAL_STATES = Object.freeze({
  LEGACY: 'LEGACY',
  INITIAL_PASSWORD_REQUIRED: 'INITIAL_PASSWORD_REQUIRED',
  OWNER_PASSWORD_ACTIVE: 'OWNER_PASSWORD_ACTIVE',
});

const LEGACY_MAIL_SETTING_KEY = 'smtp_config';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function passwordsMatch(password, salt, expectedHash) {
  if (typeof password !== 'string' || !salt || !expectedHash) return false;
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeInitialCredential(initialCredential) {
  const username = typeof initialCredential?.username === 'string'
    ? initialCredential.username.trim()
    : '';
  const passwordSalt = typeof initialCredential?.passwordSalt === 'string'
    ? initialCredential.passwordSalt
    : '';
  const passwordHash = typeof initialCredential?.passwordHash === 'string'
    ? initialCredential.passwordHash
    : '';
  const credentialVersion = typeof initialCredential?.credentialVersion === 'string'
    ? initialCredential.credentialVersion.trim()
    : '';

  if (!username || !passwordSalt || !credentialVersion || !/^[a-f0-9]{128}$/i.test(passwordHash)) {
    throw new Error('INITIAL_ADMIN_CREDENTIAL_INVALID');
  }
  return { username, passwordSalt, passwordHash, credentialVersion };
}

function createAdminAuthService({
  database,
  initialCredential,
  allowInitialBootstrap = false,
  now = () => new Date(),
  saltFactory = () => crypto.randomBytes(16).toString('hex'),
}) {
  const normalizedInitialCredential = normalizeInitialCredential(initialCredential);
  const readAuth = () => database.prepare('SELECT * FROM admin_auth WHERE id = 1').get();

  function bootstrapInitialCredential() {
    const timestamp = now().toISOString();
    database.transaction(() => {
      const auth = readAuth();
      if (!auth) {
        if (!allowInitialBootstrap) throw new Error('ADMIN_AUTH_MISSING_FROM_EXISTING_DATABASE');
        database.prepare(`
          INSERT INTO admin_auth (
            id, username, password_hash, password_salt, credential_state,
            initial_credential_version, created_at, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          normalizedInitialCredential.username,
          normalizedInitialCredential.passwordHash,
          normalizedInitialCredential.passwordSalt,
          ADMIN_CREDENTIAL_STATES.INITIAL_PASSWORD_REQUIRED,
          normalizedInitialCredential.credentialVersion,
          timestamp,
          timestamp,
        );
      } else if (auth.credential_state === ADMIN_CREDENTIAL_STATES.LEGACY) {
        database.prepare(`
          UPDATE admin_auth
          SET username = ?, credential_state = ?, updated_at = ?
          WHERE id = 1
        `).run(
          String(auth.username || '').trim() || normalizedInitialCredential.username,
          ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE,
          timestamp,
        );
      } else if (
        auth.credential_state !== ADMIN_CREDENTIAL_STATES.INITIAL_PASSWORD_REQUIRED
        && auth.credential_state !== ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE
      ) {
        throw new Error('ADMIN_CREDENTIAL_STATE_INVALID');
      }

      database.prepare('DELETE FROM settings WHERE key = ?').run(LEGACY_MAIL_SETTING_KEY);
    })();
  }

  function getStatus() {
    const auth = readAuth();
    if (!auth) throw new Error('ADMIN_NOT_CONFIGURED');
    return {
      username: auth.username,
      credentialState: auth.credential_state,
      mustChangePassword: auth.credential_state === ADMIN_CREDENTIAL_STATES.INITIAL_PASSWORD_REQUIRED,
    };
  }

  function login({ username, password }) {
    const auth = readAuth();
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (
      !auth
      || normalizedUsername !== auth.username
      || !passwordsMatch(password, auth.password_salt, auth.password_hash)
    ) {
      return { success: false, username: null, mustChangePassword: false };
    }
    return {
      success: true,
      username: auth.username,
      mustChangePassword: auth.credential_state === ADMIN_CREDENTIAL_STATES.INITIAL_PASSWORD_REQUIRED,
    };
  }

  function completeInitialPasswordChange(newPassword) {
    const auth = readAuth();
    if (!auth) throw new Error('ADMIN_NOT_CONFIGURED');
    if (auth.credential_state !== ADMIN_CREDENTIAL_STATES.INITIAL_PASSWORD_REQUIRED) {
      throw new Error('INITIAL_PASSWORD_CHANGE_NOT_REQUIRED');
    }
    if (passwordsMatch(newPassword, auth.password_salt, auth.password_hash)) {
      throw new Error('NEW_PASSWORD_MUST_DIFFER');
    }
    const salt = saltFactory();
    database.prepare(`
      UPDATE admin_auth
      SET password_hash = ?, password_salt = ?, credential_state = ?, updated_at = ?
      WHERE id = 1
    `).run(
      hashPassword(newPassword, salt),
      salt,
      ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE,
      now().toISOString(),
    );
  }

  function changePassword({ currentPassword, newPassword }) {
    const auth = readAuth();
    if (!auth) throw new Error('ADMIN_NOT_CONFIGURED');
    if (auth.credential_state !== ADMIN_CREDENTIAL_STATES.OWNER_PASSWORD_ACTIVE) {
      throw new Error('OWNER_PASSWORD_NOT_ACTIVE');
    }
    if (!passwordsMatch(currentPassword, auth.password_salt, auth.password_hash)) {
      throw new Error('CURRENT_PASSWORD_INCORRECT');
    }
    if (passwordsMatch(newPassword, auth.password_salt, auth.password_hash)) {
      throw new Error('NEW_PASSWORD_MUST_DIFFER');
    }
    const salt = saltFactory();
    database.prepare(`
      UPDATE admin_auth
      SET password_hash = ?, password_salt = ?, updated_at = ?
      WHERE id = 1
    `).run(hashPassword(newPassword, salt), salt, now().toISOString());
  }

  bootstrapInitialCredential();
  return {
    changePassword,
    completeInitialPasswordChange,
    getStatus,
    login,
  };
}

module.exports = {
  ADMIN_CREDENTIAL_STATES,
  createAdminAuthService,
};
