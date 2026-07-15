import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  canonicalJson,
  handleUpdateDownload,
  handleUpdateLatest,
  isAllowedReleaseKey,
  verifyLicenseEnvelope,
} from './updates.js';

async function createLicenseFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const now = Date.now();
  const payload = {
    licenseId: 'license-1',
    employeeId: 'employee-1',
    deviceId: 'device-1',
    name: 'Test Employee',
    phone: '13800138000',
    deviceFingerprint: 'fingerprint-1',
    clientId: 'client-1',
    platform: 'win32',
    arch: 'x64',
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString(),
    verifiedAt: new Date(now - 30_000).toISOString(),
    offlineValidUntil: new Date(now + 60_000).toISOString(),
  };
  const signature = sign('sha256', Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
  return {
    env: { JATOBID_UPDATE_LICENSE_PUBLIC_KEY: publicKey },
    privateKey,
    license: {
      algorithm: 'ECDSA_P256_SHA256',
      publicKey,
      payload,
      signature,
    },
  };
}

function createRelease() {
  const version = '1.3.2';
  return {
    version,
    tagName: `v${version}`,
    gitCommitSha: 'a'.repeat(40),
    generatedAt: '2026-07-15T00:00:00.000Z',
    files: ['exe', 'msi', 'zip'].map((format) => ({
      name: `Jato-AI-BID-${version}-win-x64.${format}`,
      key: `release/${version}/Jato-AI-BID-${version}-win-x64.${format}`,
      platform: 'win32',
      arch: 'x64',
      format,
      size: 13,
      sha256: 'b'.repeat(64),
    })),
  };
}

function createBucket(release) {
  return {
    async get(key) {
      if (key === 'release/latest.json') {
        return { text: async () => JSON.stringify(release) };
      }
      if (key === release.files[0].key) {
        return {
          body: new TextEncoder().encode('release bytes'),
          writeHttpMetadata(headers) {
            headers.set('Content-Type', 'application/vnd.microsoft.portable-executable');
          },
        };
      }
      return null;
    },
  };
}

function encodeLicenseHeader(license) {
  return Buffer.from(JSON.stringify(license), 'utf8').toString('base64url');
}

test('accepts only canonical version-directory release keys', () => {
  assert.equal(isAllowedReleaseKey('release/1.3.2/Jato-AI-BID-1.3.2-win-x64.exe', 'release'), true);
  assert.equal(isAllowedReleaseKey('release/Jato-AI-BID-1.3.2-win-x64.exe', 'release'), false);
  assert.equal(isAllowedReleaseKey('release/1.3.2/../secret', 'release'), false);
  assert.equal(isAllowedReleaseKey('other/1.3.2/Jato-AI-BID-1.3.2-win-x64.exe', 'release'), false);
});

test('strictly verifies a trusted, unexpired ECDSA license envelope', async () => {
  const fixture = await createLicenseFixture();
  assert.equal(await verifyLicenseEnvelope(fixture.env, fixture.license), true);
  assert.equal(await verifyLicenseEnvelope(fixture.env, {
    ...fixture.license,
    payload: { ...fixture.license.payload, employeeId: 'tampered' },
  }), false);
});

test('rejects a signed license with a missing required field or expired offline window', async () => {
  const fixture = await createLicenseFixture();
  const { licenseId: _licenseId, ...missingFieldPayload } = fixture.license.payload;
  const missingFieldSignature = sign(
    'sha256',
    Buffer.from(canonicalJson(missingFieldPayload)),
    fixture.privateKey,
  ).toString('base64');
  assert.equal(await verifyLicenseEnvelope(fixture.env, {
    ...fixture.license,
    payload: missingFieldPayload,
    signature: missingFieldSignature,
  }), false);

  const expiredOfflinePayload = {
    ...fixture.license.payload,
    offlineValidUntil: new Date(Date.now() - 1_000).toISOString(),
  };
  const expiredOfflineSignature = sign(
    'sha256',
    Buffer.from(canonicalJson(expiredOfflinePayload)),
    fixture.privateKey,
  ).toString('base64');
  assert.equal(await verifyLicenseEnvelope(fixture.env, {
    ...fixture.license,
    payload: expiredOfflinePayload,
    signature: expiredOfflineSignature,
  }), false);
});

test('latest returns three private Worker URLs without embedding the license', async () => {
  const fixture = await createLicenseFixture();
  const release = createRelease();
  const env = { ...fixture.env, RELEASE_BUCKET: createBucket(release) };
  const request = new Request('https://updates.example.test/updates/latest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license: fixture.license }),
  });
  const response = await handleUpdateLatest(request, env, new URL(request.url));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.release.files.length, 3);
  assert.ok(body.release.files.every((file) => file.url.includes('/updates/download?key=')));
  assert.ok(body.release.files.every((file) => !file.url.includes('license=')));
});

test('download requires the license header and rejects query-only credentials', async () => {
  const fixture = await createLicenseFixture();
  const release = createRelease();
  const env = { ...fixture.env, RELEASE_BUCKET: createBucket(release) };
  const encoded = encodeLicenseHeader(fixture.license);
  const downloadUrl = new URL(`https://updates.example.test/updates/download?key=${encodeURIComponent(release.files[0].key)}`);

  const authorized = await handleUpdateDownload(new Request(downloadUrl, {
    headers: { 'X-Jato-License': encoded },
  }), env, downloadUrl);
  assert.equal(authorized.status, 200);
  assert.equal(await authorized.text(), 'release bytes');

  const queryOnlyUrl = new URL(downloadUrl);
  queryOnlyUrl.searchParams.set('license', encoded);
  const queryOnly = await handleUpdateDownload(new Request(queryOnlyUrl), env, queryOnlyUrl);
  assert.equal(queryOnly.status, 401);
});

test('download rejects non-release keys even with a valid license', async () => {
  const fixture = await createLicenseFixture();
  const release = createRelease();
  const env = { ...fixture.env, RELEASE_BUCKET: createBucket(release) };
  const url = new URL('https://updates.example.test/updates/download?key=release%2F..%2Fsecret');
  const response = await handleUpdateDownload(new Request(url, {
    headers: { 'X-Jato-License': encodeLicenseHeader(fixture.license) },
  }), env, url);
  assert.equal(response.status, 400);
});
