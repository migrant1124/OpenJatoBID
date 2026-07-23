import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verifyWorkerRelease } from './verify-worker-release.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
    license: { payload: { employeeId: 'test' } },
    version: '1.3.2',
    fetchImpl,
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
      license: {},
      version: '1.3.2',
      fetchImpl,
    }),
    /does not match/,
  );
});
