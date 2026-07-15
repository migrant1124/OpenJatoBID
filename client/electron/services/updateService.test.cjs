const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { __test__ } = require('./updateService.cjs');

function createTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function startFileServer(t, body) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Length': body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}/update.exe`;
}

test('selects the normalized Windows EXE before MSI and ZIP', () => {
  const files = [
    { name: 'Jato-AI-BID-1.3.2-win-x64.zip', url: 'https://example.test/update.zip' },
    { name: 'Jato-AI-BID-1.3.2-win-x64.msi', url: 'https://example.test/update.msi' },
    { name: 'Jato-AI-BID-1.3.2-win-x64.exe', url: 'https://example.test/update.exe' },
  ];
  assert.equal(__test__.pickPlatformDownloadFile(files).name, files[2].name);
});

test('compares stable versions and rejects prerelease ambiguity', () => {
  assert.equal(__test__.compareVersions('1.3.2', '1.3.1'), 1);
  assert.equal(__test__.compareVersions('1.3.2', '1.3.2'), 0);
  assert.equal(__test__.compareVersions('1.3.2-rc.1', '1.3.1'), 0);
});

test('normalizes manifest and GitHub digest SHA-256 values', () => {
  const digest = 'a'.repeat(64);
  assert.equal(__test__.normalizeUpdateSha256(digest.toUpperCase()), digest);
  assert.equal(__test__.normalizeUpdateSha256(`sha256:${digest}`), digest);
  assert.equal(__test__.normalizeUpdateSha256('not-a-digest'), '');
});

test('reuses a cached update only when size and SHA-256 both match', async (t) => {
  const directory = createTempDirectory(t);
  const filePath = path.join(directory, 'update.exe');
  const body = Buffer.from('verified update');
  fs.writeFileSync(filePath, body);

  assert.equal(await __test__.isDownloadedFileReady(filePath, body.length, sha256(body), true), true);
  fs.writeFileSync(filePath, Buffer.from('tampered update'));
  assert.equal(await __test__.isDownloadedFileReady(filePath, 15, sha256(body), true), false);
  assert.equal(fs.existsSync(filePath), false);
});

test('downloads atomically and deletes a stale cache when SHA-256 verification fails', async (t) => {
  const directory = createTempDirectory(t);
  const filePath = path.join(directory, 'update.exe');
  const body = Buffer.from('release bytes');
  const url = await startFileServer(t, body);

  await __test__.downloadFile(url, filePath, {
    expectedSize: body.length,
    expectedSha256: sha256(body),
  });
  assert.deepEqual(fs.readFileSync(filePath), body);

  await assert.rejects(
    __test__.downloadFile(url, filePath, {
      expectedSize: body.length,
      expectedSha256: '0'.repeat(64),
    }),
    /更新包校验失败/,
  );
  assert.equal(fs.existsSync(filePath), false);
});
