const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  await page.getByRole('button', { name: 'AI 生图' }).click();
  await page.getByRole('button', { name: '分层 PSD' }).click();
  await page.getByRole('dialog', { name: '分层 PSD' }).waitFor();
  await page.screenshot({ path: path.join(output, 'psd-before-auto.png') });
  await page.getByRole('button', { name: '自动拆层' }).click();
  let result;
  try {
    await page.locator('.image-studio-layer-list > div').first().waitFor({ timeout: 120000 });
    result = { success: true, layerRows: await page.locator('.image-studio-layer-list > div').count(),
      layerNames: await page.locator('.image-studio-layer-list input').evaluateAll((inputs) => inputs.map((input) => input.value)) };
    await page.screenshot({ path: path.join(output, 'psd-after-auto.png') });
  } catch (error) {
    result = { success: false, message: String(error.message || error).slice(0, 500),
      pageTail: (await page.locator('body').innerText()).slice(-700) };
    await page.screenshot({ path: path.join(output, 'psd-auto-failed.png') });
  }
  fs.writeFileSync(path.join(output, 'psd-ui-result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result));
  await browser.close();
  if (!result.success) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
