// 真正的 AppContainer 转换与 Electron 页面渲染；不调用模型或正式资源 Store。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow, nativeImage, session } = require('electron');
const { inspectPptx, hash } = require('../electron/services/pptTemplateService.cjs');
const { createResourcePreviewService } = require('../../management/electron/services/resourcePreviewService.cjs');
const evidenceRoot = path.resolve(__dirname, '../.tmp/ppt184-resource-center/preview-electron');
fs.mkdirSync(evidenceRoot, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidenceRoot, '隔离数据-')));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const results = [], deadline = setTimeout(() => app.exit(1), 180000);
async function main() {
  await app.whenReady();
  const prepare = createResourcePreviewService({ app, BrowserWindow, nativeImage, session });
  for (const name of ['wuhua', 'free']) {
    const root = fs.mkdtempSync(path.join(evidenceRoot, `${name}-`));
    fs.mkdirSync(path.join(root, 'assets'));
    const original = fs.readFileSync(path.join(evidenceRoot, '../baseline', `${name}-original.pptx`));
    const asset = { hash: hash(original), relativePath: 'assets/original.pptx' };
    fs.writeFileSync(path.join(root, asset.relativePath), original);
    const report = inspectPptx(path.join(root, asset.relativePath)), assets = [];
    // 只替代结果登记，原文件、实际转换器、操作系统隔离与浏览器渲染均真实运行。
    const store = { database: { prepare: () => ({ get: () => ({ n: assets.reduce((sum, item) => sum + item.bytes, 0) }) }) }, saveAsset: (item) => assets.push(item) };
    const previews = await prepare(asset, report, { root, store, quotaBytes: 512 * 1024 ** 2 });
    assert.equal(previews.length, report.pageCount);
    if (name === 'free') assert.equal(new Set(previews.map((image) => image.hash)).size, 4, '真实四页不能以同一空白截图代替');
    for (const image of previews) {
      assert.equal(image.originalHash, report.hash);
      assert.equal(hash(fs.readFileSync(path.join(root, 'assets', image.hash))), image.hash);
      assert(Math.abs(image.width / image.height - (report.aspectRatio === '4:3' ? 4 / 3 : 16 / 9)) < .01);
    }
    results.push({ name, status: 'PASS', root, originalHash: report.hash, previews });
  }
}
main().catch((error) => { console.error(error.stack); results.push({ status: 'FAIL', error: error.stack }); }).finally(() => {
  clearTimeout(deadline); fs.writeFileSync(path.join(evidenceRoot, 'evidence.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(JSON.stringify(results)); app.exit(results.some((item) => item.status === 'FAIL') ? 1 : 0);
});
