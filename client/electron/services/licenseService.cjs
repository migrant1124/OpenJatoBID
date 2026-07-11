const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createLanManagementClient } = require('./lanManagementClient.cjs');
const { normalizeLanServerAddress } = require('./lanServerAddress.cjs');
const { getLicenseFilePath } = require('../utils/paths.cjs');

const packageJson = require('../../package.json');

const FINGERPRINT_VERSION = '2026-01';
const SIGNATURE_ALGORITHM = 'ECDSA_P256_SHA256';
const PROJECT_NAME = packageJson.name || 'jatoaibid';
const APP_ID = packageJson.build?.appId || 'com.jdt.jatoaibid';

function serializeLicensePayload(value) {
  if (Array.isArray(value)) return `[${value.map(serializeLicensePayload).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serializeLicensePayload(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashHex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function readWindowsMachineGuid() {
  try {
    const output = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
    });
    return output.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

function readMacMachineId() {
  try {
    const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 3000 });
    return output.match(/"IOPlatformUUID"\s+=\s+"([^"]+)"/)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

function readLinuxMachineId() {
  for (const filePath of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = fs.readFileSync(filePath, 'utf8').trim();
      if (value) return value;
    } catch {}
  }
  return '';
}

function getOsMachineId() {
  const value = process.platform === 'win32'
    ? readWindowsMachineGuid()
    : process.platform === 'darwin'
      ? readMacMachineId()
      : readLinuxMachineId();
  return value || `${process.platform}:${os.hostname()}`;
}

function getMacFingerprint() {
  const macs = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      const mac = String(item.mac || '').toLowerCase();
      if (!mac || mac === '00:00:00:00:00:00' || item.internal) continue;
      macs.push(mac);
    }
  }
  return hashHex(Array.from(new Set(macs)).sort().join('|'));
}

function createMachineFingerprintHash({ clientId }) {
  return hashHex(`${PROJECT_NAME}${APP_ID}${clientId}${getOsMachineId()}${getMacFingerprint()}${FINGERPRINT_VERSION}`);
}

function normalizeIdentity(value) {
  return String(value ?? '').trim();
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(require('node:path').dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch {}
    throw error;
  }
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== 'object' || !value.payload || !value.signature || !value.publicKey) return null;
  return {
    algorithm: String(value.algorithm || ''),
    issuerId: String(value.issuerId || ''),
    publicKey: String(value.publicKey || ''),
    payload: value.payload,
    signature: String(value.signature || ''),
    local: value.local && typeof value.local === 'object' ? value.local : {},
  };
}

function verifyEnvelopeSignature(envelope) {
  if (envelope.algorithm !== SIGNATURE_ALGORITHM) return false;
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(serializeLicensePayload(envelope.payload)),
      envelope.publicKey,
      Buffer.from(envelope.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function createLicenseService({
  app,
  configStore,
  now = () => new Date(),
  machineFingerprintFactory,
  lanClientFactory = (options) => createLanManagementClient(options),
  debugLicenseDisabled: explicitDebugDisabled,
}) {
  const licenseFile = getLicenseFilePath(app);
  const debugLicenseDisabled = explicitDebugDisabled
    ?? (!app.isPackaged && process.env.YIBIAO_REQUIRE_LAN_LICENSE !== '1');
  let currentStatus = null;
  let verifyPromise = null;

  function buildContext() {
    const config = configStore.load();
    const clientId = config.analytics_client_id || '';
    const machineFingerprintHash = machineFingerprintFactory
      ? machineFingerprintFactory({ clientId })
      : createMachineFingerprintHash({ clientId });
    return {
      config,
      lan: config.lan_management || {},
      clientId,
      machineFingerprintHash,
    };
  }

  function createStatus(partial = {}) {
    const context = partial.context || buildContext();
    const status = {
      status: 'missing',
      plan: 'enterprise_premium',
      expiresAt: '',
      licenseExpiresAt: '',
      licenseStatus: 'missing',
      activationMode: 'lan',
      sourceTrusted: false,
      sourceTrustedText: 'false',
      untrustedReason: 'license_missing',
      machineFingerprintHash: context.machineFingerprintHash,
      fingerprintVersion: FINGERPRINT_VERSION,
      buildTrusted: true,
      buildChanged: false,
      buildId: packageJson.version || '',
      keyId: '',
      lastCheckedAt: now().toISOString(),
      lastVerifiedAt: '',
      offlineValidUntil: '',
      serverAddress: context.lan.server_address || '',
      employeeName: context.lan.employee_name || '',
      employeePhone: context.lan.employee_phone || '',
      offline: false,
      serverReachable: false,
      message: '',
      config: {
        freeLicenseDays: 30,
        expirePopupEnabled: true,
        expirePopupDismissible: false,
      },
      ...partial,
    };
    delete status.context;
    currentStatus = status;
    return status;
  }

  function debugStatus() {
    return createStatus({
      status: 'debug_disabled',
      licenseStatus: 'debug_disabled',
      sourceTrusted: true,
      sourceTrustedText: 'true',
      untrustedReason: '',
      serverReachable: true,
      config: { freeLicenseDays: 30, expirePopupEnabled: false, expirePopupDismissible: true },
    });
  }

  function statusFromEnvelope(envelope, context, partial = {}) {
    const payload = envelope.payload;
    return createStatus({
      context,
      status: 'active',
      licenseStatus: 'active',
      expiresAt: payload.expiresAt || '',
      licenseExpiresAt: payload.expiresAt || '',
      sourceTrusted: true,
      sourceTrustedText: 'true',
      untrustedReason: '',
      keyId: envelope.issuerId,
      lastVerifiedAt: payload.verifiedAt || '',
      offlineValidUntil: payload.offlineValidUntil || '',
      employeeName: payload.name || context.lan.employee_name || '',
      employeePhone: payload.phone || context.lan.employee_phone || '',
      ...partial,
    });
  }

  async function evaluateLocalLicense(identity) {
    if (debugLicenseDisabled) return debugStatus();
    const context = buildContext();
    const envelope = normalizeEnvelope(readJson(licenseFile));
    if (!envelope) return createStatus({ context });
    const pinnedKey = String(context.lan.management_public_key || '');
    if (!pinnedKey || pinnedKey !== envelope.publicKey || !verifyEnvelopeSignature(envelope)) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_signature_invalid' });
    }
    if (envelope.payload.deviceFingerprint !== context.machineFingerprintHash) {
      return createStatus({ context, status: 'machine_mismatch', licenseStatus: 'machine_mismatch', untrustedReason: 'device_mismatch' });
    }
    if (identity && (
      normalizeIdentity(identity.name) !== normalizeIdentity(envelope.payload.name)
      || normalizePhone(identity.phone) !== normalizePhone(envelope.payload.phone)
    )) {
      return createStatus({ context, status: 'identity_mismatch', licenseStatus: 'identity_mismatch', sourceTrusted: true, sourceTrustedText: 'true', untrustedReason: '' });
    }
    if (envelope.local.serverStatus === 'REVOKED') {
      return createStatus({ context, status: 'revoked', licenseStatus: 'revoked', sourceTrusted: true, sourceTrustedText: 'true', untrustedReason: '' });
    }
    if (envelope.local.serverStatus === 'EXPIRED' || new Date(envelope.payload.expiresAt).getTime() <= now().getTime()) {
      return createStatus({ context, status: 'expired', licenseStatus: 'expired', sourceTrusted: true, sourceTrustedText: 'true', untrustedReason: '' });
    }
    if (new Date(envelope.payload.offlineValidUntil).getTime() <= now().getTime()) {
      return createStatus({
        context,
        status: 'offline_expired',
        licenseStatus: 'offline_expired',
        sourceTrusted: true,
        sourceTrustedText: 'true',
        untrustedReason: '',
        lastVerifiedAt: envelope.payload.verifiedAt || '',
        offlineValidUntil: envelope.payload.offlineValidUntil || '',
        expiresAt: envelope.payload.expiresAt || '',
        licenseExpiresAt: envelope.payload.expiresAt || '',
      });
    }
    return statusFromEnvelope(envelope, context, { offline: true, serverReachable: false });
  }

  function saveLanConfig(context, patch) {
    configStore.save({
      ...context.config,
      lan_management: { ...context.lan, ...patch },
    });
  }

  function acceptRemoteLicense(envelopeValue, identity, serverAddress) {
    const context = buildContext();
    const envelope = normalizeEnvelope(envelopeValue);
    if (!envelope || !verifyEnvelopeSignature(envelope)) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_signature_invalid' });
    }
    const pinnedKey = String(context.lan.management_public_key || '');
    if (pinnedKey && pinnedKey !== envelope.publicKey) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_public_key_changed' });
    }
    if (envelope.payload.deviceFingerprint !== context.machineFingerprintHash
      || normalizeIdentity(identity.name) !== normalizeIdentity(envelope.payload.name)
      || normalizePhone(identity.phone) !== normalizePhone(envelope.payload.phone)) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'license_identity_mismatch' });
    }
    const normalizedServer = normalizeLanServerAddress(serverAddress || context.lan.server_address).serverAddress;
    const storedEnvelope = {
      ...envelope,
      local: { savedAt: now().toISOString(), lastAttemptAt: now().toISOString(), serverStatus: 'ACTIVE' },
    };
    writeJsonAtomic(licenseFile, storedEnvelope);
    saveLanConfig(context, {
      server_address: normalizedServer,
      employee_name: normalizeIdentity(identity.name),
      employee_phone: normalizePhone(identity.phone),
      management_public_key: envelope.publicKey,
    });
    return statusFromEnvelope(storedEnvelope, buildContext(), { offline: false, serverReachable: true });
  }

  function recordServerStatus(serverStatus) {
    const envelope = normalizeEnvelope(readJson(licenseFile));
    if (envelope) {
      writeJsonAtomic(licenseFile, {
        ...envelope,
        local: { ...envelope.local, serverStatus, lastAttemptAt: now().toISOString() },
      });
    }
  }

  function remoteStatus(serverStatus, partial = {}) {
    const map = {
      REVOKED: 'revoked',
      EXPIRED: 'expired',
      DEVICE_MISMATCH: 'machine_mismatch',
      NOT_AUTHORIZED: 'missing',
    };
    const status = map[serverStatus] || 'invalid';
    return createStatus({
      status,
      licenseStatus: status,
      sourceTrusted: serverStatus !== 'NOT_AUTHORIZED',
      sourceTrustedText: serverStatus !== 'NOT_AUTHORIZED' ? 'true' : 'false',
      untrustedReason: '',
      serverReachable: true,
      ...partial,
    });
  }

  async function testServer(serverAddress) {
    const normalized = normalizeLanServerAddress(serverAddress);
    const data = await lanClientFactory({ serverAddress: normalized.serverAddress }).health();
    return { success: true, serverAddress: normalized.serverAddress, data };
  }

  async function submitApplication({ name, phone, serverAddress }) {
    const normalized = normalizeLanServerAddress(serverAddress);
    const context = buildContext();
    const input = {
      name: normalizeIdentity(name),
      phone: normalizePhone(phone),
      deviceFingerprint: context.machineFingerprintHash,
      clientId: context.clientId,
      platform: process.platform,
      arch: process.arch,
    };
    const application = await lanClientFactory({ serverAddress: normalized.serverAddress }).submitApplication(input);
    saveLanConfig(context, {
      server_address: normalized.serverAddress,
      employee_name: input.name,
      employee_phone: input.phone,
      application_id: application.id,
    });
    return application;
  }

  async function getApplicationStatus() {
    const context = buildContext();
    if (!context.lan.server_address || !context.lan.application_id) throw new Error('APPLICATION_NOT_CONFIGURED');
    const application = await lanClientFactory({ serverAddress: context.lan.server_address })
      .getApplication(context.lan.application_id);
    let runtimeStatus = null;
    if (application.status === 'APPROVED' && application.license) {
      runtimeStatus = acceptRemoteLicense(application.license, {
        name: context.lan.employee_name,
        phone: context.lan.employee_phone,
      }, context.lan.server_address);
    }
    return { ...application, runtimeStatus };
  }

  async function login({ name, phone }) {
    if (debugLicenseDisabled) return debugStatus();
    const context = buildContext();
    const identity = { name: normalizeIdentity(name), phone: normalizePhone(phone) };
    if (!context.lan.server_address) return evaluateLocalLicense(identity);
    try {
      const result = await lanClientFactory({ serverAddress: context.lan.server_address }).login({
        ...identity,
        deviceFingerprint: context.machineFingerprintHash,
        clientId: context.clientId,
      });
      if (result.status === 'ACTIVE' && result.license) {
        return acceptRemoteLicense(result.license, identity, context.lan.server_address);
      }
      if (['REVOKED', 'EXPIRED', 'DEVICE_MISMATCH'].includes(result.status)) recordServerStatus(result.status);
      return remoteStatus(result.status);
    } catch (error) {
      const localStatus = await evaluateLocalLicense(identity);
      return { ...localStatus, offline: localStatus.status === 'active', serverReachable: false, refreshError: error.message };
    }
  }

  async function performVerify() {
    if (debugLicenseDisabled) return debugStatus();
    const context = buildContext();
    const envelope = normalizeEnvelope(readJson(licenseFile));
    if (!envelope || !context.lan.server_address) return evaluateLocalLicense();
    try {
      const result = await lanClientFactory({ serverAddress: context.lan.server_address }).verify({
        licenseId: envelope.payload.licenseId,
        deviceFingerprint: context.machineFingerprintHash,
      });
      if (result.status === 'ACTIVE' && result.license) {
        return acceptRemoteLicense(result.license, {
          name: envelope.payload.name,
          phone: envelope.payload.phone,
        }, context.lan.server_address);
      }
      if (['REVOKED', 'EXPIRED', 'DEVICE_MISMATCH'].includes(result.status)) recordServerStatus(result.status);
      return remoteStatus(result.status);
    } catch (error) {
      const localStatus = await evaluateLocalLicense();
      return { ...localStatus, offline: localStatus.status === 'active', serverReachable: false, refreshError: error.message };
    }
  }

  function verify() {
    if (verifyPromise) return verifyPromise;
    verifyPromise = performVerify().finally(() => { verifyPromise = null; });
    return verifyPromise;
  }

  return {
    getLicenseFilePath: () => licenseFile,
    getStatus: () => evaluateLocalLicense(),
    getCurrentStatus: () => currentStatus,
    getApplicationStatus,
    login,
    refresh: verify,
    refreshOnStartup: verify,
    submitApplication,
    testServer,
    verify,
  };
}

module.exports = {
  createLicenseService,
  createMachineFingerprintHash,
  serializeLicensePayload,
  verifyEnvelopeSignature,
};
