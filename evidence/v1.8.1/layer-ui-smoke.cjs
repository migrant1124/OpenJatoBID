const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: '分层 PSD' }).click();
  const dialog = page.getByRole('dialog', { name: '分层 PSD' });
  await dialog.getByRole('button', { name: '导出 PSD' }).waitFor();
  await page.screenshot({ path: path.join(output, 'layers-composite.png') });
  await dialog.getByRole('button', { name: '背景底板', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'layers-background.png') });
  await dialog.getByRole('button', { name: '预览 橘猫' }).click();
  await page.screenshot({ path: path.join(output, 'layers-cat-transparent.png') });
  const firstObject = dialog.locator('.image-studio-layer-list > div').nth(1);
  const name = firstObject.locator('input');
  await name.fill('橘猫独立层');
  await name.blur();
  await page.waitForTimeout(250);
  const setId = await page.evaluate(async () => (await window.yibiao.imageStudio.listLayerSets({ workId: 'v181-layer-ui-sample' }))[0].setId);
  const state = await page.evaluate(async () => (await window.yibiao.imageStudio.listLayerSets({ workId: 'v181-layer-ui-sample' }))[0]);
  const report = { setId, layerCount: state.layers.length, renamed: state.layers[1].name,
    backgroundLayerId: state.backgroundLayerId,
    screenshots: ['layers-composite.png', 'layers-background.png', 'layers-cat-transparent.png'] };
  fs.writeFileSync(path.join(output, 'layer-ui-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
