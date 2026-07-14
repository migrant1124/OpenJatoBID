import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const DEFAULT_RELEASE_PREFIX = 'release';
const KEEP_VERSION_COUNT = 2;

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function getCloudflareApiToken() {
  return optionalEnv('CLOUDFLARE_API_TOKEN') || optionalEnv('JATOBID_BUILD_CLOUDFLARE_API_TOKEN');
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

function normalizePublicBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function createPublicUrl(publicBaseUrl, key) {
  const encodedKey = String(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${publicBaseUrl}/${encodedKey}`;
}

function encodeR2ObjectKey(key) {
  return String(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function contentTypeFromFileName(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'application/x-yaml; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (lower.endsWith('.msi')) return 'application/octet-stream';
  if (lower.endsWith('.blockmap')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function cacheControlFromFileName(fileName) {
  if (/^latest(?:-mac)?\.(?:yml|yaml|json)$/i.test(fileName)) {
    return 'no-cache';
  }
  return 'public, max-age=3600';
}

async function listAssetFiles(assetsDir) {
  const entries = await fs.readdir(assetsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(assetsDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  if (files.length === 0) {
    throw new Error(`No release assets found in ${assetsDir}.`);
  }
  return files;
}

async function readGithubRelease(releaseJsonPath, tagName) {
  const raw = await fs.readFile(releaseJsonPath, 'utf-8');
  const release = JSON.parse(raw);
  if (!release.tagName && !release.tag_name) {
    release.tagName = tagName;
  }
  return release;
}

async function buildLatestJson({ assetFiles, githubRelease, publicBaseUrl, prefix, tagName }) {
  const files = [];
  for (const filePath of assetFiles) {
    const stat = await fs.stat(filePath);
    const name = path.basename(filePath);
    const key = joinKey(prefix, name);
    files.push({
      name,
      key,
      url: createPublicUrl(publicBaseUrl, key),
      size: stat.size,
      contentType: contentTypeFromFileName(name),
    });
  }

  const resolvedTagName = githubRelease.tagName || githubRelease.tag_name || tagName;
  const version = String(resolvedTagName || '').replace(/^v/i, '');
  return {
    version,
    tagName: resolvedTagName,
    name: githubRelease.name || resolvedTagName,
    body: githubRelease.body || '',
    isPrerelease: Boolean(githubRelease.isPrerelease),
    isDraft: Boolean(githubRelease.isDraft),
    githubReleaseUrl: githubRelease.url || '',
    releaseBaseUrl: prefix ? createPublicUrl(publicBaseUrl, prefix) : publicBaseUrl,
    files,
    generatedAt: new Date().toISOString(),
  };
}

function createR2Client({ accountId, accessKeyId, secretAccessKey }) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

async function putObject(client, bucket, key, filePath, fileName) {
  const body = await fs.readFile(filePath);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentLength: body.length,
    ContentType: contentTypeFromFileName(fileName),
    CacheControl: cacheControlFromFileName(fileName),
  }));
  console.log(`Uploaded R2 object: ${key}`);
}

async function putJsonObject(client, bucket, key, value) {
  const body = JSON.stringify(value, null, 2);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentLength: Buffer.byteLength(body),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  }));
  console.log(`Uploaded R2 object: ${key}`);
}

async function putObjectWithApi({ accountId, apiToken, bucket, key, filePath, fileName }) {
  const body = await fs.readFile(filePath);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodeR2ObjectKey(key)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': contentTypeFromFileName(fileName),
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare R2 API upload failed for ${key}: ${response.status} ${await response.text()}`);
  }
  console.log(`Uploaded R2 object: ${key}`);
}

