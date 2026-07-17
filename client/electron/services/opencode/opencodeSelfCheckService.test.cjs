const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createEnvironmentSnapshot } = require('./opencodeSelfCheckService.cjs');

test('智能体自检环境快照包含 Runtime 和 Cache 目录', () => {
  const userDataDir = path.resolve('tmp', 'openjatobid-self-check-user-data');
  const opencodeBinaryPath = path.join(userDataDir, 'vendor', 'opencode', 'opencode.exe');
  const app = {
    isPackaged: false,
    getVersion: () => '1.4.2-test',
    getPath(name) {
      if (name === 'userData') return userDataDir;
      throw new Error(`unexpected app path: ${name}`);
    },
  };

  const snapshot = createEnvironmentSnapshot(app, opencodeBinaryPath, {});

  assert.equal(snapshot.paths.agent_runtime_dir, path.join(userDataDir, 'agent-runtime'));
  assert.equal(snapshot.paths.agent_cache_dir, path.join(userDataDir, 'agent-cache'));
  assert.equal(snapshot.paths.opencode_binary_path, opencodeBinaryPath);
});
