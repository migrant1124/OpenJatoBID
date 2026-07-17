const crypto = require('node:crypto');

const LICENSE_DAYS_OFFLINE = 30;
const REVOCATION_RETENTION_DAYS = 30;
const WATCH_TOKEN_TTL_MS = 5 * 60 * 1000;
const WATCH_ACK_TTL_MS = 5 * 60 * 1000;

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeDeviceCode(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addUtcYears(date, years) {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function createAuthorizationService({
  database,
  signingService,
  now = () => new Date(),
  idFactory = (prefix) => `${prefix}-${crypto.randomUUID()}`,
  watchTokenFactory = () => crypto.randomBytes(24).toString('base64url'),
}) {
  const getApplicationRow = database.prepare('SELECT * FROM authorization_applications WHERE id = ?');
  const getLicenseRow = database.prepare('SELECT * FROM licenses WHERE id = ?');
  const getDeviceRow = database.prepare('SELECT * FROM devices WHERE id = ?');
  const getEmployeeRow = database.prepare('SELECT * FROM employees WHERE id = ?');
  const watchTokens = new Map();
  const watchersByLicense = new Map();

  function bindingKey(device) {
    const deviceCode = normalizeDeviceCode(device.device_code);
    if (deviceCode) return `${device.employee_id}:code:${deviceCode}`;
    if (device.client_id) return `${device.employee_id}:client:${device.client_id}`;
    return `${device.employee_id}:fingerprint:${device.device_fingerprint}`;
  }

  function pruneWatchTokens() {
    const timestamp = now().getTime();
    for (const [token, entry] of watchTokens) {
      if (
        entry.expiresAtMs <= timestamp
        && entry.subscriberCount === 0
        && entry.ackExpiresAtMs <= timestamp
      ) {
        watchTokens.delete(token);
      }
    }
  }

  function issueWatchToken(licenseId) {
    pruneWatchTokens();
    const token = watchTokenFactory();
    const expiresAtMs = now().getTime() + WATCH_TOKEN_TTL_MS;
    watchTokens.set(token, {
      licenseId,
      expiresAtMs,
      subscriberCount: 0,
      ackExpiresAtMs: 0,
    });
    return { watchToken: token, watchExpiresAt: new Date(expiresAtMs).toISOString() };
  }

  function readWatchToken(token, purpose = 'subscribe') {
    pruneWatchTokens();
    const entry = watchTokens.get(String(token || '')) || null;
    if (!entry) return null;
    const timestamp = now().getTime();
    if (purpose === 'ack') return entry.ackExpiresAtMs > timestamp ? entry : null;
    return entry.expiresAtMs > timestamp ? entry : null;
  }

  function readLicenseEnvelope(licenseId) {
    const license = getLicenseRow.get(licenseId);
    return license?.license_envelope_json ? JSON.parse(license.license_envelope_json) : null;
  }

  function publicApplication(row, { includeWatchToken = false } = {}) {
    if (!row) return null;
    const license = row.license_id ? getLicenseRow.get(row.license_id) : null;
    const revocation = row.license_id
      ? database.prepare('SELECT license_id FROM authorization_revocations WHERE license_id = ?').get(row.license_id)
      : null;
    const effectiveLicenseStatus = license?.status === 'ACTIVE'
      && new Date(license.expires_at).getTime() <= now().getTime()
      ? 'EXPIRED'
      : license?.status;
    let status = row.status;
    if (row.status === 'APPROVED' && (revocation || !license || effectiveLicenseStatus === 'REVOKED')) status = 'REVOKED';
    if (row.status === 'APPROVED' && effectiveLicenseStatus === 'EXPIRED') status = 'EXPIRED';
    const result = {
      id: row.id,
      name: row.employee_name,
      phone: row.phone,
      deviceFingerprint: row.device_fingerprint,
      clientId: row.client_id,
      platform: row.platform,
      arch: row.arch,
      status,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      license: status === 'APPROVED' ? readLicenseEnvelope(row.license_id) : null,
    };
    if (row.device_code) {
      result.deviceCode = row.device_code;
      result.deviceCodeVersion = row.device_code_version || null;
    }
    if (includeWatchToken && status === 'APPROVED' && result.license) {
      Object.assign(result, issueWatchToken(row.license_id));
    }
    return result;
  }

  function markExpiredLicenses(at) {
    database.prepare(`
      UPDATE licenses
      SET status = 'EXPIRED', updated_at = ?
      WHERE status = 'ACTIVE' AND expires_at <= ?
    `).run(at, at);
  }

  function createLicenseEnvelope({ license, employee, device, verifiedAt }) {
    const expiry = new Date(license.expires_at);
    const offlineLimit = addUtcDays(new Date(verifiedAt), LICENSE_DAYS_OFFLINE);
    const offlineValidUntil = new Date(Math.min(expiry.getTime(), offlineLimit.getTime())).toISOString();
    const payload = {
      licenseId: license.id,
      employeeId: employee.id,
      deviceId: device.id,
      name: employee.name,
      phone: employee.phone,
      deviceFingerprint: device.device_fingerprint,
      clientId: device.client_id,
      platform: device.platform,
      arch: device.arch,
      issuedAt: license.issued_at,
      expiresAt: license.expires_at,
      verifiedAt,
      offlineValidUntil,
    };
    if (normalizeDeviceCode(device.device_code)) {
      payload.deviceCode = device.device_code;
      payload.deviceCodeVersion = device.device_code_version || null;
    }
    return signingService.signLicense(payload);
  }

  function submitApplication(input) {
    const normalizedName = normalizeName(input.name);
    const normalizedPhone = normalizePhone(input.phone);
    const deviceCode = normalizeDeviceCode(input.deviceCode);
    const pending = deviceCode
      ? database.prepare(`
          SELECT id FROM authorization_applications
          WHERE normalized_name = ? AND normalized_phone = ? AND device_code = ? AND status = 'PENDING'
        `).get(normalizedName, normalizedPhone, deviceCode)
      : database.prepare(`
          SELECT id FROM authorization_applications
          WHERE normalized_name = ? AND normalized_phone = ? AND device_fingerprint = ? AND status = 'PENDING'
        `).get(normalizedName, normalizedPhone, input.deviceFingerprint);
    if (pending) throw new Error('APPLICATION_CONFLICT');

    const submittedAt = now().toISOString();
    const id = idFactory('application');
    database.prepare(`
      INSERT INTO authorization_applications (
        id, employee_name, phone, normalized_name, normalized_phone,
        device_fingerprint, client_id, platform, arch, device_code, device_code_version,
        status, submitted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      id,
      normalizedName,
      normalizedPhone,
      normalizedName,
      normalizedPhone,
      input.deviceFingerprint,
      input.clientId,
      input.platform,
      input.arch,
      deviceCode || null,
      deviceCode ? (input.deviceCodeVersion || null) : null,
      submittedAt,
      submittedAt,
    );
    return publicApplication(getApplicationRow.get(id));
  }

  function getApplication(id) {
    return publicApplication(getApplicationRow.get(id), { includeWatchToken: true });
  }

  function resolveDeviceCandidates(employee, input, { reportAmbiguous = false } = {}) {
    const deviceCode = normalizeDeviceCode(input.deviceCode ?? input.device_code);
    const deviceFingerprint = input.deviceFingerprint ?? input.device_fingerprint;
    const clientId = input.clientId ?? input.client_id;
    const legacyDevices = database.prepare(`
      SELECT * FROM devices
      WHERE employee_id = ? AND (device_code IS NULL OR device_code = '')
      ORDER BY updated_at DESC, id ASC
    `).all(employee.id);

    if (!deviceCode) {
      const exactFingerprint = database.prepare(`
        SELECT * FROM devices WHERE employee_id = ? AND device_fingerprint = ?
      `).get(employee.id, deviceFingerprint);
      if (!exactFingerprint) {
        const clientMatches = clientId
          ? legacyDevices.filter((device) => device.client_id === clientId)
          : [];
        return clientMatches.length
          ? { device: clientMatches[0], mergeCandidates: clientMatches }
          : null;
      }
      const duplicates = exactFingerprint.client_id
        ? legacyDevices.filter((device) => device.client_id === exactFingerprint.client_id)
        : [exactFingerprint];
      return {
        device: exactFingerprint,
        mergeCandidates: duplicates.some((device) => device.id === exactFingerprint.id)
          ? duplicates
          : [exactFingerprint, ...duplicates],
      };
    }

    const exactCode = database.prepare(`
      SELECT * FROM devices WHERE employee_id = ? AND device_code = ?
    `).get(employee.id, deviceCode);
    if (exactCode) {
      const duplicates = exactCode.client_id
        ? legacyDevices.filter((device) => device.client_id === exactCode.client_id)
        : [];
      return { device: exactCode, mergeCandidates: [exactCode, ...duplicates] };
    }

    const fingerprintMatches = legacyDevices.filter((device) => device.device_fingerprint === deviceFingerprint);
    if (fingerprintMatches.length === 1) {
      const matched = fingerprintMatches[0];
      const duplicates = matched.client_id
        ? legacyDevices.filter((device) => device.client_id === matched.client_id)
        : [matched];
      return { device: matched, mergeCandidates: duplicates };
    }
    if (fingerprintMatches.length > 1) {
      const sharedClientId = fingerprintMatches[0].client_id;
      if (sharedClientId && fingerprintMatches.every((device) => device.client_id === sharedClientId)) {
        const duplicates = legacyDevices.filter((device) => device.client_id === sharedClientId);
        return { device: fingerprintMatches[0], mergeCandidates: duplicates };
      }
      return reportAmbiguous ? 'DEVICE_MIGRATION_CONFLICT' : null;
    }

    const clientMatches = clientId
      ? legacyDevices.filter((device) => device.client_id === clientId)
      : [];
    if (clientMatches.length >= 1) {
      return { device: clientMatches[0], mergeCandidates: clientMatches };
    }
    if (reportAmbiguous && legacyDevices.length > 1) return 'DEVICE_MIGRATION_CONFLICT';
    return null;
  }

  function findApplicationDevice(employee, application) {
    return resolveDeviceCandidates(employee, application);
  }

  function countActiveBindings(employeeId) {
    const rows = database.prepare(`
      SELECT d.* FROM devices d
      JOIN licenses l ON l.device_id = d.id
      WHERE d.employee_id = ? AND d.status = 'ACTIVE' AND l.status = 'ACTIVE'
    `).all(employeeId);
    return new Set(rows.map(bindingKey)).size;
  }

  function mergeLegacyBindingDuplicates(employee) {
    const legacyDevices = database.prepare(`
      SELECT * FROM devices
      WHERE employee_id = ? AND (device_code IS NULL OR device_code = '')
      ORDER BY updated_at DESC, id ASC
    `).all(employee.id);
    const groups = new Map();
    for (const device of legacyDevices) {
      if (!device.client_id && !device.device_fingerprint) continue;
      const key = bindingKey(device);
      const candidates = groups.get(key) || [];
      candidates.push(device);
      groups.set(key, candidates);
    }
    for (const candidates of groups.values()) {
      if (candidates.length > 1) mergeDuplicateDevices(employee, candidates);
    }
  }

  function approveApplication(applicationId) {
    return database.transaction(() => {
      const decidedAt = now().toISOString();
      markExpiredLicenses(decidedAt);
      const application = getApplicationRow.get(applicationId);
      if (!application) throw new Error('APPLICATION_NOT_FOUND');
      if (!['PENDING', 'DEVICE_LIMIT'].includes(application.status)) throw new Error('APPLICATION_NOT_PENDING');

      let employee = database.prepare(`
        SELECT * FROM employees WHERE normalized_name = ? AND normalized_phone = ?
      `).get(application.normalized_name, application.normalized_phone);
      if (!employee) {
        const employeeId = idFactory('employee');
        database.prepare(`
          INSERT INTO employees (id, name, phone, normalized_name, normalized_phone, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          employeeId,
          application.employee_name,
          application.phone,
          application.normalized_name,
          application.normalized_phone,
          decidedAt,
          decidedAt,
        );
        employee = getEmployeeRow.get(employeeId);
      }

      mergeLegacyBindingDuplicates(employee);
      const resolution = findApplicationDevice(employee, application);
      let device = resolution
        ? resolution.mergeCandidates.length > 1
          ? mergeDuplicateDevices(employee, resolution.mergeCandidates)
          : resolution.device
        : null;
      const existingActiveLicense = device
        ? database.prepare("SELECT id FROM licenses WHERE device_id = ? AND status = 'ACTIVE'").get(device.id)
        : null;
      if (!existingActiveLicense && countActiveBindings(employee.id) >= 3) {
        database.prepare(`
          UPDATE authorization_applications SET status = 'DEVICE_LIMIT', decided_at = ?, employee_id = ?, updated_at = ?
          WHERE id = ?
        `).run(decidedAt, employee.id, decidedAt, applicationId);
        return publicApplication(getApplicationRow.get(applicationId));
      }

      if (!device) {
        const deviceId = idFactory('device');
        database.prepare(`
          INSERT INTO devices (
            id, employee_id, device_fingerprint, client_id, platform, arch,
            device_code, device_code_version, status, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
        `).run(
          deviceId,
          employee.id,
          application.device_fingerprint,
          application.client_id,
          application.platform,
          application.arch,
          normalizeDeviceCode(application.device_code) || null,
          application.device_code_version || null,
          decidedAt,
          decidedAt,
          decidedAt,
        );
        device = getDeviceRow.get(deviceId);
      } else {
        database.prepare(`
          UPDATE devices SET client_id = ?, platform = ?, arch = ?,
            device_code = COALESCE(NULLIF(?, ''), device_code),
            device_code_version = COALESCE(?, device_code_version),
            status = 'ACTIVE', last_seen_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          application.client_id,
          application.platform,
          application.arch,
          normalizeDeviceCode(application.device_code),
          application.device_code_version || null,
          decidedAt,
          decidedAt,
          device.id,
        );
        device = getDeviceRow.get(device.id);
      }

      const issuedAt = decidedAt;
      const expiresAt = addUtcYears(new Date(issuedAt), 1).toISOString();
      let license = database.prepare('SELECT * FROM licenses WHERE device_id = ?').get(device.id);
      if (!license) {
        const licenseId = idFactory('license');
        database.prepare(`
          INSERT INTO licenses (
            id, employee_id, device_id, status, issued_at, expires_at, last_verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
        `).run(licenseId, employee.id, device.id, issuedAt, expiresAt, issuedAt, issuedAt, issuedAt);
        license = getLicenseRow.get(licenseId);
      } else {
        database.prepare(`
          UPDATE licenses
          SET employee_id = ?, status = 'ACTIVE', issued_at = ?, expires_at = ?, last_verified_at = ?,
              revoked_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(employee.id, issuedAt, expiresAt, issuedAt, issuedAt, license.id);
        license = getLicenseRow.get(license.id);
      }

      const envelope = createLicenseEnvelope({ license, employee, device, verifiedAt: issuedAt });
      database.prepare('UPDATE licenses SET license_envelope_json = ? WHERE id = ?')
        .run(JSON.stringify(envelope), license.id);
      database.prepare(`
        UPDATE authorization_applications
        SET status = 'APPROVED', decided_at = ?, employee_id = ?, device_id = ?, license_id = ?, updated_at = ?
        WHERE id = ?
      `).run(decidedAt, employee.id, device.id, license.id, decidedAt, applicationId);
      return publicApplication(getApplicationRow.get(applicationId), { includeWatchToken: true });
    })();
  }

  function rejectApplication(applicationId) {
    const decidedAt = now().toISOString();
    const result = database.prepare(`
      UPDATE authorization_applications
      SET status = 'REJECTED', decided_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('PENDING', 'DEVICE_LIMIT')
    `).run(decidedAt, decidedAt, applicationId);
    if (!result.changes) throw new Error('APPLICATION_NOT_PENDING');
    return publicApplication(getApplicationRow.get(applicationId));
  }

  function refreshActiveLicense(license, employee, device) {
    const verifiedAt = now().toISOString();
    markExpiredLicenses(verifiedAt);
    license = getLicenseRow.get(license.id);
    if (!license) return { status: 'NOT_AUTHORIZED' };
    if (license.status === 'REVOKED' || device.status === 'REVOKED') return { status: 'REVOKED' };
    if (license.status === 'EXPIRED' || new Date(license.expires_at).getTime() <= new Date(verifiedAt).getTime()) {
      return { status: 'EXPIRED' };
    }
    const envelope = createLicenseEnvelope({ license, employee, device, verifiedAt });
    database.prepare(`
      UPDATE licenses SET last_verified_at = ?, license_envelope_json = ?, updated_at = ? WHERE id = ?
    `).run(verifiedAt, JSON.stringify(envelope), verifiedAt, license.id);
    database.prepare('UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?')
      .run(verifiedAt, verifiedAt, device.id);
    return { status: 'ACTIVE', license: envelope, ...issueWatchToken(license.id) };
  }

  function findRevocationForLogin(employeeId, input) {
    const deviceCode = normalizeDeviceCode(input.deviceCode);
    if (deviceCode) {
      const byCode = database.prepare(`
        SELECT * FROM authorization_revocations WHERE employee_id = ? AND device_code = ?
      `).get(employeeId, deviceCode);
      if (byCode) return byCode;
    }
    if (!input.deviceFingerprint) return null;
    return database.prepare(`
      SELECT * FROM authorization_revocations
      WHERE employee_id = ? AND legacy_device_fingerprint = ?
    `).get(employeeId, input.deviceFingerprint) || null;
  }

  function findLoginDevice(employee, input) {
    return resolveDeviceCandidates(employee, input, { reportAmbiguous: true });
  }

  function mergeDuplicateDevices(employee, candidates) {
    const entries = candidates.map((device) => ({
      device,
      license: database.prepare('SELECT * FROM licenses WHERE device_id = ?').get(device.id) || null,
    }));
    const timestamp = (value) => {
      const parsed = Date.parse(value || '');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    entries.sort((left, right) => {
      const activeDifference = Number(right.license?.status === 'ACTIVE') - Number(left.license?.status === 'ACTIVE');
      if (activeDifference) return activeDifference;
      const verifiedDifference = timestamp(right.license?.last_verified_at) - timestamp(left.license?.last_verified_at);
      if (verifiedDifference) return verifiedDifference;
      const updatedDifference = timestamp(right.device.updated_at) - timestamp(left.device.updated_at);
      if (updatedDifference) return updatedDifference;
      return left.device.id.localeCompare(right.device.id);
    });

    const canonical = entries[0];
    const licenses = entries.map((entry) => entry.license).filter(Boolean);
    const retainedLicense = canonical.license || licenses[0] || null;
    const targetStatus = licenses.some((license) => license.status === 'ACTIVE')
      ? 'ACTIVE'
      : licenses.some((license) => license.status === 'EXPIRED')
        ? 'EXPIRED'
        : 'REVOKED';
    const maxExpiresAt = licenses.map((license) => license.expires_at).filter(Boolean).sort().at(-1) || null;
    const maxVerifiedAt = licenses.map((license) => license.last_verified_at).filter(Boolean).sort().at(-1) || null;

    for (const entry of entries) {
      if (entry.device.id === canonical.device.id) continue;
      database.prepare(`
        UPDATE authorization_applications
        SET device_id = ?, license_id = ?
        WHERE device_id = ? OR license_id = ?
      `).run(canonical.device.id, retainedLicense?.id || null, entry.device.id, entry.license?.id || '');
      database.prepare('UPDATE analytics_events SET device_id = ? WHERE device_id = ?')
        .run(canonical.device.id, entry.device.id);
    }

    for (const license of licenses) {
      if (license.id === retainedLicense?.id) continue;
      database.prepare('DELETE FROM licenses WHERE id = ?').run(license.id);
      watchersByLicense.delete(license.id);
      for (const [token, entry] of watchTokens) {
        if (entry.licenseId === license.id) watchTokens.delete(token);
      }
    }
    if (retainedLicense && retainedLicense.device_id !== canonical.device.id) {
      database.prepare('UPDATE licenses SET device_id = ? WHERE id = ?')
        .run(canonical.device.id, retainedLicense.id);
    }
    for (const entry of entries) {
      if (entry.device.id !== canonical.device.id) {
        database.prepare('DELETE FROM devices WHERE id = ?').run(entry.device.id);
      }
    }

    if (retainedLicense) {
      database.prepare(`
        UPDATE licenses
        SET employee_id = ?, status = ?, expires_at = ?, last_verified_at = ?,
          revoked_at = CASE WHEN ? = 'REVOKED' THEN revoked_at ELSE NULL END,
          license_envelope_json = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        employee.id,
        targetStatus,
        maxExpiresAt,
        maxVerifiedAt,
        targetStatus,
        now().toISOString(),
        retainedLicense.id,
      );
    }
    database.prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ?')
      .run(targetStatus === 'REVOKED' ? 'REVOKED' : 'ACTIVE', now().toISOString(), canonical.device.id);
    return getDeviceRow.get(canonical.device.id);
  }

  function login(input) {
    const employee = database.prepare(`
      SELECT * FROM employees WHERE normalized_name = ? AND normalized_phone = ?
    `).get(normalizeName(input.name), normalizePhone(input.phone));
    if (!employee) return { status: 'NOT_AUTHORIZED' };
    markExpiredLicenses(now().toISOString());

    const resolution = findLoginDevice(employee, input);
    if (resolution === 'DEVICE_MIGRATION_CONFLICT') return { status: resolution };
    if (!resolution) {
      return findRevocationForLogin(employee.id, input)
        ? { status: 'REVOKED' }
        : { status: 'NOT_AUTHORIZED' };
    }

    const deviceCode = normalizeDeviceCode(input.deviceCode);
    let device = database.transaction(() => {
      let currentDevice = resolution.mergeCandidates.length > 1
        ? mergeDuplicateDevices(employee, resolution.mergeCandidates)
        : resolution.device;
      if (!deviceCode) return currentDevice;
      const loginAt = now().toISOString();
      database.prepare(`
          UPDATE devices SET device_code = ?, device_code_version = ?,
            client_id = ?,
            platform = COALESCE(NULLIF(?, ''), platform), arch = COALESCE(NULLIF(?, ''), arch),
            updated_at = ?
          WHERE id = ?
        `).run(
        deviceCode,
        input.deviceCodeVersion || null,
        input.clientId || currentDevice.client_id,
        input.platform || '',
        input.arch || '',
        loginAt,
        currentDevice.id,
      );
      currentDevice = getDeviceRow.get(currentDevice.id);
      return currentDevice;
    })();

    const license = database.prepare('SELECT * FROM licenses WHERE device_id = ?').get(device.id);
    if (!license) {
      return findRevocationForLogin(employee.id, input)
        ? { status: 'REVOKED' }
        : { status: 'NOT_AUTHORIZED' };
    }
    return refreshActiveLicense(license, employee, device);
  }

  function verifyLicense({ licenseId, deviceCode, deviceFingerprint }) {
    const revocation = database.prepare(`
      SELECT license_id FROM authorization_revocations WHERE license_id = ?
    `).get(licenseId);
    if (revocation) return { status: 'REVOKED' };
    const license = getLicenseRow.get(licenseId);
    if (!license) return { status: 'NOT_AUTHORIZED' };
    const device = getDeviceRow.get(license.device_id);
    const employee = getEmployeeRow.get(license.employee_id);
    if (!device || !employee) return { status: 'NOT_AUTHORIZED' };
    const storedDeviceCode = normalizeDeviceCode(device.device_code);
    const inputDeviceCode = normalizeDeviceCode(deviceCode);
    const matches = storedDeviceCode && inputDeviceCode
      ? storedDeviceCode === inputDeviceCode
      : device.device_fingerprint === deviceFingerprint;
    if (!matches) return { status: 'DEVICE_MISMATCH' };
    return refreshActiveLicense(license, employee, device);
  }

  function subscribeRevocations(token, listener) {
    const entry = readWatchToken(token);
    if (!entry || typeof listener !== 'function') throw new Error('INVALID_WATCH_TOKEN');
    let active = true;
    let delivered = false;
    const subscribedListener = (event) => {
      if (!active || delivered) return;
      delivered = true;
      listener(event);
    };
    let listeners = watchersByLicense.get(entry.licenseId);
    if (!listeners) {
      listeners = new Set();
      watchersByLicense.set(entry.licenseId, listeners);
    }
    listeners.add(subscribedListener);
    entry.subscriberCount += 1;

    const revocation = database.prepare(`
      SELECT license_id, revoked_at FROM authorization_revocations WHERE license_id = ?
    `).get(entry.licenseId);
    if (revocation) {
      entry.ackExpiresAtMs = Math.max(
        entry.ackExpiresAtMs,
        now().getTime() + WATCH_ACK_TTL_MS,
      );
      queueMicrotask(() => subscribedListener({
        status: 'REVOKED',
        licenseId: revocation.license_id,
        revokedAt: revocation.revoked_at,
      }));
    }

    return () => {
      if (!active) return;
      active = false;
      listeners.delete(subscribedListener);
      entry.subscriberCount = Math.max(0, entry.subscriberCount - 1);
      if (!listeners.size) watchersByLicense.delete(entry.licenseId);
      pruneWatchTokens();
    };
  }

  function revokeLicense(licenseId) {
    const revokedAt = now().toISOString();
    const license = getLicenseRow.get(licenseId);
    if (!license) throw new Error('LICENSE_NOT_FOUND');
    const device = getDeviceRow.get(license.device_id);
    if (!device) throw new Error('DEVICE_NOT_FOUND');
    const purgeAfter = addUtcDays(new Date(revokedAt), REVOCATION_RETENTION_DAYS).toISOString();
    database.transaction(() => {
      database.prepare(`
        INSERT INTO authorization_revocations (
          id, license_id, employee_id, device_code, legacy_device_fingerprint,
          revoked_at, acknowledged_at, purge_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        idFactory('revocation'),
        license.id,
        license.employee_id,
        normalizeDeviceCode(device.device_code) || null,
        device.device_fingerprint,
        revokedAt,
        purgeAfter,
        revokedAt,
      );
      database.prepare('DELETE FROM licenses WHERE id = ?').run(license.id);
      database.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
    })();

    pruneWatchTokens();
    const ackExpiresAtMs = now().getTime() + WATCH_ACK_TTL_MS;
    for (const entry of watchTokens.values()) {
      if (entry.licenseId === licenseId && entry.subscriberCount > 0) {
        entry.ackExpiresAtMs = Math.max(entry.ackExpiresAtMs, ackExpiresAtMs);
      }
    }
    const event = { status: 'REVOKED', licenseId, revokedAt };
    for (const listener of [...(watchersByLicense.get(licenseId) || [])]) listener(event);
    return { status: 'REVOKED' };
  }

  function acknowledgeRevocation(token) {
    const entry = readWatchToken(token, 'ack');
    if (!entry) throw new Error('INVALID_WATCH_TOKEN');
    const acknowledgedAt = now().toISOString();
    const result = database.transaction(() => {
      database.prepare(`
        UPDATE authorization_revocations SET acknowledged_at = ? WHERE license_id = ?
      `).run(acknowledgedAt, entry.licenseId);
      return database.prepare(`
        DELETE FROM authorization_revocations WHERE license_id = ? AND acknowledged_at IS NOT NULL
      `).run(entry.licenseId).changes;
    })();
    watchTokens.delete(String(token));
    watchersByLicense.delete(entry.licenseId);
    return result;
  }

  function cleanupRevocations() {
    const expired = database.prepare(`
      SELECT license_id FROM authorization_revocations
      WHERE acknowledged_at IS NOT NULL OR purge_after <= ?
    `).all(now().toISOString());
    if (!expired.length) {
      pruneWatchTokens();
      return 0;
    }
    const licenseIds = new Set(expired.map((row) => row.license_id));
    const result = database.prepare(`
      DELETE FROM authorization_revocations
      WHERE acknowledged_at IS NOT NULL OR purge_after <= ?
    `).run(now().toISOString()).changes;
    for (const [token, entry] of watchTokens) {
      if (licenseIds.has(entry.licenseId)) watchTokens.delete(token);
    }
    for (const licenseId of licenseIds) watchersByLicense.delete(licenseId);
    pruneWatchTokens();
    return result;
  }

  function renewLicense(licenseId) {
    const renewedAt = now().toISOString();
    const license = getLicenseRow.get(licenseId);
    if (!license) throw new Error('LICENSE_NOT_FOUND');
    const employee = getEmployeeRow.get(license.employee_id);
    const device = getDeviceRow.get(license.device_id);
    const expiresAt = addUtcYears(new Date(renewedAt), 1).toISOString();
    database.prepare(`
      UPDATE licenses SET status = 'ACTIVE', issued_at = ?, expires_at = ?, last_verified_at = ?,
        revoked_at = NULL, updated_at = ? WHERE id = ?
    `).run(renewedAt, expiresAt, renewedAt, renewedAt, licenseId);
    database.prepare("UPDATE devices SET status = 'ACTIVE', updated_at = ? WHERE id = ?")
      .run(renewedAt, device.id);
    const updatedLicense = getLicenseRow.get(licenseId);
    const envelope = createLicenseEnvelope({ license: updatedLicense, employee, device: { ...device, status: 'ACTIVE' }, verifiedAt: renewedAt });
    database.prepare('UPDATE licenses SET license_envelope_json = ? WHERE id = ?')
      .run(JSON.stringify(envelope), licenseId);
    return { status: 'ACTIVE', license: envelope, ...issueWatchToken(licenseId) };
  }

  function listApplications() {
    return database.prepare('SELECT * FROM authorization_applications ORDER BY submitted_at DESC').all().map((row) => publicApplication(row));
  }

  function listEmployees() {
    markExpiredLicenses(now().toISOString());
    const employees = database.prepare(`
      SELECT DISTINCT e.* FROM employees e
      JOIN devices d ON d.employee_id = e.id
      JOIN licenses l ON l.device_id = d.id
      WHERE d.status = 'ACTIVE' AND l.status IN ('ACTIVE', 'EXPIRED')
      ORDER BY e.created_at DESC
    `).all();
    const readDevices = database.prepare(`
      SELECT d.*, l.id AS license_id, l.status AS license_status, l.expires_at, l.last_verified_at
      FROM devices d
      JOIN licenses l ON l.device_id = d.id
      WHERE d.employee_id = ? AND d.status = 'ACTIVE' AND l.status IN ('ACTIVE', 'EXPIRED')
      ORDER BY d.created_at ASC
    `);
    return employees.map((employee) => {
      const deviceRows = readDevices.all(employee.id);
      const devices = deviceRows.map((device) => {
        const result = {
          id: device.id,
          clientId: device.client_id,
          platform: device.platform,
          arch: device.arch,
          status: device.status,
          lastSeenAt: device.last_seen_at,
          licenseId: device.license_id,
          licenseStatus: device.license_status,
          expiresAt: device.expires_at,
          lastVerifiedAt: device.last_verified_at,
        };
        if (device.device_code) {
          result.deviceCode = device.device_code;
          result.deviceCodeVersion = device.device_code_version || null;
        }
        return result;
      });
      const activeBindings = new Set(
        deviceRows.filter((device) => device.license_status === 'ACTIVE').map(bindingKey),
      );
      return {
        id: employee.id,
        name: employee.name,
        phone: employee.phone,
        createdAt: employee.created_at,
        activeDeviceCount: activeBindings.size,
        devices,
      };
    });
  }

  function getSummary() {
    markExpiredLicenses(now().toISOString());
    const applicationCount = database.prepare('SELECT COUNT(*) AS count FROM authorization_applications').get().count;
    const pendingApplicationCount = database.prepare(`
      SELECT COUNT(*) AS count FROM authorization_applications WHERE status IN ('PENDING', 'DEVICE_LIMIT')
    `).get().count;
    const activeRows = database.prepare(`
      SELECT d.* FROM devices d
      JOIN licenses l ON l.device_id = d.id
      WHERE d.status = 'ACTIVE' AND l.status = 'ACTIVE'
    `).all();
    return {
      applicationCount,
      pendingApplicationCount,
      employeeCount: database.prepare(`
        SELECT COUNT(DISTINCT d.employee_id) AS count
        FROM devices d JOIN licenses l ON l.device_id = d.id
        WHERE d.status = 'ACTIVE' AND l.status IN ('ACTIVE', 'EXPIRED')
      `).get().count,
      activeDeviceBindingCount: new Set(activeRows.map(bindingKey)).size,
    };
  }

  return {
    acknowledgeRevocation,
    approveApplication,
    cleanupRevocations,
    getApplication,
    getSummary,
    listApplications,
    listEmployees,
    login,
    rejectApplication,
    renewLicense,
    revokeLicense,
    submitApplication,
    subscribeRevocations,
    verifyLicense,
  };
}

module.exports = {
  LICENSE_DAYS_OFFLINE,
  REVOCATION_RETENTION_DAYS,
  WATCH_ACK_TTL_MS,
  WATCH_TOKEN_TTL_MS,
  createAuthorizationService,
  normalizeName,
  normalizePhone,
};
