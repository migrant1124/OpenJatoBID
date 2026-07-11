const crypto = require('node:crypto');

const SIGNING_CONFIG_KEY = 'license_signing_key';

function serializeLicensePayload(value) {
  if (Array.isArray(value)) return `[${value.map(serializeLicensePayload).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serializeLicensePayload(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createSigningService({ database }) {
  function readConfig() {
    const row = database.prepare('SELECT value_json FROM settings WHERE key = ?').get(SIGNING_CONFIG_KEY);
    return row ? JSON.parse(row.value_json) : null;
  }

  function ensureConfig() {
    const existing = readConfig();
    if (existing) return existing;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const config = {
      issuerId: crypto.randomUUID(),
      publicKey,
      privateKey,
      createdAt: new Date().toISOString(),
    };
    database.prepare(`
      INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    `).run(SIGNING_CONFIG_KEY, JSON.stringify(config), config.createdAt);
    return config;
  }

  function getPublicKey() {
    return ensureConfig().publicKey;
  }

  function getIssuerId() {
    return ensureConfig().issuerId;
  }

  function signLicense(payload) {
    const config = ensureConfig();
    const signature = crypto.sign(
      'sha256',
      Buffer.from(serializeLicensePayload(payload)),
      config.privateKey,
    ).toString('base64');
    return {
      algorithm: 'ECDSA_P256_SHA256',
      issuerId: config.issuerId,
      publicKey: config.publicKey,
      payload,
      signature,
    };
  }

  ensureConfig();
  return { getIssuerId, getPublicKey, signLicense };
}

module.exports = { createSigningService, serializeLicensePayload };
