const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const releaseOutput = path.join(projectRoot, 'release');
const temporaryOutput = path.join(os.tmpdir(), 'jato-ai-bid-management-build');

fs.rmSync(temporaryOutput, { recursive: true, force: true });

const electronRebuildCli = path.join(path.dirname(require.resolve('@electron/rebuild')), 'cli.js');
const builderCli = path.join(path.dirname(require.resolve('electron-builder')), '..', 'cli.js');
let buildFailure = null;

try {
  const rebuildElectronModules = spawnSync(process.execPath, [
    electronRebuildCli,
    '-f',
    '-w',
    'better-sqlite3',
  ], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (rebuildElectronModules.error) throw rebuildElectronModules.error;
  if (rebuildElectronModules.status !== 0) {
    throw new Error(`Electron 原生依赖重建失败：${rebuildElectronModules.status}`);
  }

  const result = spawnSync(process.execPath, [
    builderCli,
    '--win',
    `--config.directories.output=${temporaryOutput}`,
  ], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows 管理端构建失败：${result.status}`);

  fs.rmSync(releaseOutput, { recursive: true, force: true });
  fs.mkdirSync(releaseOutput, { recursive: true });
  fs.cpSync(temporaryOutput, releaseOutput, { recursive: true, force: true });
  fs.rmSync(temporaryOutput, { recursive: true, force: true });

  const verifyPackagedNativeModule = spawnSync(
    path.join(releaseOutput, 'win-unpacked', 'Jato AI BID 管理端.exe'),
    [
      path.join(__dirname, 'verify-native-module.cjs'),
      path.join(
        releaseOutput,
        'win-unpacked',
        'resources',
        'app.asar',
        'node_modules',
        'better-sqlite3',
      ),
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  if (verifyPackagedNativeModule.error) throw verifyPackagedNativeModule.error;
  if (verifyPackagedNativeModule.status !== 0) {
    throw new Error(`安装包原生依赖验证失败：${verifyPackagedNativeModule.status}`);
  }
} catch (error) {
  buildFailure = error;
}

const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const restoreNativeModules = spawnSync(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});
if (restoreNativeModules.error) throw restoreNativeModules.error;
if (restoreNativeModules.status !== 0) process.exit(restoreNativeModules.status || 1);
if (buildFailure) throw buildFailure;

console.log(`Windows 管理端产物已写入：${releaseOutput}`);
