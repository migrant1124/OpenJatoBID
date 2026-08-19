const assert = require('node:assert/strict');
const test = require('node:test');
const packageJson = require('../package.json');

test('packages only target-platform Agent tools', () => {
  const build = packageJson.build;
  assert.equal(build.extraResources, undefined);
  assert.deepEqual(build.win.extraResources, [{
    from: 'vendor/agent-tools/win32-${arch}',
    to: 'agent-tools/win32-${arch}',
    filter: ['**/*'],
  }]);
  assert.deepEqual(build.mac.extraResources, [{
    from: 'vendor/agent-tools/darwin-${arch}',
    to: 'agent-tools/darwin-${arch}',
    filter: ['**/*'],
  }]);
});
