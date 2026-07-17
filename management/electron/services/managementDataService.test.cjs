const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createDatabaseService } = require('./databaseService.cjs');
const {
  getFixedManagementDataRoot,
  prepareFixedManagementDatabase,
} = require('./managementDataService.cjs');

test('uses a fixed Jato management data directory independent of product version or userData', () => {
  const localAppData = path.join('C:\\Users\\Tester', 'AppData', 'Local');
  const first = getFixedManagementDataRoot({
    platform: 'win32',
    env: { LOCALAPPDATA: localAppData },
    homeDir: 'C:\\Users\\Tester',
  });
  const afterUpgrade = getFixedManagementDataRoot({
    platform: 'win32',
    env: { LOCALAPPDATA: localAppData },
    homeDir: 'C:\\Users\\Tester',
  });

  assert.equal(first, path.join(localAppData, 'JatoDigital', 'OpenJatoBID-Management'));
  assert.equal(afterUpgrade, first);
});

test('migrates a real legacy database to the fixed directory and keeps the legacy file as fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-management-data-move-'));
  const legacyDatabasePath = path.join(root, 'legacy-user-data', 'management.sqlite3');
  const fixedDataRoot = path.join(root, 'fixed-data');
  try {
    const legacy = createDatabaseService({ databasePath: legacyDatabasePath });
    legacy.database.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run('server_config', '{"host":"0.0.0.0","port":47821}', '2026-07-10T00:00:00.000Z');
    legacy.close();

    const prepared = await prepareFixedManagementDatabase({ fixedDataRoot, legacyDatabasePath });
    assert.equal(prepared.databasePath, path.join(fixedDataRoot, 'management.sqlite3'));
    assert.equal(prepared.migratedFrom, legacyDatabasePath);
    assert.equal(fs.existsSync(legacyDatabasePath), true);
    assert.equal(fs.existsSync(prepared.databasePath), true);
    const migrated = new Database(prepared.databasePath, { readonly: true });
    assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(migrated.prepare('SELECT value_json FROM settings WHERE key = ?').get('server_config').value_json.includes('47821'), true);
    migrated.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copy failure keeps the legacy database and does not leave an empty fixed database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-management-data-failure-'));
  const legacyDatabasePath = path.join(root, 'legacy-user-data', 'management.sqlite3');
  const fixedDataRoot = path.join(root, 'fixed-data');
  try {
    const legacy = createDatabaseService({ databasePath: legacyDatabasePath });
    legacy.close();

    await assert.rejects(
      prepareFixedManagementDatabase({
        fixedDataRoot,
        legacyDatabasePath,
        async copyDatabase(_source, destination) {
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, 'partial');
          throw new Error('FORCED_COPY_FAILURE');
        },
      }),
      /FORCED_COPY_FAILURE/,
    );
    assert.equal(fs.existsSync(legacyDatabasePath), true);
    assert.equal(fs.existsSync(path.join(fixedDataRoot, 'management.sqlite3')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
