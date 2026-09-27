const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  await page.reload();
  await page.setViewportSize({ width: 1024, height: 640 });
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: 'AI 生图' }).click();
  const button = page.locator('.image-studio-generate');
  const rect = await button.boundingBox();
  const layout = await page.evaluate(() => ({ bodyScrolls: document.body.scrollHeight > document.body.clientHeight,
    composeScrolls: document.querySelector('.image-studio-compose-fields').scrollHeight >
      document.querySelector('.image-studio-compose-fields').clientHeight }));
  await page.screenshot({ path: path.join(__dirname, 'electron-ui/create-125-percent-equivalent.png') });
  await page.locator('.image-studio-two-fields select').nth(1).scrollIntoViewIfNeeded();
  const sizeReachable = await page.locator('.image-studio-two-fields select').nth(1).isVisible();
  const report = { viewport: [1024, 640], equivalentPhysicalViewport: [1280, 800],
    generateVisible: Boolean(rect && rect.y >= 0 && rect.y + rect.height <= 640),
    sizeReachable, ...layout };
  fs.writeFileSync(path.join(__dirname, 'electron-ui/scaled-result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
  await browser.close();
  if (!report.generateVisible || !sizeReachable || layout.bodyScrolls) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
