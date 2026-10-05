// 使用解包程序自身 Electron 校验 ASAR、Pi、SQLite 与隔离器，数据仅写入新建测试目录。
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), management = args.includes('--management');
const project = path.resolve(__dirname, management ? '../../management' : '..');
const input = args.find((value) => value !== '--management');
const unpacked = path.resolve(input || path.join(project, 'release/win-unpacked'));
const manifest = require(path.join(project, 'package.json'));
const executable = path.join(unpacked, `${manifest.build.productName}.exe`);
if (!fs.existsSync(executable)) throw new Error(`解包程序缺失：${executable}`);
const base = path.join(project, '.tmp/ci-ppt-package'); fs.mkdirSync(base, { recursive: true });
const proof = fs.mkdtempSync(path.join(base, '隔离-'));
const result = spawnSync(executable, [path.join(__dirname, 'ppt-packaged-probe.cjs'), unpacked, proof], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit', timeout: 180000,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`解包 PPT/SDK 运行验证失败：${result.status}`);
console.log(`解包 PPT/SDK 运行证据：${proof}`);
