const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeInitialAdminCredential } = require('./write-initial-admin-credential.cjs');

test('writes a valid credential JSON without changing its contents', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'management-credential-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'initial-admin.private.json');
  const credentialJson = JSON.stringify({
    username: 'administrator',
    password: 'password-with-quotes-"-and-symbols-$',
    credentialVersion: '1',
  });

  writeInitialAdminCredential({ credentialJson, outputPath });

  assert.equal(fs.readFileSync(outputPath, 'utf8'), credentialJson);
});

test('rejects a missing credential environment value', () => {
  assert.throws(
    () => writeInitialAdminCredential({ credentialJson: '', outputPath: 'unused' }),
    /MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON_REQUIRED/,
  );
});

test('rejects invalid credential JSON without creating a file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'management-credential-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'initial-admin.private.json');

  assert.throws(
    () => writeInitialAdminCredential({ credentialJson: '{invalid', outputPath }),
    /MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON_INVALID/,
  );
  assert.equal(fs.existsSync(outputPath), false);
});
