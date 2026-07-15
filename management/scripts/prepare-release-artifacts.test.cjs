const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getArtifactNames, prepareManagementRelease } = require('./prepare-release-artifacts.cjs');

test('stages only management EXE, ZIP and SHA256SUMS.txt', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-management-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  fs.mkdirSync(inputDir);
  for (const [index, name] of getArtifactNames('2.0.0').entries()) {
    fs.writeFileSync(path.join(inputDir, name), `management-${index}`);
  }
  fs.writeFileSync(path.join(inputDir, 'initial-admin.private.json'), 'must not be staged');

  const result = await prepareManagementRelease({ inputDir, outputDir, version: '2.0.0' });
  assert.deepEqual(fs.readdirSync(outputDir).sort(), [
    'Jato-AI-BID-Management-2.0.0-win-x64.exe',
    'Jato-AI-BID-Management-2.0.0-win-x64.zip',
    'SHA256SUMS.txt',
  ]);
  const checksumFile = fs.readFileSync(path.join(outputDir, 'SHA256SUMS.txt'), 'utf8');
  for (const [index, name] of result.artifactNames.entries()) {
    const expectedHash = crypto.createHash('sha256').update(`management-${index}`).digest('hex');
    assert.match(checksumFile, new RegExp(`${expectedHash}  ${name.replace(/\./g, '\\.')}\\n`));
  }
  assert.doesNotMatch(checksumFile, /initial-admin/);
});

test('rejects incomplete management artifacts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-management-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'input'));
  await assert.rejects(
    prepareManagementRelease({
      inputDir: path.join(root, 'input'),
      outputDir: path.join(root, 'output'),
      version: '2.0.0',
    }),
    /missing or empty/,
  );
});
