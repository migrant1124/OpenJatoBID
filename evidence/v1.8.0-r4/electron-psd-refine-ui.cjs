const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: 'AI 生图' }).click();
  const workId = '07ad8c64-2c3a-4cb1-9858-6edf7d4c0b95';
  const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const index = state.works.slice(0, 12).findIndex((work) => work.workId === workId);
  if (index < 0) throw new Error('原始室内图不在最近作品中。');
  await page.locator('.image-studio-filmstrip button').nth(index).click();
  await page.getByRole('button', { name: '分层 PSD' }).click();
  const dialog = page.getByRole('dialog', { name: '分层 PSD' });
  await dialog.waitFor();
  const before = (await page.evaluate((id) => window.yibiao.imageStudio.listLayerSets({ workId: id }), workId))[0];
  const subjectId = before.subjectLayerId;
  const subjectBefore = await page.evaluate((layerId) => window.yibiao.imageStudio.readManagedImage({ layerId }), subjectId);
  const digest = (dataUrl) => crypto.createHash('sha256').update(Buffer.from(dataUrl.split(',')[1], 'base64')).digest('hex');
  await dialog.locator('.image-studio-layer-list > div').nth(1).getByRole('button', { name: '上移图层' }).click();
  await dialog.getByRole('button', { name: '细修主体边缘' }).click();
  const editor = page.getByRole('dialog', { name: '细修图层轮廓' });
  await editor.waitFor();
  const canvas = editor.locator('canvas');
  await canvas.evaluate((element) => new Promise((resolve) => {
    const ready = () => element.width > 300 && element.height > 300 ? resolve() : setTimeout(ready, 50);
    ready();
  }));
  await editor.getByRole('button', { name: '橡皮' }).click();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * .6, box.y + box.height * .7);
  await page.screenshot({ path: path.join(output, 'psd-refine-selection.png') });
  await editor.getByRole('button', { name: '保存细修' }).click();
  await editor.waitFor({ state: 'hidden' });
  const after = (await page.evaluate((id) => window.yibiao.imageStudio.listLayerSets({ workId: id }), workId))[0];
  const subjectAfter = await page.evaluate((layerId) => window.yibiao.imageStudio.readManagedImage({ layerId }), subjectId);
  await page.screenshot({ path: path.join(output, 'psd-refined.png') });
  const subjectIndex = after.layers.findIndex((layer) => layer.layerId === subjectId);
  await dialog.locator('.image-studio-layer-list > div').nth(subjectIndex).getByRole('button', { name: '隐藏图层' }).click();
  await page.screenshot({ path: path.join(output, 'psd-subject-hidden.png') });
  const report = { setId: after.setId, subjectId, subjectStillFirst: after.layers[0].layerId === subjectId,
    subjectChanged: digest(subjectBefore.dataUrl) !== digest(subjectAfter.dataUrl),
    visibleAfterHide: (await page.evaluate((id) => window.yibiao.imageStudio.listLayerSets({ workId: id }), workId))[0].layers.find((layer) => layer.layerId === subjectId).visible };
  fs.writeFileSync(path.join(output, 'psd-refine-ui-result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
  await browser.close();
  if (!report.subjectStillFirst || !report.subjectChanged || report.visibleAfterHide) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
