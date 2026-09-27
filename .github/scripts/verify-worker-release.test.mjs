import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { preflightWorkerUpdates, verifyWorkerRelease } from './verify-worker-release.mjs';

const body = Buffer.from('release bytes');
const sha256 = crypto.createHash('sha256').update(body).digest('hex');
const baseUrl = 'https://updates.example.test';

function createFetch(calls, expectedHash = sha256) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/health')) return new Response(JSON.stringify({ ok: true }));
    if (String(url).endsWith('/updates/latest')) {
      return new Response(JSON.stringify({
        release: {
          version: '1.3.2',
          files: [{
            name: 'Jato-AI-BID-1.3.2-win-x64.exe',
            url: `${baseUrl}/updates/download?key=release%2F1.3.2%2FJato-AI-BID-1.3.2-win-x64.exe`,
            size: body.length,
            sha256: expectedHash,
          }],
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(body);
  };
}

test('preflights the public Worker update route without a license', async () => {
  const calls = [];
  await preflightWorkerUpdates({ baseUrl, fetchImpl: createFetch(calls) });
  assert.deepEqual(calls.map(({ url }) => url), [`${baseUrl}/health`, `${baseUrl}/updates/latest`]);
  assert.equal(calls[1].options.body, undefined);
});

test('preflight rejects an older Worker that still requires a license', async () => {
  await assert.rejects(
    preflightWorkerUpdates({
      baseUrl,
      fetchImpl: async (url) => String(url).endsWith('/health') ? new Response('{}') : new Response('{}', { status: 401 }),
    }),
    /Deploy the public update route/,
  );
});

test('verifies latest metadata and a full public EXE download', async () => {
  const calls = [];
  const result = await verifyWorkerRelease({ baseUrl, version: '1.3.2', fetchImpl: createFetch(calls) });
  assert.equal(result.sha256, sha256);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers['X-Jato-License'], undefined);
  assert.equal(calls[2].url.includes('license='), false);
});

test('rejects a download whose bytes do not match the manifest', async () => {
  await assert.rejects(
    verifyWorkerRelease({ baseUrl, version: '1.3.2', fetchImpl: createFetch([], '0'.repeat(64)) }),
    /does not match/,
  );
});
