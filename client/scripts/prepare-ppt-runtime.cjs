// 只准备锁定的本地运行包；不安装到系统、不执行下载来的 Skill。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const lock = require('../electron/services/ppt-runtime-lock.json');
const { execFileSync } = require('node:child_process');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
async function download(entry) {
  const cache = path.resolve(__dirname, '../.tmp/ppt-runtime-download', entry.sha256);
  if (fs.existsSync(cache) && hash(fs.readFileSync(cache)) === entry.sha256) return fs.readFileSync(cache);
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`运行包下载失败：${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== entry.sha256) throw new Error('运行包校验失败');
  fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, data);
  return data;
}
function unpack(data, target, prefix = '') {
  for (const entry of new AdmZip(data).getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const relative = entry.entryName.slice(prefix.length);
    const dest = path.resolve(target, relative);
    if (!relative || !dest.startsWith(`${path.resolve(target)}${path.sep}`) || ((entry.attr >>> 16) & 0xf000) === 0xa000) throw new Error('运行包路径异常');
    if (fs.existsSync(dest) && fs.statSync(dest).size === entry.header.size && hash(fs.readFileSync(dest)) === hash(entry.getData())) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, entry.getData());
  }
}
async function main() {
  const previewOnly = process.argv.includes('--management');
  const root = path.resolve(__dirname, previewOnly ? '../../management/vendor/ppt-runtime/win32-x64' : '../vendor/ppt-runtime/win32-x64');
  fs.mkdirSync(root, { recursive: true });
  const localSkillZip = process.argv.slice(2).find((value) => value !== '--management');
  const skill = localSkillZip ? fs.readFileSync(localSkillZip) : await download(lock.skill);
  if (hash(skill) !== lock.skill.sha256) throw new Error('完整 Skill 包校验失败');
  unpack(skill, path.join(root, 'ppt-master'), lock.skill.prefix);
  require('../electron/services/pptSkillPackage.cjs').completeSkillReferences(skill, lock.skill.prefix, path.join(root, 'ppt-master'));
  unpack(await download(lock.python), path.join(root, 'python'));
  fs.writeFileSync(path.join(root, 'python/python313._pth'), 'python313.zip\n.\nLib/site-packages\n', 'utf8');
  for (const wheel of lock.wheels) {
    unpack(await download(wheel), path.join(root, 'python/Lib/site-packages'));
    console.log(`已校验组件 ${wheel.name} ${wheel.version}`);
  }
  if (!previewOnly) {
    const media = new AdmZip(await download(lock.ffmpeg));
    for (const name of ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt']) {
      const entry = media.getEntry(lock.ffmpeg.prefix + name); if (!entry) throw new Error('媒体运行组件或许可缺失');
      const target = path.join(root, 'ffmpeg', name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, entry.getData());
    }
  }
  fs.copyFileSync(path.resolve(__dirname, '../electron/services/ppt-runtime-lock.json'), path.join(root, 'runtime-lock.json'));
  if (process.platform !== 'win32') throw new Error('当前运行包需要在 Windows 编译固定隔离器');
  const hostTools = path.join(root, 'host-tools'); fs.mkdirSync(hostTools, { recursive: true });
  const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/r:System.Web.Extensions.dll', `/out:${path.join(hostTools, 'pptSandbox.exe')}`, path.join(__dirname, 'pptSandbox.cs')], { windowsHide: true, stdio: 'inherit' });
  fs.copyFileSync(path.resolve(__dirname, '../electron/services/pptTrustedTool.py'), path.join(hostTools, 'pptTrustedTool.py'));
  fs.copyFileSync(path.resolve(__dirname, '../electron/services/pptRuntimeService.cjs'), path.join(hostTools, 'pptRuntimeService.cjs'));
  fs.copyFileSync(path.resolve(__dirname, '../electron/services/ppt-runtime-lock.json'), path.join(hostTools, 'ppt-runtime-lock.json'));
  const files = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name !== 'files-manifest.json') files.push({ path: path.relative(root, full).replace(/\\/g, '/'), bytes: fs.statSync(full).size, hash: hash(fs.readFileSync(full)) });
    }
  }
  scan(root); fs.writeFileSync(path.join(root, 'files-manifest.json'), JSON.stringify({ version: 1, files }, null, 2), 'utf8');
  console.log(JSON.stringify({ root, skill: lock.skill.version, python: lock.python.version, files: files.length, status: 'FILES_PREPARED_NOT_RUNTIME_TESTED' }));
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { unpack };
