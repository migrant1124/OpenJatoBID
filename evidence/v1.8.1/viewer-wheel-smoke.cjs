const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  await page.reload();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: '提示词中心' }).click();
  const first = page.locator('.image-studio-reference-card').first();
  await first.waitFor();
  await first.locator('.image-studio-reference-preview button').click();
  const viewer = page.getByRole('dialog', { name: '图片预览' });
  const image = viewer.locator('img');
  const before = await image.evaluate((node) => node.style.transform);
  const box = await image.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(150);
  const after = await image.evaluate((node) => node.style.transform);
  await page.screenshot({ path: path.join(__dirname, 'electron-ui/viewer-wheel.png') });
  const report = { before, after, changed: before !== after };
  fs.writeFileSync(path.join(__dirname, 'electron-ui/viewer-wheel-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
