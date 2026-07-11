const crypto = require('node:crypto');

const LICENSE_DAYS_OFFLINE = 30;

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
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
}) {
  const getApplicationRow = database.prepare('SELECT * FROM authorization_applications WHERE id = ?');
  const getLicenseRow = database.prepare('SELECT * FROM licenses WHERE id = ?');

  function publicApplication(row) {
    if (!row) return null;
    const license = row.license_id ? getLicenseRow.get(row.license_id) : null;
    const effectiveLicenseStatus = license?.status === 'ACTIVE'
      && new Date(license.expires_at).getTime() <= now().getTime()
      ? 'EXPIRED'
      : license?.status;
    const status = row.status === 'APPROVED' && ['REVOKED', 'EXPIRED'].includes(effectiveLicenseStatus)
      ? effectiveLicenseStatus
      : row.status;
    return {
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
  }

  function readLicenseEnvelope(licenseId) {
    const license = getLicenseRow.get(licenseId);
    return license?.license_envelope_json ? JSON.parse(license.license_envelope_json) : null;
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
    return signingService.signLicense({
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
    });
  }

  function submitApplication(input) {
    const normalizedName = normalizeName(input.name);
    const normalizedPhone = normalizePhone(input.phone);
    const pending = database.prepare(`
      SELECT id FROM authorization_applications
      WHERE normalized_name = ? AND normalized_phone = ? AND device_fingerprint = ? AND status = 'PENDING'
    `).get(normalizedName, normalizedPhone, input.deviceFingerprint);
    if (pending) throw new Error('APPLICATION_CONFLICT');

    const submittedAt = now().toISOString();
    const id = idFactory('application');
    database.prepare(`
      INSERT INTO authorization_applications (
        id, employee_name, phone, normalized_name, normalized_phone,
        device_fingerprint, client_id, platform, arch, status, submitted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
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
      submittedAt,
      submittedAt,
    );
    return publicApplication(getApplicationRow.get(id));
  }

  function getApplication(id) {
    return publicApplication(getApplicationRow.get(id));
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
        employee = database.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
      }

      let device = database.prepare(`
        SELECT * FROM devices WHERE employee_id = ? AND device_fingerprint = ?
      `).get(employee.id, application.device_fingerprint);
      const existingActiveLicense = device
        ? database.prepare("SELECT id FROM licenses WHERE device_id = ? AND status = 'ACTIVE'").get(device.id)
        : null;
      const activeCount = database.prepare(`
        SELECT COUNT(*) AS count FROM licenses WHERE employee_id = ? AND status = 'ACTIVE'
      `).get(employee.id).count;
      if (!existingActiveLicense && activeCount >= 3) {
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
            id, employee_id, device_fingerprint, client_id, platform, arch, status, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
        `).run(
          deviceId,
          employee.id,
          application.device_fingerprint,
          application.client_id,
          application.platform,
          application.arch,
          decidedAt,
          decidedAt,
          decidedAt,
        );
        device = database.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
      } else {
        database.prepare(`
          UPDATE devices SET client_id = ?, platform = ?, arch = ?, status = 'ACTIVE', last_seen_at = ?, updated_at = ?
          WHERE id = ?
        `).run(application.client_id, application.platform, application.arch, decidedAt, decidedAt, device.id);
        device = database.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
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
      return publicApplication(getApplicationRow.get(applicationId));
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
    return { status: 'ACTIVE', license: envelope };
  }

  function login(input) {
    const employee = database.prepare(`
      SELECT * FROM employees WHERE normalized_name = ? AND normalized_phone = ?
    `).get(normalizeName(input.name), normalizePhone(input.phone));
    if (!employee) return { status: 'NOT_AUTHORIZED' };
    const device = database.prepare(`
      SELECT * FROM devices WHERE employee_id = ? AND device_fingerprint = ?
    `).get(employee.id, input.deviceFingerprint);
    if (!device) return { status: 'NOT_AUTHORIZED' };
    const license = database.prepare('SELECT * FROM licenses WHERE device_id = ?').get(device.id);
    if (!license) return { status: 'NOT_AUTHORIZED' };
    return refreshActiveLicense(license, employee, device);
  }

  function verifyLicense({ licenseId, deviceFingerprint }) {
    const license = getLicenseRow.get(licenseId);
    if (!license) return { status: 'NOT_AUTHORIZED' };
    const device = database.prepare('SELECT * FROM devices WHERE id = ?').get(license.device_id);
    const employee = database.prepare('SELECT * FROM employees WHERE id = ?').get(license.employee_id);
    if (!device || !employee || device.device_fingerprint !== deviceFingerprint) return { status: 'DEVICE_MISMATCH' };
    return refreshActiveLicense(license, employee, device);
  }

  function revokeLicense(licenseId) {
    const revokedAt = now().toISOString();
    const license = getLicenseRow.get(licenseId);
    if (!license) throw new Error('LICENSE_NOT_FOUND');
    database.transaction(() => {
      database.prepare(`
        UPDATE licenses SET status = 'REVOKED', revoked_at = ?, updated_at = ? WHERE id = ?
      `).run(revokedAt, revokedAt, licenseId);
      database.prepare("UPDATE devices SET status = 'REVOKED', updated_at = ? WHERE id = ?")
        .run(revokedAt, license.device_id);
    })();
    return { status: 'REVOKED' };
  }

  function renewLicense(licenseId) {
    const renewedAt = now().toISOString();
    const license = getLicenseRow.get(licenseId);
    if (!license) throw new Error('LICENSE_NOT_FOUND');
    const employee = database.prepare('SELECT * FROM employees WHERE id = ?').get(license.employee_id);
    const device = database.prepare('SELECT * FROM devices WHERE id = ?').get(license.device_id);
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
    return { status: 'ACTIVE', license: envelope };
  }

  function listApplications() {
    return database.prepare('SELECT * FROM authorization_applications ORDER BY submitted_at DESC').all().map(publicApplication);
  }

  function listEmployees() {
    markExpiredLicenses(now().toISOString());
    const employees = database.prepare('SELECT * FROM employees ORDER BY created_at DESC').all();
    const readDevices = database.prepare(`
      SELECT d.*, l.id AS license_id, l.status AS license_status, l.expires_at, l.last_verified_at
      FROM devices d
      LEFT JOIN licenses l ON l.device_id = d.id
      WHERE d.employee_id = ?
      ORDER BY d.created_at ASC
    `);
    return employees.map((employee) => {
      const devices = readDevices.all(employee.id).map((device) => ({
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
      }));
      return {
        id: employee.id,
        name: employee.name,
        phone: employee.phone,
        createdAt: employee.created_at,
        activeDeviceCount: devices.filter((device) => device.licenseStatus === 'ACTIVE').length,
        devices,
      };
    });
  }

  return {
    approveApplication,
    getApplication,
    listApplications,
    listEmployees,
    login,
    rejectApplication,
    renewLicense,
    revokeLicense,
    submitApplication,
    verifyLicense,
  };
}

module.exports = { LICENSE_DAYS_OFFLINE, createAuthorizationService, normalizeName, normalizePhone };
