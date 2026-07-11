const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createDatabaseService } = require('./databaseService.cjs');
const { MIGRATIONS, migrateDatabase } = require('./migrations.cjs');

test('creates the phase-two schema and can reopen it idempotently', () => {
  const service = createDatabaseService({ databasePath: ':memory:' });
  const tables = service.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);

  assert.equal(service.database.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(
    ['admin_auth', 'analytics_events', 'authorization_applications', 'devices', 'employees', 'licenses', 'settings'].filter((name) => !tables.includes(name)),
    [],
  );
  assert.doesNotThrow(() => service.migrate());
  service.close();
});

test('migrates legacy administrator data without removing authorization, analytics, or signing data', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(MIGRATIONS[0].sql);
  database.pragma('user_version = 1');
  database.exec(MIGRATIONS[1].sql);
  database.pragma('user_version = 2');

  const now = '2026-07-10T00:00:00.000Z';
  const expiresAt = '2027-07-10T00:00:00.000Z';
  database.prepare(`
    INSERT INTO admin_auth (
      id, password_hash, password_salt, must_change_password,
      temp_password_hash, temp_password_salt, temp_password_expires_at,
      created_at, updated_at
    ) VALUES (1, 'legacy-hash', 'legacy-salt', 1, 'temp-hash', 'temp-salt', ?, ?, ?)
  `).run(expiresAt, now, now);
  database.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES
      ('smtp_config', '{"authorizationCode":"legacy-secret"}', ?),
      ('server_config', '{"host":"0.0.0.0","port":47821}', ?),
      ('license_signing_key', '{"issuerId":"issuer-1"}', ?)
  `).run(now, now, now);
  database.prepare(`
    INSERT INTO employees (id, name, phone, normalized_name, normalized_phone, created_at, updated_at)
    VALUES ('employee-1', '张三', '13800138000', '张三', '13800138000', ?, ?)
  `).run(now, now);
  database.prepare(`
    INSERT INTO devices (id, employee_id, device_fingerprint, client_id, platform, arch, created_at, updated_at)
    VALUES ('device-1', 'employee-1', 'fingerprint-1', 'client-1', 'win32', 'x64', ?, ?)
  `).run(now, now);
  database.prepare(`
    INSERT INTO licenses (id, employee_id, device_id, status, issued_at, expires_at, last_verified_at, created_at, updated_at)
    VALUES ('license-1', 'employee-1', 'device-1', 'ACTIVE', ?, ?, ?, ?, ?)
  `).run(now, expiresAt, now, now, now);
  database.prepare(`
    INSERT INTO analytics_events (
      event_id, event_type, client_id, employee_id, device_id, source_ip,
      occurred_at, received_at, payload_json
    ) VALUES ('event-1', 'page_view', 'client-1', 'employee-1', 'device-1', '127.0.0.1', ?, ?, '{}')
  `).run(now, now);

  migrateDatabase(database);
  migrateDatabase(database);

  assert.equal(database.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(database.prepare('SELECT username, credential_state FROM admin_auth WHERE id = 1').get(), {
    username: '',
    credential_state: 'LEGACY',
  });
  assert.equal(database.prepare("SELECT 1 FROM pragma_table_info('admin_auth') WHERE name LIKE 'temp_%'").get(), undefined);
  assert.equal(database.prepare('SELECT 1 FROM settings WHERE key = ?').get('smtp_config'), undefined);
  assert.equal(database.prepare('SELECT 1 FROM settings WHERE key = ?').get('server_config')['1'], 1);
  assert.equal(database.prepare('SELECT 1 FROM settings WHERE key = ?').get('license_signing_key')['1'], 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM employees').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM devices').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count, 1);
  database.close();
});

test('database trigger prevents a fourth active device license for one employee', () => {
  const service = createDatabaseService({ databasePath: ':memory:' });
  const now = '2026-07-10T00:00:00.000Z';
  const expiresAt = '2027-07-10T00:00:00.000Z';
  service.database.prepare(`
    INSERT INTO employees (id, name, phone, normalized_name, normalized_phone, created_at, updated_at)
    VALUES ('employee-1', '张三', '13800138000', '张三', '13800138000', ?, ?)
  `).run(now, now);

  for (let index = 1; index <= 4; index += 1) {
    service.database.prepare(`
      INSERT INTO devices (id, employee_id, device_fingerprint, client_id, platform, arch, created_at, updated_at)
      VALUES (?, 'employee-1', ?, ?, 'win32', 'x64', ?, ?)
    `).run(`device-${index}`, `fingerprint-${index}`, `client-${index}`, now, now);
  }

  const insertLicense = service.database.prepare(`
    INSERT INTO licenses (id, employee_id, device_id, status, issued_at, expires_at, last_verified_at, created_at, updated_at)
    VALUES (?, 'employee-1', ?, 'ACTIVE', ?, ?, ?, ?, ?)
  `);
  for (let index = 1; index <= 3; index += 1) {
    insertLicense.run(`license-${index}`, `device-${index}`, now, expiresAt, now, now, now);
  }

  assert.throws(
    () => insertLicense.run('license-4', 'device-4', now, expiresAt, now, now, now),
    /EMPLOYEE_DEVICE_LIMIT/,
  );
  service.close();
});