async function putJsonObjectWithApi({ accountId, apiToken, bucket, key, value }) {
  const body = Buffer.from(JSON.stringify(value, null, 2), 'utf-8');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodeR2ObjectKey(key)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare R2 API upload failed for ${key}: ${response.status} ${await response.text()}`);
  }
  console.log(`Uploaded R2 object: ${key}`);
}

async function listR2Objects(client, bucket, prefix) {
  const objects = [];
  let continuationToken;
  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix ? `${prefix}/` : '',
      ContinuationToken: continuationToken,
    }));
    objects.push(...(result.Contents || []));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function listR2ObjectsWithApi({ accountId, apiToken, bucket, prefix }) {
  const objects = [];
  let cursor = '';
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects`);
    if (prefix) url.searchParams.set('prefix', `${prefix}/`);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (!response.ok) {
      throw new Error(`Cloudflare R2 API list failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    const result = data.result || {};
    objects.push(...(result.objects || result.items || []));
    cursor = result.cursor || result.nextCursor || '';
  } while (cursor);
  return objects.map((object) => ({
    Key: object.key || object.name || object.Key || '',
    LastModified: object.uploaded || object.LastModified,
    Size: object.size || object.Size,
  }));
}

function extractVersionFromKey(key, prefix) {
  const expectedPrefix = prefix ? `${prefix}/` : '';
  if (!key.startsWith(expectedPrefix)) return '';
  const fileName = key.slice(expectedPrefix.length);
  return fileName.match(/^Yibiao-(.+?)-(?:win|mac|linux)-/i)?.[1] || '';
}

function parseVersion(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrereleaseSegment(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a.localeCompare(b);
}

function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (parsedA[key] !== parsedB[key]) return parsedA[key] - parsedB[key];
  }

  if (parsedA.prerelease.length === 0 && parsedB.prerelease.length === 0) return 0;
  if (parsedA.prerelease.length === 0) return 1;
  if (parsedB.prerelease.length === 0) return -1;

  const maxLength = Math.max(parsedA.prerelease.length, parsedB.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const segmentA = parsedA.prerelease[index];
    const segmentB = parsedB.prerelease[index];
    if (segmentA === undefined) return -1;
    if (segmentB === undefined) return 1;
    const segmentResult = comparePrereleaseSegment(segmentA, segmentB);
    if (segmentResult !== 0) return segmentResult;
  }

  return 0;
}

function chooseObjectsToDelete(objects, prefix) {
  const releaseObjects = [];
  const versions = new Set();

  for (const object of objects) {
    const key = object.Key || '';
    const version = extractVersionFromKey(key, prefix);
    if (!version) continue;
    versions.add(version);
    releaseObjects.push({ key, version });
  }

  const keptVersions = new Set(
    [...versions]
      .sort(compareVersions)
      .slice(-KEEP_VERSION_COUNT),
  );
  const deletedKeys = releaseObjects
    .filter((object) => !keptVersions.has(object.version))
    .map((object) => object.key)
    .sort();

  return {
    keptVersions: [...keptVersions].sort(compareVersions).reverse(),
    deletedKeys,
  };
}

async function deleteR2Objects(client, bucket, keys) {
  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map((Key) => ({ Key })),
        Quiet: true,
      },
    }));
    for (const key of chunk) {
      console.log(`Deleted old R2 object: ${key}`);
    }
  }
}

async function deleteR2ObjectsWithApi({ accountId, apiToken, bucket, keys }) {
  for (const key of keys) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodeR2ObjectKey(key)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Cloudflare R2 API delete failed for ${key}: ${response.status} ${await response.text()}`);
    }
    console.log(`Deleted old R2 object: ${key}`);
  }
}

async function main() {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const bucket = requireEnv('R2_BUCKET');
  const publicBaseUrl = normalizePublicBaseUrl(requireEnv('R2_PUBLIC_BASE_URL'));
  const tagName = requireEnv('TAG_NAME');
  const assetsDir = requireEnv('RELEASE_ASSETS_DIR');
  const releaseJsonPath = requireEnv('GITHUB_RELEASE_JSON');
  const prefix = normalizePrefix(optionalEnv('R2_RELEASE_PREFIX', DEFAULT_RELEASE_PREFIX));
  const cloudflareApiToken = getCloudflareApiToken();

  const assetFiles = await listAssetFiles(assetsDir);
  const githubRelease = await readGithubRelease(releaseJsonPath, tagName);
  const latestJson = await buildLatestJson({ assetFiles, githubRelease, publicBaseUrl, prefix, tagName });

  console.log(`Publishing ${assetFiles.length} release assets to R2 bucket ${bucket}/${prefix}.`);
  let objects;
  let client;
  if (cloudflareApiToken) {
    for (const filePath of assetFiles) {
      const fileName = path.basename(filePath);
      await putObjectWithApi({ accountId, apiToken: cloudflareApiToken, bucket, key: joinKey(prefix, fileName), filePath, fileName });
    }
    await putJsonObjectWithApi({ accountId, apiToken: cloudflareApiToken, bucket, key: joinKey(prefix, 'latest.json'), value: latestJson });
    objects = await listR2ObjectsWithApi({ accountId, apiToken: cloudflareApiToken, bucket, prefix });
  } else {
    const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
    client = createR2Client({ accountId, accessKeyId, secretAccessKey });
    for (const filePath of assetFiles) {
      const fileName = path.basename(filePath);
      await putObject(client, bucket, joinKey(prefix, fileName), filePath, fileName);
    }
    await putJsonObject(client, bucket, joinKey(prefix, 'latest.json'), latestJson);
    objects = await listR2Objects(client, bucket, prefix);
  }
  const { keptVersions, deletedKeys } = chooseObjectsToDelete(objects, prefix);
  console.log(`Keeping release versions: ${keptVersions.join(', ') || '(none)'}.`);

  if (deletedKeys.length > 0) {
    if (cloudflareApiToken) {
      await deleteR2ObjectsWithApi({ accountId, apiToken: cloudflareApiToken, bucket, keys: deletedKeys });
    } else {
      await deleteR2Objects(client, bucket, deletedKeys);
    }
  } else {
    console.log('No old R2 release objects to delete.');
  }

  console.log(`R2 release published: ${latestJson.tagName}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
