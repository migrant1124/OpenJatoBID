import { json, methodNotAllowed, unauthorized } from '../http.js';
import { normalizeText } from '../utils.js';

const DEFAULT_RELEASE_PREFIX = 'release';
const LICENSE_HEADER = 'X-Jato-License';
const SIGNATURE_ALGORITHM = 'ECDSA_P256_SHA256';

function canonicalJson(value) {
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

function isAllowedReleaseKey(key, prefix) {
  const normalized = String(key || '').replace(/^\/+/, '');
  return Boolean(normalized)
    && !normalized.includes('..')
    && (!prefix || normalized.startsWith(`${prefix}/`));
}

function getTrustedPublicKey(env) {
  return normalizePem(env.JATOBID_UPDATE_LICENSE_PUBLIC_KEY || env.UPDATE_LICENSE_PUBLIC_KEY);
}

async function verifyLicenseEnvelope(env, envelope) {
  if (!envelope || typeof envelope !== 'object') return false;
  if (envelope.algorithm !== SIGNATURE_ALGORITHM) return false;
  if (!envelope.payload || !envelope.signature || !envelope.publicKey) return false;

  const trustedPublicKey = getTrustedPublicKey(env);
  if (!trustedPublicKey || normalizePem(envelope.publicKey) !== trustedPublicKey) return false;

  const expiresAt = new Date(envelope.payload.expiresAt || '').getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

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
      base64ToArrayBuffer(envelope.signature),
      new TextEncoder().encode(canonicalJson(envelope.payload)),
    );
  } catch {
    return false;
  }
}

async function readRequestLicense(request) {
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      return body.license || body.licenseEnvelope || body.license_envelope || null;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(request.url);
    const queryLicense = url.searchParams.get('license');
    if (queryLicense) return JSON.parse(base64UrlDecodeText(queryLicense));
  } catch {}

  const encoded = request.headers.get(LICENSE_HEADER);
  if (!encoded) return null;
  try {
    return JSON.parse(base64UrlDecodeText(encoded));
  } catch {
    return null;
  }
}

async function requireUpdateLicense(request, env) {
  const license = await readRequestLicense(request);
  return await verifyLicenseEnvelope(env, license);
}

async function requireDownloadLicense(request, env) {
  const license = await readRequestLicense(request);
  if (await verifyLicenseEnvelope(env, license)) return true;
  if (!license || typeof license !== 'object' || !license.payload) return false;

  const trustedPublicKey = getTrustedPublicKey(env);
  const expiresAt = new Date(license.payload.expiresAt || '').getTime();
  return Boolean(
    trustedPublicKey
    && normalizePem(license.publicKey) === trustedPublicKey
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now(),
  );
}

async function readReleaseObject(env, key) {
  if (!env.RELEASE_BUCKET) {
    throw new Error('RELEASE_BUCKET is not configured');
  }
  return env.RELEASE_BUCKET.get(key);
}

function base64UrlEncodeText(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildDownloadUrl(url, key, license) {
  const downloadUrl = new URL('/updates/download', url.origin);
  downloadUrl.searchParams.set('key', key);
  if (license) downloadUrl.searchParams.set('license', base64UrlEncodeText(JSON.stringify(license)));
  return downloadUrl.toString();
}

function withAuthorizedDownloadUrls(release, url, license) {
  const files = Array.isArray(release.files) ? release.files : [];
  return {
    ...release,
    files: files.map((file) => ({
      ...file,
      url: buildDownloadUrl(url, file.key || file.name, license),
    })),
  };
}

export async function handleUpdateLatest(request, env, url) {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const license = await readRequestLicense(request);
  if (!await requireDownloadLicense(request, env)) {
    return unauthorized();
  }

  const prefix = normalizePrefix(env.R2_RELEASE_PREFIX);
  const object = await readReleaseObject(env, joinKey(prefix, 'latest.json'));
  if (!object) {
    return json({ code: 404, message: 'release metadata not found' }, { status: 404 });
  }

  try {
    const release = JSON.parse(await object.text());
    return json({ code: 0, release: withAuthorizedDownloadUrls(release, url, license) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return json({ code: 500, message: 'invalid release metadata' }, { status: 500 });
  }
}

export async function handleUpdateDownload(request, env, url) {
  if (request.method !== 'GET') {
    return methodNotAllowed();
  }

  if (!await requireUpdateLicense(request, env)) {
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
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(key.split('/').pop() || 'download')}"`);
  return new Response(object.body, { headers });
}
