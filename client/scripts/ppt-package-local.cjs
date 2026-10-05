// 只构建新的本地隔离目录；不调用正式dist脚本、不发布、不包含正式管理凭据。
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const repository = path.resolve(__dirname, '../..'), client = path.join(repository, 'client'), management = path.join(repository, 'management');
const base = path.join(client, '.tmp/ppt184-resource-center/package'); fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, '本地-')), results = [];
function run(name, command, args, cwd) { const log = path.join(root, `${name}.log`), fd = fs.openSync(log, 'w'); const value = spawnSync(command, args, { cwd, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, windowsHide: true, stdio: ['ignore', fd, fd] }); fs.closeSync(fd); results.push({ name, command, args, exitCode: value.status, error: value.error?.message, log }); console.log(JSON.stringify(results.at(-1))); return value.status === 0; }
function builder(project) { return path.join(project, 'node_modules/electron-builder/cli.js'); }
const clientNative = path.join(client, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'), managerNative = path.join(management, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
const hash = (file) => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'); const before = [hash(clientNative), hash(managerNative)];
try {
  if (!process.argv.includes('--management-only') && !run('client-builder', process.execPath, [builder(client), '--win', 'nsis', '--x64', '--publish', 'never', `--config.directories.output=${path.join(root, 'client')}`, '--config.npmRebuild=false'], client)) throw new Error('客户端本地打包失败，见日志');
  if (!process.argv.includes('--client-only')) {
  const stage = path.join(root, 'management-stage'); fs.mkdirSync(stage);
  for (const name of ['dist','electron','assets']) fs.cpSync(path.join(management, name), path.join(stage, name), { recursive: true, filter: (file) => !file.startsWith(path.join(management, 'electron/generated')) });
  const appManifest = JSON.parse(fs.readFileSync(path.join(management, 'package.json'), 'utf8')); delete appManifest.build; fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(appManifest));
  fs.mkdirSync(path.join(stage, 'scripts')); fs.copyFileSync(path.join(management, 'scripts/verify-ppt-runtime.cjs'), path.join(stage, 'scripts/verify-ppt-runtime.cjs'));
  fs.symlinkSync(path.join(management, 'vendor'), path.join(stage, 'vendor'), 'junction');
  fs.mkdirSync(path.join(stage, 'node_modules'));
  const copied = new Set();
  function copyDependency(name) {
    if (copied.has(name)) return; copied.add(name);
    const source = path.join(name === 'better-sqlite3' ? client : management, 'node_modules', name), manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    fs.cpSync(source, path.join(stage, 'node_modules', name), { recursive: true });
    for (const dependency of Object.keys(manifest.dependencies || {})) copyDependency(dependency);
  }
  // 复制完整生产依赖与同一精确12.10.0的Electron ABI145模块，不改开发目录。
  for (const name of Object.keys(appManifest.dependencies)) copyDependency(name);
  fs.copyFileSync(path.join(management, 'package-lock.json'), path.join(stage, 'package-lock.json'));
  const credential = path.join(root, 'isolated-initial-admin.private.json'); fs.writeFileSync(credential, JSON.stringify({ username: 'package-test', password: 'Isolated-Package-184', credentialVersion: 'local-test' }));
  require(path.join(management, 'scripts/prepare-initial-admin-credential.cjs')).prepareInitialAdminCredential({ inputPath: credential, outputPath: path.join(stage, 'electron/generated/initialAdminCredential.cjs') });
  const config = JSON.parse(fs.readFileSync(path.join(management, 'package.json'), 'utf8')).build;
  Object.assign(config, { directories: { app: stage, output: path.join(root, 'management') }, electronDist: path.join(management, 'node_modules/electron/dist'), npmRebuild: false });
  config.win.signAndEditExecutable = false; config.win.extraResources[0].from = path.join(management, 'vendor/ppt-runtime/win32-${arch}');
  const configFile = path.join(root, 'management-builder.json'); fs.writeFileSync(configFile, JSON.stringify(config));
  if (!run('management-builder', process.execPath, [builder(management), '--config', configFile, '--win', 'nsis', '--x64', '--publish', 'never'], management)) throw new Error('管理端本地打包失败，见日志');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { const after = [hash(clientNative), hash(managerNative)]; if (JSON.stringify(before) !== JSON.stringify(after)) { process.exitCode = 1; console.error('原生模块发生变化'); } fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '本地Windows builder --publish never；未安装、未发布', results, originalNativeHashes: before, finalNativeHashes: after }, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); }
