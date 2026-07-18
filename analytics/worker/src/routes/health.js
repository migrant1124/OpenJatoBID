import { WORKER_CODE_VERSION } from '../constants.js';
import { json } from '../http.js';

function normalizePem(value) {
  return String(value || '').trim().replace(/\r\n/g, '\n');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleHealth(env) {
  const updateLicensePublicKey = normalizePem(env.JATOBID_UPDATE_LICENSE_PUBLIC_KEY || env.UPDATE_LICENSE_PUBLIC_KEY);
  return json({
    code: 0,
    ok: true,
    service: 'bidupdat-api',
    workerCodeVersion: WORKER_CODE_VERSION,
    noticeTimeFormat: 'YYYY-MM-DD HH:mm:ss Asia/Shanghai',
    releaseBucketConfigured: Boolean(env.RELEASE_BUCKET),
    noticeStoreConfigured: Boolean(env.NOTICE_STORE),
    analyticsDatabaseConfigured: Boolean(env.ANALYTICS_DB),
    resourceDatabaseConfigured: Boolean(env.RESOURCE_DB),
    resourceBucketConfigured: Boolean(env.RESOURCE_BUCKET),
    updateLicensePublicKeyConfigured: Boolean(updateLicensePublicKey),
    updateLicensePublicKeyFingerprint: updateLicensePublicKey ? await sha256Hex(updateLicensePublicKey) : null,
  });
}
