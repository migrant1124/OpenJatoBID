const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { app, BrowserWindow, nativeImage, session } = require('electron');
const evidenceBase = path.resolve(__dirname, '../.tmp/ppt184-resource-center/preview-electron');
fs.mkdirSync(evidenceBase, { recursive: true });
const root = fs.mkdtempSync(path.join(evidenceBase, '清理复验-')); app.setPath('userData', path.join(root, '隔离数据'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const results = [], deadline = setTimeout(() => app.exit(1), 240000);
async function main() {
  await app.whenReady();
  const Database = require('better-sqlite3'), database = new Database(':memory:');
  const management = path.resolve(__dirname, '../../management');
  require(path.join(management, 'electron/services/migrations.cjs')).migrateDatabase(database);
  const store = require(path.join(management, 'electron/services/resourceStore.cjs')).createResourceStore({ database });
  const inspect = require(path.join(management, 'electron/services/resourceDownloadService.cjs')).inspectPptx;
  const prepare = require(path.join(management, 'electron/services/resourcePreviewService.cjs')).createResourcePreviewService({ app, BrowserWindow, nativeImage, session, rootOverride: path.join(management, 'vendor/ppt-runtime/win32-x64') });
  for (const name of ['wuhua-original', 'free-original']) {
    const bytes = fs.readFileSync(path.resolve(evidenceBase, '../baseline', `${name}.pptx`));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex'); fs.writeFileSync(path.join(root, hash), bytes);
    const asset = { hash, assetId: hash, relativePath: hash }, report = inspect(bytes);
    const pages = await prepare(asset, report, { root, store, quotaBytes: 512 * 1024 ** 2, signal: new AbortController().signal });
    assert.equal(pages.length, report.pageCount);
    assert.equal(fs.readdirSync(path.join(root, '.preview-candidates')).length, 0, '每次成功转换后不保留临时原包/HTML');
    if (name === 'free-original') assert.equal(new Set(pages.map((page) => page.hash)).size, 4, '不能以相同空白截图代替四页');
    for (const page of pages) {
      assert.equal(page.originalHash, hash); assert.ok(page.bytes > 1000);
      const file = path.join(root, store.getAsset(page.assetId).relative_path), image = nativeImage.createFromPath(file);
      assert.equal(image.isEmpty(), false); assert.ok(Math.abs(image.getSize().width / image.getSize().height - report.aspectRatio) < .02);
      fs.copyFileSync(file, path.join(root, `${name}-${page.page + 1}.png`));
    }
    results.push({ name, status: 'PASS', originalHash: hash, report, pages });
    const bad = { ...asset, hash: '0'.repeat(64) };
    await assert.rejects(prepare(bad, report, { root, store, quotaBytes: 512 * 1024 ** 2 }), /hash 不符/);
    assert.equal(fs.readdirSync(path.join(root, '.preview-candidates')).length, 0, '失败转换也不累积临时原包');
  }
  database.close();
}
main().catch((error) => { console.error(error); results.push({ status: 'FAIL', error: error.stack }); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实管理端预览服务、固定工具、Windows AppContainer、Electron 截图；原文件两个样本，不是全库验收', results }, null, 2), 'utf8');
  console.log(JSON.stringify({ root, results: results.map(({ name, status, error }) => ({ name, status, error })) })); clearTimeout(deadline); app.exit(process.exitCode || 0);
});
