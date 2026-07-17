const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildOpenCodeBaseEnv,
  createOpenCodeEnvironmentLayout,
  prepareOpenCodeEnvironment,
} = require('./opencodeEnvironment.cjs');

function createTestApp(userDataDir) {
  return {
    isPackaged: false,
    getPath(name) {
      if (name === 'userData') return userDataDir;
      throw new Error(`unexpected app path: ${name}`);
    },
  };
}

test('OpenCode 环境使用独立 HOME、XDG、AppData 和临时目录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-opencode-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const app = createTestApp(path.join(root, 'user-data'));
  const runtimeRoot = path.join(root, 'runtime');
  const workspaceDir = path.join(runtimeRoot, 'workspace');
  const originalPath = process.env.PATH;
  const originalPathCase = process.env.Path;
  const employeeBin = path.join(root, 'employee-bin');

  process.env.PATH = employeeBin;
  if (process.platform === 'win32') process.env.Path = employeeBin;
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathCase === undefined) delete process.env.Path;
    else process.env.Path = originalPathCase;
  });

  const environmentInfo = prepareOpenCodeEnvironment({ app, runtimeRoot, workspaceDir });
  const { env, layout, toolEnvironment } = environmentInfo;

  assert.equal(env.HOME, layout.homeDir);
  assert.equal(env.USERPROFILE, layout.homeDir);
  assert.equal(env.XDG_CONFIG_HOME, layout.configHome);
  assert.equal(env.XDG_DATA_HOME, layout.dataHome);
  assert.equal(env.XDG_CACHE_HOME, layout.cacheHome);
  assert.equal(env.XDG_STATE_HOME, layout.stateHome);
  assert.equal(env.TEMP, layout.tempDir);
  assert.equal(env.TMP, layout.tempDir);
  assert.equal(env.TMPDIR, layout.tempDir);
  assert.equal(env.OPENCODE_CONFIG, layout.opencodeConfigPath);
  assert.equal(env.OPENCODE_CONFIG_DIR, layout.configDir);
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, 'true');
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, 'true');
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, 'true');

  for (const directory of [
    layout.homeDir,
    layout.configDir,
    layout.dataDir,
    layout.stateDir,
    layout.cacheDir,
    layout.opencodeTempDir,
  ]) {
    assert.equal(fs.statSync(directory).isDirectory(), true, directory);
  }

  const pathEntries = env.PATH.split(path.delimiter);
  assert.equal(pathEntries.includes(employeeBin), false);
  assert.equal(pathEntries.includes(toolEnvironment.runtimeToolsBinDir), true);
  assert.equal(pathEntries.includes(toolEnvironment.bundledToolsBinDir), true);
  assert.equal(environmentInfo.skillRoots.includes(path.resolve(runtimeRoot)), false);
  assert.equal(environmentInfo.skillRoots.some((rootDir) => rootDir.startsWith(path.resolve(app.getPath('userData')))), false);
});

test('基础环境分别生成 Windows 和非 Windows 的受控变量与系统 PATH', () => {
  const layout = createOpenCodeEnvironmentLayout({
    app: createTestApp('C:\\OpenJatoBID\\user-data'),
    runtimeRoot: 'C:\\OpenJatoBID\\runtime',
    workspaceDir: 'C:\\OpenJatoBID\\runtime\\workspace',
  });
  const windowsEnv = buildOpenCodeBaseEnv(layout, {
    platform: 'win32',
    sourceEnv: {
      SystemRoot: 'C:\\Windows',
      PATHEXT: '.EXE;.CMD',
      PATH: 'C:\\Users\\Employee\\bin',
    },
  });
  assert.equal(windowsEnv.APPDATA, layout.appDataDir);
  assert.equal(windowsEnv.LOCALAPPDATA, layout.localAppDataDir);
  assert.equal(windowsEnv.Path.includes('C:\\Users\\Employee\\bin'), false);
  assert.equal(windowsEnv.Path.includes('C:\\Windows\\System32'), true);

  const posixEnv = buildOpenCodeBaseEnv(layout, {
    platform: 'linux',
    sourceEnv: { PATH: '/home/employee/bin:/usr/local/bin' },
  });
  assert.equal(posixEnv.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  assert.equal('APPDATA' in posixEnv, false);
  assert.equal('LOCALAPPDATA' in posixEnv, false);
});
