import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { preflightWorkerLicense, validateTestLicense, verifyWorkerRelease } from './verify-worker-release.mjs';

const NOW = Date.parse('2026-08-19T00:00:00.000Z');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createLicense(overrides = {}) {
  return {
    algorithm: 'ECDSA_P256_SHA256',
    publicKey: 'test-public-key',
    signature: 'test-signature',
    payload: {
      employeeId: 'test',
      expiresAt: '2027-08-19T00:00:00.000Z',
      offlineValidUntil: '2026-09-18T00:00:00.000Z',
      ...overrides,
    },
  };
}

test('verifies latest metadata and a full Header-authenticated EXE download', async () => {
  const body = Buffer.from('release bytes');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true }));
    if (String(url).endsWith('/updates/latest')) {
      return new Response(JSON.stringify({
        release: {
          version: '1.3.2',
          files: [{
            name: 'Jato-AI-BID-1.3.2-win-x64.exe',
            url: 'https://updates.example.test/updates/download?key=release%2F1.3.2%2FJato-AI-BID-1.3.2-win-x64.exe',
            size: body.length,
            sha256: sha256(body),
          }],
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(body);
  };

  const result = await verifyWorkerRelease({
    baseUrl: 'https://updates.example.test',
    license: createLicense(),
    version: '1.3.2',
    fetchImpl,
    now: NOW,
  });
  assert.equal(result.sha256, sha256(body));
  assert.equal(calls[2].options.headers['X-Jato-License'].includes('.'), false);
  assert.equal(calls[2].url.includes('license='), false);
});

test('rejects a download whose bytes do not match the manifest', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) return new Response('{}');
    if (String(url).endsWith('/updates/latest')) {
      return new Response(JSON.stringify({
        release: {
          version: '1.3.2',
          files: [{
            name: 'Jato-AI-BID-1.3.2-win-x64.exe',
            url: 'https://updates.example.test/updates/download?key=exe',
            size: 4,
            sha256: '0'.repeat(64),
          }],
        },
      }));
    }
    return new Response('bad!');
  };
  await assert.rejects(
    verifyWorkerRelease({
      baseUrl: 'https://updates.example.test',
      license: createLicense(),
      version: '1.3.2',
      fetchImpl,
      now: NOW,
    }),
    /does not match/,
  );
});

test('rejects an expired offline window before contacting the Worker', () => {
  assert.throws(
    () => validateTestLicense(createLicense({ offlineValidUntil: '2026-08-16T17:05:41.537Z' }), NOW),
    /offline window expired.*Renew the test device license/,
  );
});

test('preflights the signed license against the Worker before release publication', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response('{}');
  };
  const result = await preflightWorkerLicense({
    baseUrl: 'https://updates.example.test',
    license: createLicense(),
    fetchImpl,
    now: NOW,
  });
  assert.equal(result.offlineValidUntil, '2026-09-18T00:00:00.000Z');
  assert.deepEqual(calls, [
    'https://updates.example.test/health',
    'https://updates.example.test/updates/latest',
  ]);
});
