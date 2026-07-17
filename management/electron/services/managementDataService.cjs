const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

function getFixedManagementDataRoot({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    return path.join(localAppData, 'JatoDigital', 'OpenJatoBID-Management');
  }
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'JatoDigital', 'OpenJatoBID-Management');
  }
  const dataHome = env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
  return path.join(dataHome, 'JatoDigital', 'OpenJatoBID-Management');
}

function removePartialDatabase(databasePath) {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

function verifyDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`DATABASE_INTEGRITY_CHECK_FAILED:${integrity}`);
  } finally {
    database.close();
  }
}

async function copyDatabaseSafely(source, destination) {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
}

async function prepareFixedManagementDatabase({
  fixedDataRoot = getFixedManagementDataRoot(),
  legacyDatabasePath,
  copyDatabase = copyDatabaseSafely,
} = {}) {
  const databasePath = path.join(fixedDataRoot, 'management.sqlite3');
  fs.mkdirSync(fixedDataRoot, { recursive: true });
  if (fs.existsSync(databasePath)) {
    verifyDatabase(databasePath);
    return { databasePath, migratedFrom: null };
  }
  if (!legacyDatabasePath || !fs.existsSync(legacyDatabasePath)) {
    return { databasePath, migratedFrom: null };
  }

  try {
    await copyDatabase(legacyDatabasePath, databasePath);
    verifyDatabase(databasePath);
    return { databasePath, migratedFrom: legacyDatabasePath };
  } catch (error) {
    removePartialDatabase(databasePath);
    throw error;
  }
}

module.exports = {
  copyDatabaseSafely,
  getFixedManagementDataRoot,
  prepareFixedManagementDatabase,
};
