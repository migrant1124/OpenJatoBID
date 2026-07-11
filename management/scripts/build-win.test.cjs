const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('forces Electron ABI, detaches and verifies the package before restoring the host ABI', () => {
  const source = fs.readFileSync(path.join(__dirname, 'build-win.cjs'), 'utf8');
  const rebuildElectronIndex = source.indexOf('const rebuildElectronModules = spawnSync');
  const buildPackageIndex = source.indexOf('const result = spawnSync');
  const copyPackageIndex = source.indexOf('fs.cpSync(temporaryOutput, releaseOutput');
  const detachPackageIndex = source.indexOf('fs.rmSync(temporaryOutput', copyPackageIndex);
  const verifyPackageIndex = source.indexOf('const verifyPackagedNativeModule = spawnSync');
  const restoreHostIndex = source.indexOf('const restoreNativeModules = spawnSync');

  assert.notEqual(rebuildElectronIndex, -1);
  assert.notEqual(buildPackageIndex, -1);
  assert.notEqual(copyPackageIndex, -1);
  assert.notEqual(detachPackageIndex, -1);
  assert.notEqual(verifyPackageIndex, -1);
  assert.notEqual(restoreHostIndex, -1);
  assert.ok(rebuildElectronIndex < buildPackageIndex);
  assert.ok(buildPackageIndex < copyPackageIndex);
  assert.ok(copyPackageIndex < detachPackageIndex);
  assert.ok(detachPackageIndex < verifyPackageIndex);
  assert.ok(verifyPackageIndex < restoreHostIndex);

  const verificationBlock = source.slice(verifyPackageIndex, restoreHostIndex);
  assert.match(verificationBlock, /Jato AI BID 管理端\.exe/);
  assert.match(verificationBlock, /app\.asar/);
  assert.doesNotMatch(verificationBlock, /app\.asar\.unpacked/);
});

test('excludes test and private credential files from the packaged application', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.ok(packageJson.build.files.includes('!electron/**/*.test.cjs'));
  assert.ok(packageJson.build.files.includes('!initial-admin.private.json'));
  assert.ok(packageJson.build.files.includes('electron/generated/initialAdminCredential.cjs'));
});
