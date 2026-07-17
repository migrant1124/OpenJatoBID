const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
const startupAuthSource = fs.readFileSync(path.join(__dirname, 'features', 'auth', 'StartupAuthPage.tsx'), 'utf8');

test('license status subscription stays mounted before and after authorization', () => {
  const effectStart = appSource.indexOf('const handleStatus = (status: LicenseRuntimeStatus) => {');
  const effectEnd = appSource.indexOf('}, []);', effectStart);
  const effectSource = appSource.slice(effectStart, effectEnd);

  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  assert.doesNotMatch(effectSource, /if \(!authorized\) return/);
  assert.match(effectSource, /license\.onStatusChanged\(handleStatus\)/);
  assert.match(effectSource, /setInitialLicenseStatus\(status\)/);
  assert.match(effectSource, /setAuthorized\(false\)/);
});

test('authorization confirmation rereads persisted status and rejects a concurrent invalidation event', () => {
  assert.match(appSource, /const confirmAuthorization = async \(status: LicenseRuntimeStatus\)/);
  assert.match(appSource, /licenseEventRevisionRef\.current/);
  assert.match(appSource, /await window\.yibiao\?\.license\.getStatus\(\)/);
  assert.match(appSource, /latestStatus\.status === 'active' \|\| latestStatus\.status === 'debug_disabled'/);
  assert.match(appSource, /onAuthorized=\{\(status\) => \{ void confirmAuthorization\(status\); \}\}/);
});

test('startup login reflects an invalidation that arrives while authorization confirmation is in flight', () => {
  assert.match(startupAuthSource, /useEffect\(\(\) => \{[\s\S]*statusMessage\(initialStatus\)[\s\S]*setError\(message\)[\s\S]*\}, \[initialStatus\]\)/);
});
