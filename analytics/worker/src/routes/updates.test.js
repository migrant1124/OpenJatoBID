import assert from 'node:assert/strict';
import test from 'node:test';
import { handleUpdateDownload, handleUpdateLatest, isAllowedReleaseKey } from './updates.js';

const version = '1.3.2';
const name = `Jato-AI-BID-${version}-win-x64.exe`;
const key = `release/${version}/${name}`;
const release = {
  version,
  files: [{ name, key, size: 13, sha256: 'b'.repeat(64) }],
};
const env = {
  RELEASE_BUCKET: {
    async get(requestedKey) {
      if (requestedKey === 'release/latest.json') {
        return { text: async () => JSON.stringify(release) };
      }
      if (requestedKey === key) {
        return {
          body: new TextEncoder().encode('release bytes'),
          writeHttpMetadata(headers) {
            headers.set('Content-Type', 'application/vnd.microsoft.portable-executable');
          },
        };
      }
      return null;
    },
  },
};

test('accepts only canonical version-directory release keys', () => {
  assert.equal(isAllowedReleaseKey(key, 'release'), true);
  assert.equal(isAllowedReleaseKey(`release/${version}/Jato-AI-BID-${version}-win-x64.msi`, 'release'), false);
  assert.equal(isAllowedReleaseKey('release/1.3.2/../secret', 'release'), false);
  assert.equal(isAllowedReleaseKey(key.replace('release/', 'other/'), 'release'), false);
});

test('latest is public while existing clients can still POST their old request', async () => {
  const url = new URL('https://updates.example.test/updates/latest');
  for (const request of [
    new Request(url),
    new Request(url, { method: 'POST', body: JSON.stringify({ license: { expired: true } }) }),
  ]) {
    const response = await handleUpdateLatest(request, env, url);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.release.files[0].url, `https://updates.example.test/updates/download?key=${encodeURIComponent(key)}`);
  }
});

test('download is public but still rejects non-release paths and unsupported methods', async () => {
  const url = new URL(`https://updates.example.test/updates/download?key=${encodeURIComponent(key)}`);
  const response = await handleUpdateDownload(new Request(url), env, url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'release bytes');

  const legacy = await handleUpdateDownload(new Request(url, { headers: { 'X-Jato-License': 'expired' } }), env, url);
  assert.equal(legacy.status, 200);

  const invalidUrl = new URL('https://updates.example.test/updates/download?key=release%2F..%2Fsecret');
  const invalid = await handleUpdateDownload(new Request(invalidUrl), env, invalidUrl);
  assert.equal(invalid.status, 400);
  const wrongMethod = await handleUpdateDownload(new Request(url, { method: 'POST' }), env, url);
  assert.equal(wrongMethod.status, 405);
});
