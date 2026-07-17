const fs = require('node:fs');
const path = require('node:path');
const { getDeviceBootstrapFilePath } = require('../utils/paths.cjs');

const SCHEMA_VERSION = 1;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch {}
    throw error;
  }
}

function normalizeBootstrap(value) {
  if (!value || typeof value !== 'object') return null;
  const serverAddress = String(value.serverAddress || '').trim();
  const managementPublicKey = String(value.managementPublicKey || '');
  if (!serverAddress && !managementPublicKey) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    serverAddress,
    managementPublicKey,
    updatedAt: String(value.updatedAt || ''),
  };
}

function createDeviceBootstrapStore({
  filePath = getDeviceBootstrapFilePath(),
  now = () => new Date(),
} = {}) {
  function load() {
    return normalizeBootstrap(readJson(filePath));
  }

  function save(patch = {}) {
    const current = load() || {};
    const next = {
      schemaVersion: SCHEMA_VERSION,
      serverAddress: String(patch.serverAddress ?? current.serverAddress ?? '').trim(),
      managementPublicKey: String(patch.managementPublicKey ?? current.managementPublicKey ?? ''),
      updatedAt: now().toISOString(),
    };
    writeJsonAtomic(filePath, next);
    return next;
  }

  return {
    getFilePath: () => filePath,
    load,
    save,
  };
}

module.exports = {
  createDeviceBootstrapStore,
};
