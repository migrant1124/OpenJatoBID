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

function derIntegerToFixedBytes(bytes, offset) {
  if (bytes[offset] !== 0x02) throw new Error('invalid der integer');
  const length = bytes[offset + 1];
  let value = bytes.slice(offset + 2, offset + 2 + length);
  while (value.length > 32 && value[0] === 0) value = value.slice(1);
  if (value.length > 32) throw new Error('invalid der integer length');
  const fixed = new Uint8Array(32);
  fixed.set(value, 32 - value.length);
  return { value: fixed, nextOffset: offset + 2 + length };
}

function ecdsaDerToP1363(signature) {
  const bytes = new Uint8Array(signature);
  if (bytes[0] !== 0x30) throw new Error('invalid der sequence');
  const r = derIntegerToFixedBytes(bytes, 2);
  const s = derIntegerToFixedBytes(bytes, r.nextOffset);
  const raw = new Uint8Array(64);
  raw.set(r.value, 0);
  raw.set(s.value, 32);
  return raw;
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
      ecdsaDerToP1363(base64ToArrayBuffer(envelope.signature)),
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

function withAuthorizedDownloadUrls(release, url) {
  const files = Array.isArray(release.files) ? release.files : [];
  return {
    ...release,
    files: files.map((file) => ({
      ...file,
      url: buildDownloadUrl(url, file.key || file.name),
    })),
  };
}

export async function handleUpdateLatest(request, env, url) {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  if (!await requireUpdateLicense(request, env)) {
    return unauthorized();
  }

  const prefix = normalizePrefix(env.R2_RELEASE_PREFIX);
  const object = await readReleaseObject(env, joinKey(prefix, 'latest.json'));
  if (!object) {
    return json({ code: 404, message: 'release metadata not found' }, { status: 404 });
  }

  try {
    const release = JSON.parse(await object.text());
    return json({ code: 0, release: withAuthorizedDownloadUrls(release, url) }, { headers: { 'Cache-Control': 'no-store' } });
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
