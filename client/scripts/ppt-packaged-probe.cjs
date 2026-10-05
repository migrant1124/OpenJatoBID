// 以解包产物自身Electron的RUN_AS_NODE验证实际ASAR/native/受管工具，不启动正式应用、不写生产数据。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const unpacked = path.resolve(process.argv[2]), root = path.resolve(process.argv[3]); fs.mkdirSync(root, { recursive: true });
const asar = path.join(unpacked, 'resources/app.asar'), runtimeRoot = path.join(unpacked, 'resources/ppt-runtime/win32-x64');
const results = [];
async function main() {
  const manifest = require(path.join(asar, 'package.json')); console.log(JSON.stringify({ name: manifest.name, version: manifest.version, electron: process.versions.electron, abi: process.versions.modules }));
  const Database = require(path.join(asar, 'node_modules/better-sqlite3')); const db = new Database(path.join(root, '解包原生.sqlite')); db.exec('CREATE TABLE proof(value TEXT)'); db.prepare('INSERT INTO proof VALUES (?)').run('中文实际原生模块'); assert.equal(db.prepare('SELECT value FROM proof').get().value, '中文实际原生模块'); db.close();
  const packedRequire = require('node:module').createRequire(path.join(asar, 'package.json'));
  for (const dependency of Object.keys(manifest.dependencies)) {
    const metadataPath = require('node:module').findPackageJSON(dependency, require('node:url').pathToFileURL(path.join(asar, 'package.json')));
    assert(metadataPath && fs.existsSync(metadataPath), `包内缺少生产依赖：${dependency}`);
  }
  results.push({ name: '实际ASAR生产依赖可解析/原生SQLite ABI/中文独立读写', status: 'PASS', version: manifest.version });
  if (manifest.name === 'jatoaibid') {
    const modules = await packedRequire('./electron/services/pi/piSessionFactory.cjs').loadPiModules();
    assert.equal(modules.piAiVersion, '1.0.0'); assert.equal(typeof modules.codingAgent.AgentSession, 'function');
    results.push({ name: '实际ASAR动态加载Pi1.0.0，不发送模型请求', status: 'PASS' });
  }
  const runtime = require(path.join(runtimeRoot, 'host-tools/pptRuntimeService.cjs')).createPptRuntimeService({ app: {}, rootOverride: runtimeRoot }); await runtime.verify();
  results.push({ name: '解包运行组件完整manifest逐文件hash', status: 'PASS' });
  const guard = await runtime.guard(root); results.push({ name: '解包自身固定Python与AppContainer实际attribution_guard', status: 'PASS', exitCode: guard.exitCode });
  await runtime.close();
}
main().catch((error) => { console.error(error.stack); results.push({ name: '解包真实探针', status: 'FAIL', error: error.stack }); process.exitCode = 1; }).finally(() => { fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实解包Electron RUN_AS_NODE/native/工具；不代表正常GUI启动或独立安装', unpacked, results }, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); });
