const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  prepareInitialAdminCredential,
} = require('./prepare-initial-admin-credential.cjs');

function createTestPaths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-initial-admin-'));
  return {
    directory,
    inputPath: path.join(directory, 'initial-admin.private.json'),
    outputPath: path.join(directory, 'generated', 'initialAdminCredential.cjs'),
  };
}

test('generates only username, salt, hash and credential version', (t) => {
  const paths = createTestPaths();
  t.after(() => fs.rmSync(paths.directory, { recursive: true, force: true }));
  const plaintextPassword = 'Example-Private-Password';
  fs.writeFileSync(paths.inputPath, JSON.stringify({
    username: 'example-admin',
    password: plaintextPassword,
    credentialVersion: 'test-v1',
  }), 'utf8');

  prepareInitialAdminCredential({
    inputPath: paths.inputPath,
    outputPath: paths.outputPath,
    randomBytes: () => Buffer.alloc(16, 7),
  });

  const generatedSource = fs.readFileSync(paths.outputPath, 'utf8');
  const generated = require(paths.outputPath);
  assert.deepEqual(Object.keys(generated), [
    'username',
    'passwordSalt',
    'passwordHash',
    'credentialVersion',
  ]);
  assert.equal(generated.username, 'example-admin');
  assert.equal(generated.passwordSalt, Buffer.alloc(16, 7).toString('hex'));
  assert.equal(generated.passwordHash, crypto.scryptSync(
    plaintextPassword,
    generated.passwordSalt,
    64,
  ).toString('hex'));
  assert.match(generated.passwordHash, /^[0-9a-f]{128}$/);
  assert.equal(generated.credentialVersion, 'test-v1');
  assert.equal(generatedSource.includes(plaintextPassword), false);
});

test('uses credential version 1 when it is omitted', (t) => {
  const paths = createTestPaths();
  t.after(() => fs.rmSync(paths.directory, { recursive: true, force: true }));
  fs.writeFileSync(paths.inputPath, JSON.stringify({
    username: 'example-admin',
    password: 'Example-Private-Password',
  }), 'utf8');

  prepareInitialAdminCredential({
    inputPath: paths.inputPath,
    outputPath: paths.outputPath,
  });

  assert.equal(require(paths.outputPath).credentialVersion, '1');
});

test('rejects a missing private credential file', () => {
  const paths = createTestPaths();
  try {
    assert.throws(
      () => prepareInitialAdminCredential({
        inputPath: paths.inputPath,
        outputPath: paths.outputPath,
      }),
      /INITIAL_ADMIN_CREDENTIAL_FILE_NOT_FOUND/,
    );
  } finally {
    fs.rmSync(paths.directory, { recursive: true, force: true });
  }
});

test('rejects malformed private credential JSON', (t) => {
  const paths = createTestPaths();
  t.after(() => fs.rmSync(paths.directory, { recursive: true, force: true }));
  fs.writeFileSync(paths.inputPath, '{invalid-json', 'utf8');

  assert.throws(
    () => prepareInitialAdminCredential({
      inputPath: paths.inputPath,
      outputPath: paths.outputPath,
    }),
    /INITIAL_ADMIN_CREDENTIAL_FILE_INVALID_JSON/,
  );
});

test('rejects invalid private credential fields', (t) => {
  const paths = createTestPaths();
  t.after(() => fs.rmSync(paths.directory, { recursive: true, force: true }));
  const cases = [
    [{ username: '', password: 'long-enough-password' }, 'INITIAL_ADMIN_USERNAME_REQUIRED'],
    [{ username: 'example-admin', password: '' }, 'INITIAL_ADMIN_PASSWORD_TOO_SHORT'],
    [{ username: 'example-admin', password: 'short' }, 'INITIAL_ADMIN_PASSWORD_TOO_SHORT'],
    [{ username: 'example-admin', password: 'long-enough-password', credentialVersion: '' }, 'INITIAL_ADMIN_CREDENTIAL_VERSION_REQUIRED'],
  ];

  for (const [input, expectedError] of cases) {
    fs.writeFileSync(paths.inputPath, JSON.stringify(input), 'utf8');
    assert.throws(
      () => prepareInitialAdminCredential({
        inputPath: paths.inputPath,
        outputPath: paths.outputPath,
      }),
      new RegExp(expectedError),
    );
  }
});
