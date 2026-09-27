import { json, methodNotAllowed } from '../http.js';
import { normalizeText } from '../utils.js';

const DEFAULT_RELEASE_PREFIX = 'release';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

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
    || fileName === `Jato-AI-BID-${version}-win-x64.exe`;
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
  if (!VERSION_PATTERN.test(String(release?.version || '')) || !Array.isArray(release?.files) || release.files.length !== 1) {
    return false;
  }
  const expectedNames = new Set([`Jato-AI-BID-${release.version}-win-x64.exe`]);
  for (const file of release.files) {
    if (!expectedNames.delete(file?.name)) return false;
    if (!isAllowedReleaseKey(file?.key, prefix)) return false;
    if (file.key !== joinKey(prefix, `${release.version}/${file.name}`)) return false;
    if (!Number.isFinite(Number(file?.size)) || Number(file.size) <= 0) return false;
    if (!SHA256_PATTERN.test(String(file?.sha256 || ''))) return false;
  }
  return expectedNames.size === 0;
}

function withDownloadUrls(release, url) {
  return {
    ...release,
    files: release.files.map((file) => ({
      ...file,
      url: buildDownloadUrl(url, file.key),
    })),
  };
}

export async function handleUpdateLatest(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowed();
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
      { code: 0, release: withDownloadUrls(release, url) },
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
