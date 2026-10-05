const assert = require('node:assert/strict');
const test = require('node:test');
const packageJson = require('../package.json');

test('打包 SlimSAM 模型和目标平台的 Agent 工具', () => {
  const build = packageJson.build;
  assert.equal(build.extraResources, undefined);
  assert.deepEqual(build.win.extraResources, [
    { from: 'vendor/slimsam-77-uniform', to: 'sam-model' },
    {
      from: 'vendor/agent-tools/win32-${arch}',
      to: 'agent-tools/win32-${arch}',
      filter: ['**/*'],
    },
    { from: 'vendor/ppt-runtime/win32-${arch}', to: 'ppt-runtime/win32-${arch}', filter: ['**/*'] },
  ]);
  assert.deepEqual(build.mac.extraResources, [
    { from: 'vendor/slimsam-77-uniform', to: 'sam-model' },
    {
      from: 'vendor/agent-tools/darwin-${arch}',
      to: 'agent-tools/darwin-${arch}',
      filter: ['**/*'],
    },
  ]);
});
