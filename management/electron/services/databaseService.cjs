const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { MIGRATIONS, migrateDatabase } = require('./migrations.cjs');

function removeDatabaseFiles(databasePath) {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

function assertDatabaseIntegrity(database) {
  const result = database.pragma('integrity_check', { simple: true });
  if (result !== 'ok') throw new Error(`DATABASE_INTEGRITY_CHECK_FAILED:${result}`);
}

function createBackup(database, databasePath, now) {
  const backupRoot = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  let backupPath = path.join(backupRoot, `management-${stamp}.sqlite3`);
  let suffix = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(backupRoot, `management-${stamp}-${suffix}.sqlite3`);
    suffix += 1;
  }

  database.pragma('wal_checkpoint(TRUNCATE)');
  const escapedPath = backupPath.replace(/'/g, "''");
  database.exec(`VACUUM INTO '${escapedPath}'`);
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    assertDatabaseIntegrity(backup);
  } finally {
    backup.close();
  }
  return backupPath;
}

function createDatabaseService({
  databasePath,
  migrate = migrateDatabase,
  now = () => new Date(),
}) {
  if (!databasePath) throw new Error('databasePath is required');
  const isMemory = databasePath === ':memory:';
  const existedBefore = !isMemory && fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0;
  const isNewDatabase = isMemory || !existedBefore;
  if (!isMemory) fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  let backupPath = null;
  try {
    database.pragma('foreign_keys = ON');
    if (!isMemory) database.pragma('journal_mode = WAL');

    const currentVersion = database.pragma('user_version', { simple: true });
    const targetVersion = MIGRATIONS.at(-1)?.version || currentVersion;
    const usesCustomMigration = migrate !== migrateDatabase;
    if (existedBefore && (usesCustomMigration || currentVersion < targetVersion)) {
      backupPath = createBackup(database, databasePath, now);
    }

    migrate(database);
    assertDatabaseIntegrity(database);
  } catch (error) {
    if (database.open) database.close();
    if (!isMemory && backupPath) {
      removeDatabaseFiles(databasePath);
      fs.copyFileSync(backupPath, databasePath);
    } else if (!isMemory && !existedBefore) {
      removeDatabaseFiles(databasePath);
    }
    throw error;
  }

  function runMigration() {
    migrate(database);
    assertDatabaseIntegrity(database);
  }

  return {
    backupPath,
    database,
    isNewDatabase,
    migrate: runMigration,
    close: () => {
      if (database.open) database.close();
    },
  };
}

module.exports = { assertDatabaseIntegrity, createDatabaseService };
