const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE admin_auth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        temp_password_hash TEXT,
        temp_password_salt TEXT,
        temp_password_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        normalized_phone TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (normalized_name, normalized_phone)
      );

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        device_fingerprint TEXT NOT NULL,
        client_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        arch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (employee_id, device_fingerprint)
      );

      CREATE TABLE authorization_applications (
        id TEXT PRIMARY KEY,
        employee_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        normalized_phone TEXT NOT NULL,
        device_fingerprint TEXT NOT NULL,
        client_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        arch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'DEVICE_LIMIT')),
        submitted_at TEXT NOT NULL,
        decided_at TEXT,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        license_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE licenses (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        device_id TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE analytics_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        source_ip TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX idx_applications_status_submitted
        ON authorization_applications(status, submitted_at DESC);
      CREATE INDEX idx_devices_employee_status
        ON devices(employee_id, status);
      CREATE INDEX idx_licenses_employee_status
        ON licenses(employee_id, status);
      CREATE INDEX idx_analytics_received_type
        ON analytics_events(received_at, event_type);
      CREATE INDEX idx_analytics_client_received
        ON analytics_events(client_id, received_at);

      CREATE TRIGGER licenses_active_device_limit_insert
      BEFORE INSERT ON licenses
      WHEN NEW.status = 'ACTIVE' AND (
        SELECT COUNT(*) FROM licenses
        WHERE employee_id = NEW.employee_id AND status = 'ACTIVE'
      ) >= 3
      BEGIN
        SELECT RAISE(ABORT, 'EMPLOYEE_DEVICE_LIMIT');
      END;

      CREATE TRIGGER licenses_active_device_limit_update
      BEFORE UPDATE OF status, employee_id ON licenses
      WHEN NEW.status = 'ACTIVE' AND (
        SELECT COUNT(*) FROM licenses
        WHERE employee_id = NEW.employee_id AND status = 'ACTIVE' AND id <> NEW.id
      ) >= 3
      BEGIN
        SELECT RAISE(ABORT, 'EMPLOYEE_DEVICE_LIMIT');
      END;
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE licenses ADD COLUMN license_envelope_json TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE admin_auth_v3 (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        credential_state TEXT NOT NULL CHECK (
          credential_state IN ('LEGACY', 'INITIAL_PASSWORD_REQUIRED', 'OWNER_PASSWORD_ACTIVE')
        ),
        initial_credential_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO admin_auth_v3 (
        id, username, password_hash, password_salt, credential_state,
        initial_credential_version, created_at, updated_at
      )
      SELECT
        id, '', password_hash, password_salt, 'LEGACY', NULL, created_at, updated_at
      FROM admin_auth;

      DROP TABLE admin_auth;
      ALTER TABLE admin_auth_v3 RENAME TO admin_auth;
      DELETE FROM settings WHERE key = 'smtp_config';
    `,
  },
];

function migrateDatabase(database) {
  const currentVersion = database.pragma('user_version', { simple: true });
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    database.transaction(() => {
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}

module.exports = { MIGRATIONS, migrateDatabase };
