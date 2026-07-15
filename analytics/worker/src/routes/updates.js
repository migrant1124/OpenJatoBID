import { json, methodNotAllowed, unauthorized } from '../http.js';
import { normalizeText } from '../utils.js';

const DEFAULT_RELEASE_PREFIX = 'release';
const LICENSE_HEADER = 'X-Jato-License';
const SIGNATURE_ALGORITHM = 'ECDSA_P256_SHA256';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const REQUIRED_LICENSE_FIELDS = [
  'licenseId',
  'employeeId',
  'deviceId',
  'name',
  'phone',
  'deviceFingerprint',
  'clientId',
  'platform',
  'arch',
  'issuedAt',
  'expiresAt',
  'verifiedAt',
  'offlineValidUntil',
];

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizePem(value) {
  return String(value || '').trim().replace(/\r\n/g, '\n');
}

function pemToArrayBuffer(pem) {
  const base64 = normalizePem(pem)
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64ToArrayBuffer(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function derEcdsaSignatureToP1363(value) {
  const bytes = new Uint8Array(value);
  if (bytes.length === 64) return bytes;
  if (bytes.length < 8 || bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2 || bytes[2] !== 0x02) {
    throw new Error('invalid ECDSA signature encoding');
  }
  const rLength = bytes[3];
  const rStart = 4;
  const sType = rStart + rLength;
  if (bytes[sType] !== 0x02) throw new Error('invalid ECDSA signature encoding');
  const sLength = bytes[sType + 1];
  const sStart = sType + 2;
  if (sStart + sLength !== bytes.length) throw new Error('invalid ECDSA signature encoding');

  const normalizeInteger = (start, length) => {
    let integer = bytes.slice(start, start + length);
    while (integer.length > 32 && integer[0] === 0) integer = integer.slice(1);
    if (integer.length > 32) throw new Error('invalid ECDSA integer length');
    const normalized = new Uint8Array(32);
    normalized.set(integer, 32 - integer.length);
    return normalized;
  };
  const signature = new Uint8Array(64);
  signature.set(normalizeInteger(rStart, rLength), 0);
  signature.set(normalizeInteger(sStart, sLength), 32);
  return signature;
}

function base64UrlDecodeText(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${text}${'='.repeat((4 - (text.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function normalizePrefix(value) {
  return String(value || DEFAULT_RELEASE_PREFIX)
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function joinKey(prefix, fileName) {
  return prefix ? `${prefix}/${fileName}` : fileName;
}

export function isAllowedReleaseKey(key, prefix) {
  const normalized = String(key || '');
  if (!normalized || normalized !== normalized.replace(/^\/+/, '') || normalized.includes('..') || normalized.includes('\\')) {
    return false;
  }
  const prefixSegments = normalizePrefix(prefix).split('/').filter(Boolean);
  const segments = normalized.split('/');
  if (segments.length !== prefixSegments.length + 2) return false;
  if (!prefixSegments.every((segment, index) => segments[index] === segment)) return false;

  const version = segments[prefixSegments.length];
  const fileName = segments[prefixSegments.length + 1];
  if (!VERSION_PATTERN.test(version)) return false;
  return fileName === 'manifest.json'
    || ['exe', 'msi', 'zip'].some((format) => fileName === `Jato-AI-BID-${version}-win-x64.${format}`);
}

function getTrustedPublicKey(env) {
  return normalizePem(env.JATOBID_UPDATE_LICENSE_PUBLIC_KEY || env.UPDATE_LICENSE_PUBLIC_KEY);
}

export async function verifyLicenseEnvelope(env, envelope) {
  if (!envelope || typeof envelope !== 'object') return false;
  if (envelope.algorithm !== SIGNATURE_ALGORITHM) return false;
  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) return false;
  if (!envelope.signature || !envelope.publicKey) return false;
  if (REQUIRED_LICENSE_FIELDS.some((field) => (
    typeof envelope.payload[field] !== 'string' || !envelope.payload[field].trim()
  ))) return false;

  const trustedPublicKey = getTrustedPublicKey(env);
  if (!trustedPublicKey || normalizePem(envelope.publicKey) !== trustedPublicKey) return false;

  const issuedAt = new Date(envelope.payload.issuedAt).getTime();
  const expiresAt = new Date(envelope.payload.expiresAt).getTime();
  const verifiedAt = new Date(envelope.payload.verifiedAt).getTime();
  const offlineValidUntil = new Date(envelope.payload.offlineValidUntil).getTime();
  const now = Date.now();
  if (
    ![issuedAt, expiresAt, verifiedAt, offlineValidUntil].every(Number.isFinite)
    || issuedAt > verifiedAt
    || verifiedAt > offlineValidUntil
    || offlineValidUntil > expiresAt
    || expiresAt <= now
    || offlineValidUntil <= now
  ) return false;

  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(envelope.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derEcdsaSignatureToP1363(base64ToArrayBuffer(envelope.signature)),
      new TextEncoder().encode(canonicalJson(envelope.payload)),
    );
  } catch {
    return false;
  }
}

async function readLatestLicense(request) {
  try {
    const body = await request.json();
    return body.license || body.licenseEnvelope || body.license_envelope || null;
  } catch {
    return null;
  }
}

function readDownloadLicense(request) {
  const encoded = request.headers.get(LICENSE_HEADER);
  if (!encoded) return null;
  try {
    return JSON.parse(base64UrlDecodeText(encoded));
  } catch {
    return null;
  }
}

async function readReleaseObject(env, key) {
  if (!env.RELEASE_BUCKET) {
    throw new Error('RELEASE_BUCKET is not configured');
  }
  return env.RELEASE_BUCKET.get(key);
}

function buildDownloadUrl(url, key) {
  const downloadUrl = new URL('/updates/download', url.origin);
  downloadUrl.searchParams.set('key', key);
  return downloadUrl.toString();
}

function isValidReleaseMetadata(release, prefix) {
  if (!VERSION_PATTERN.test(String(release?.version || '')) || !Array.isArray(release?.files) || release.files.length !== 3) {
    return false;
  }
  const expectedNames = new Set(['exe', 'msi', 'zip'].map(
    (format) => `Jato-AI-BID-${release.version}-win-x64.${format}`,
  ));
  for (const file of release.files) {
    if (!expectedNames.delete(file?.name)) return false;
    if (!isAllowedReleaseKey(file?.key, prefix)) return false;
    if (file.key !== joinKey(prefix, `${release.version}/${file.name}`)) return false;
    if (!Number.isFinite(Number(file?.size)) || Number(file.size) <= 0) return false;
    if (!SHA256_PATTERN.test(String(file?.sha256 || ''))) return false;
  }
  return expectedNames.size === 0;
}

function withAuthorizedDownloadUrls(release, url) {
  return {
    ...release,
    files: release.files.map((file) => ({
      ...file,
      url: buildDownloadUrl(url, file.key),
    })),
  };
}

export async function handleUpdateLatest(request, env, url) {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const license = await readLatestLicense(request);
  if (!await verifyLicenseEnvelope(env, license)) {
    return unauthorized();
  }

  const prefix = normalizePrefix(env.R2_RELEASE_PREFIX);
  const object = await readReleaseObject(env, joinKey(prefix, 'latest.json'));
  if (!object) {
    return json({ code: 404, message: 'release metadata not found' }, { status: 404 });
  }

  try {
    const release = JSON.parse(await object.text());
    if (!isValidReleaseMetadata(release, prefix)) {
      throw new Error('invalid release metadata');
    }
    return json(
      { code: 0, release: withAuthorizedDownloadUrls(release, url) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return json({ code: 500, message: 'invalid release metadata' }, { status: 500 });
  }
}

export async function handleUpdateDownload(request, env, url) {
  if (request.method !== 'GET') {
    return methodNotAllowed();
  }

  if (!await verifyLicenseEnvelope(env, readDownloadLicense(request))) {
    return unauthorized();
  }

  const prefix = normalizePrefix(env.R2_RELEASE_PREFIX);
  const key = normalizeText(url.searchParams.get('key'), 240);
  if (!isAllowedReleaseKey(key, prefix)) {
    return json({ code: 400, message: 'invalid key' }, { status: 400 });
  }

  const object = await readReleaseObject(env, key);
  if (!object) {
    return json({ code: 404, message: 'release asset not found' }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop() || 'download'}"`);
  return new Response(object.body, { headers });
}
