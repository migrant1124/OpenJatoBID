const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createLanManagementClient } = require('./lanManagementClient.cjs');
const { createDeviceBootstrapStore } = require('./deviceBootstrapStore.cjs');
const { normalizeLanServerAddress } = require('./lanServerAddress.cjs');
const { getLicenseFilePath } = require('../utils/paths.cjs');

const packageJson = require('../../package.json');

const FINGERPRINT_VERSION = '2026-01';
const DEVICE_CODE_VERSION = 'jato-device-v1';
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

function getStableOsMachineId() {
  return process.platform === 'win32'
    ? readWindowsMachineGuid()
    : process.platform === 'darwin'
      ? readMacMachineId()
      : readLinuxMachineId();
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

function createDeviceCode({
  appId = APP_ID,
  platform = process.platform,
  machineId,
  deviceCodeVersion = DEVICE_CODE_VERSION,
}) {
  const normalizedMachineId = String(machineId || '').trim().toLowerCase();
  if (!normalizedMachineId) return '';
  return hashHex(`${appId}|${platform}|${normalizedMachineId}|${deviceCodeVersion}`);
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
  deviceCodeFactory,
  deviceBootstrapStore: explicitBootstrapStore,
  lanClientFactory = (options) => createLanManagementClient(options),
  reconnectDelay = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    timer.unref?.();
  }),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  debugLicenseDisabled: explicitDebugDisabled,
}) {
  const licenseFile = getLicenseFilePath(app);
  const bootstrapStore = explicitBootstrapStore || createDeviceBootstrapStore();
  const debugLicenseDisabled = explicitDebugDisabled
    ?? (!app.isPackaged && process.env.YIBIAO_REQUIRE_LAN_LICENSE !== '1');
  let currentStatus = null;
  let verifyPromise = null;
  let lifecycleTimer = null;
  let watchAbortController = null;
  let watchGeneration = 0;
  let watchTask = null;
  let latestWatchToken = '';
  let closed = false;
  const statusListeners = new Set();

  function buildContext() {
    const config = configStore.load();
    const bootstrap = bootstrapStore.load() || {};
    const configuredLan = config.lan_management || {};
    const configuredManagementPublicKey = String(configuredLan.management_public_key || '');
    const bootstrapManagementPublicKey = String(bootstrap.managementPublicKey || '');
    const clientId = config.analytics_client_id || '';
    const machineFingerprintHash = machineFingerprintFactory
      ? machineFingerprintFactory({ clientId })
      : createMachineFingerprintHash({ clientId });
    const deviceCode = deviceCodeFactory
      ? String(deviceCodeFactory({
        appId: APP_ID,
        platform: process.platform,
        deviceCodeVersion: DEVICE_CODE_VERSION,
      }) || '')
      : createDeviceCode({ machineId: getStableOsMachineId() });
    return {
      config,
      bootstrap,
      managementPublicKeyConflict: Boolean(
        configuredManagementPublicKey
        && bootstrapManagementPublicKey
        && configuredManagementPublicKey !== bootstrapManagementPublicKey
      ),
      lan: {
        ...configuredLan,
        server_address: configuredLan.server_address || bootstrap.serverAddress || '',
        management_public_key: configuredManagementPublicKey || bootstrapManagementPublicKey,
      },
      clientId,
      deviceCode,
      machineFingerprintHash,
    };
  }

  function deviceIdentityPayload(context) {
    return {
      ...(context.deviceCode ? {
        deviceCode: context.deviceCode,
        deviceCodeVersion: DEVICE_CODE_VERSION,
      } : {}),
      deviceFingerprint: context.machineFingerprintHash,
      clientId: context.clientId,
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
      deviceCode: context.deviceCode,
      deviceCodeVersion: context.deviceCode ? DEVICE_CODE_VERSION : '',
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

  function emitStatus(status) {
    for (const listener of statusListeners) {
      try { listener(status); } catch {}
    }
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

  function deviceMatches(payload, context) {
    if (payload.deviceCode) {
      return Boolean(context.deviceCode) && payload.deviceCode === context.deviceCode;
    }
    return payload.deviceFingerprint === context.machineFingerprintHash;
  }

  async function evaluateLocalLicense(identity) {
    if (debugLicenseDisabled) return debugStatus();
    const context = buildContext();
    const envelope = normalizeEnvelope(readJson(licenseFile));
    if (!envelope) return createStatus({ context });
    if (context.managementPublicKeyConflict) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_public_key_changed' });
    }
    const pinnedKey = String(context.lan.management_public_key || '');
    if (!pinnedKey || pinnedKey !== envelope.publicKey || !verifyEnvelopeSignature(envelope)) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_signature_invalid' });
    }
    if (!deviceMatches(envelope.payload, context)) {
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
    if (envelope.local.serverStatus === 'NOT_AUTHORIZED') {
      return createStatus({ context, status: 'not_authorized', licenseStatus: 'not_authorized', sourceTrusted: true, sourceTrustedText: 'true', untrustedReason: '' });
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

  function saveBootstrap(patch) {
    return bootstrapStore.save(patch);
  }

  function acceptRemoteLicense(envelopeValue, identity, serverAddress) {
    const context = buildContext();
    const envelope = normalizeEnvelope(envelopeValue);
    if (!envelope || !verifyEnvelopeSignature(envelope)) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_signature_invalid' });
    }
    if (context.managementPublicKeyConflict) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_public_key_changed' });
    }
    const pinnedKey = String(context.lan.management_public_key || '');
    if (pinnedKey && pinnedKey !== envelope.publicKey) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'management_public_key_changed' });
    }
    if (!deviceMatches(envelope.payload, context)
      || normalizeIdentity(identity.name) !== normalizeIdentity(envelope.payload.name)
      || normalizePhone(identity.phone) !== normalizePhone(envelope.payload.phone)) {
      return createStatus({ context, status: 'invalid', licenseStatus: 'invalid', untrustedReason: 'license_identity_mismatch' });
    }
    const normalizedServer = normalizeLanServerAddress(serverAddress || context.lan.server_address).serverAddress;
    const storedEnvelope = {
      ...envelope,
      local: {
        savedAt: now().toISOString(),
        lastAttemptAt: now().toISOString(),
        serverConfirmedAt: now().toISOString(),
        serverStatus: 'ACTIVE',
      },
    };
    writeJsonAtomic(licenseFile, storedEnvelope);
    saveLanConfig(context, {
      server_address: normalizedServer,
      employee_name: normalizeIdentity(identity.name),
      employee_phone: normalizePhone(identity.phone),
      management_public_key: envelope.publicKey,
    });
    saveBootstrap({
      serverAddress: normalizedServer,
      managementPublicKey: envelope.publicKey,
    });
    return statusFromEnvelope(storedEnvelope, buildContext(), { offline: false, serverReachable: true });
  }

  function recordServerStatus(serverStatus, details = {}) {
    const envelope = normalizeEnvelope(readJson(licenseFile));
    if (envelope) {
      const confirmedAt = now().toISOString();
      writeJsonAtomic(licenseFile, {
        ...envelope,
        local: {
          ...envelope.local,
          serverStatus,
          lastAttemptAt: confirmedAt,
          serverConfirmedAt: confirmedAt,
          ...(serverStatus === 'REVOKED' ? { revokedAt: details.revokedAt || confirmedAt } : {}),
          ...(serverStatus === 'NOT_AUTHORIZED' ? { notAuthorizedAt: confirmedAt } : {}),
        },
      });
    }
  }

  function remoteStatus(serverStatus, partial = {}) {
    const map = {
      REVOKED: 'revoked',
      EXPIRED: 'expired',
      DEVICE_MISMATCH: 'machine_mismatch',
      NOT_AUTHORIZED: 'not_authorized',
    };
    const status = map[serverStatus] || 'invalid';
    return createStatus({
      status,
      licenseStatus: status,
      sourceTrusted: ['REVOKED', 'EXPIRED', 'DEVICE_MISMATCH', 'NOT_AUTHORIZED'].includes(serverStatus),
      sourceTrustedText: ['REVOKED', 'EXPIRED', 'DEVICE_MISMATCH', 'NOT_AUTHORIZED'].includes(serverStatus) ? 'true' : 'false',
      untrustedReason: '',
      serverReachable: true,
      ...partial,
    });
  }

  async function testServer(serverAddress) {
    const normalized = normalizeLanServerAddress(serverAddress);
    const data = await lanClientFactory({ serverAddress: normalized.serverAddress }).health();
    saveBootstrap({ serverAddress: normalized.serverAddress });
    return { success: true, serverAddress: normalized.serverAddress, data };
  }

  async function submitApplication({ name, phone, serverAddress }) {
    const normalized = normalizeLanServerAddress(serverAddress);
    const context = buildContext();
    const input = {
      name: normalizeIdentity(name),
      phone: normalizePhone(phone),
      ...deviceIdentityPayload(context),
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
    saveBootstrap({ serverAddress: normalized.serverAddress });
    return application;
  }

  async function getApplicationStatus() {
    const context = buildContext();
    if (!context.lan.server_address || !context.lan.application_id) throw new Error('APPLICATION_NOT_CONFIGURED');
    const application = await lanClientFactory({ serverAddress: context.lan.server_address })
      .getApplication(context.lan.application_id);
    let runtimeStatus = null;
    if (application.status === 'APPROVED' && application.license) {
      runtimeStatus = activateRemoteResult(application, {
        name: context.lan.employee_name,
        phone: context.lan.employee_phone,
      }, context.lan.server_address);
    }
    return { ...application, runtimeStatus };
  }

  function stopRealtimeWatch() {
    watchGeneration += 1;
    watchAbortController?.abort();
    watchAbortController = null;
    watchTask = null;
    latestWatchToken = '';
  }

  function handleRealtimeEvent(event, { watchToken, client }) {
    const serverStatus = String(event?.status || '').toUpperCase();
    if (!['REVOKED', 'NOT_AUTHORIZED'].includes(serverStatus)) return;
    recordServerStatus(serverStatus, event);
    const status = remoteStatus(serverStatus);
    stopRealtimeWatch();
    emitStatus(status);
    if (serverStatus === 'REVOKED') {
      try {
        void Promise.resolve(client.acknowledgeRevocation({ watchToken })).catch(() => {});
      } catch {}
    }
  }

  function startRealtimeWatch({ serverAddress, watchToken }) {
    const normalizedToken = String(watchToken || '');
    if (closed || !serverAddress || !normalizedToken) return;
    stopRealtimeWatch();
    latestWatchToken = normalizedToken;
    const generation = watchGeneration;
    const controller = new AbortController();
    watchAbortController = controller;

    watchTask = (async () => {
      let token = normalizedToken;
      let reconnecting = false;
      while (!closed && generation === watchGeneration && !controller.signal.aborted) {
        if (reconnecting) {
          await reconnectDelay();
          if (closed || generation !== watchGeneration || controller.signal.aborted) return;
          const verified = await verify({ startWatch: false });
          emitStatus(verified);
          if (verified.status !== 'active') return;
          if (closed || generation !== watchGeneration || controller.signal.aborted) return;
          if (!verified.serverReachable) continue;
          token = latestWatchToken;
          if (!token) return;
        }
        const client = lanClientFactory({ serverAddress });
        try {
          await client.watchAuthorization({
            watchToken: token,
            signal: controller.signal,
            onEvent: (event) => handleRealtimeEvent(event, { watchToken: token, client }),
          });
        } catch {
          if (closed || generation !== watchGeneration || controller.signal.aborted) return;
        }
        reconnecting = true;
      }
    })();
    void watchTask.catch(() => {});
  }

  function activateRemoteResult(result, identity, serverAddress, { startWatch = true } = {}) {
    const status = acceptRemoteLicense(result.license, identity, serverAddress);
    if (status.status !== 'active') return status;
    latestWatchToken = String(result.watchToken || '');
    if (startWatch && latestWatchToken) {
      startRealtimeWatch({ serverAddress: status.serverAddress, watchToken: latestWatchToken });
    }
    return status;
  }

  async function login({ name, phone, serverAddress }) {
    if (debugLicenseDisabled) return debugStatus();
    const context = buildContext();
    const identity = { name: normalizeIdentity(name), phone: normalizePhone(phone) };
    const resolvedServerAddress = serverAddress
      ? normalizeLanServerAddress(serverAddress).serverAddress
      : context.lan.server_address;
    if (!resolvedServerAddress) return evaluateLocalLicense(identity);
    try {
      const result = await lanClientFactory({ serverAddress: resolvedServerAddress }).login({
        ...identity,
        ...deviceIdentityPayload(context),
      });
      if (result.status === 'ACTIVE' && result.license) {
        return activateRemoteResult(result, identity, resolvedServerAddress);
      }
      if (['REVOKED', 'EXPIRED', 'DEVICE_MISMATCH', 'NOT_AUTHORIZED'].includes(result.status)) {
        recordServerStatus(result.status, result);
        stopRealtimeWatch();
      }
      return remoteStatus(result.status);
    } catch (error) {
      const localStatus = await evaluateLocalLicense(identity);
      return { ...localStatus, offline: localStatus.status === 'active', serverReachable: false, refreshError: error.message };
    }
  }

  async function performVerify({ startWatch = true } = {}) {
    if (debugLicenseDisabled) return debugStatus();
    const context = buildContext();
    const envelope = normalizeEnvelope(readJson(licenseFile));
    if (!envelope || !context.lan.server_address) return evaluateLocalLicense();
    try {
      const result = await lanClientFactory({ serverAddress: context.lan.server_address }).verify({
        licenseId: envelope.payload.licenseId,
        ...deviceIdentityPayload(context),
      });
      if (result.status === 'ACTIVE' && result.license) {
        return activateRemoteResult(result, {
          name: envelope.payload.name,
          phone: envelope.payload.phone,
        }, context.lan.server_address, { startWatch });
      }
      latestWatchToken = '';
      if (['REVOKED', 'EXPIRED', 'DEVICE_MISMATCH', 'NOT_AUTHORIZED'].includes(result.status)) {
        recordServerStatus(result.status, result);
        stopRealtimeWatch();
      }
      return remoteStatus(result.status);
    } catch (error) {
      if (!startWatch) latestWatchToken = '';
      const localStatus = await evaluateLocalLicense();
      return { ...localStatus, offline: localStatus.status === 'active', serverReachable: false, refreshError: error.message };
    }
  }

  function verify(options) {
    if (verifyPromise) return verifyPromise;
    verifyPromise = performVerify(options).finally(() => { verifyPromise = null; });
    return verifyPromise;
  }

  function startLifecycle() {
    if (lifecycleTimer) return;
    lifecycleTimer = setIntervalFn(() => verify().then(emitStatus).catch(() => {}), 30 * 60 * 1000);
    lifecycleTimer?.unref?.();
  }

  function close() {
    closed = true;
    stopRealtimeWatch();
    if (lifecycleTimer) clearIntervalFn(lifecycleTimer);
    lifecycleTimer = null;
    statusListeners.clear();
  }

  async function refreshOnStartup() {
    return emitStatus(await verify());
  }

  return {
    getLicenseFilePath: () => licenseFile,
    getStatus: () => evaluateLocalLicense(),
    getCurrentStatus: () => currentStatus,
    getApplicationStatus,
    login,
    onStatusChanged(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    refresh: verify,
    refreshOnStartup,
    startLifecycle,
    submitApplication,
    testServer,
    verify,
    close,
  };
}

module.exports = {
  DEVICE_CODE_VERSION,
  createDeviceCode,
  createLicenseService,
  createMachineFingerprintHash,
  serializeLicensePayload,
  verifyEnvelopeSignature,
};
