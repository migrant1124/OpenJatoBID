const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });
  const notice = page.getByText('知道了', { exact: true });
  try { await notice.waitFor({ state: 'visible', timeout: 3000 }); await notice.click(); } catch { /* no notice */ }
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('heading', { name: '创作输入' }).waitFor();
  const layout = await page.evaluate(() => {
    const fields = document.querySelector('.image-studio-compose-fields');
    const textarea = fields.querySelector('textarea');
    const choices = fields.querySelector('.image-studio-two-fields');
    const generate = document.querySelector('.image-studio-generate');
    return { promptHeight: Math.round(textarea.getBoundingClientRect().height),
      gapBelowChoices: Math.round(generate.getBoundingClientRect().top - choices.getBoundingClientRect().bottom),
      fieldsClientHeight: fields.clientHeight, fieldsScrollHeight: fields.scrollHeight };
  });
  await page.screenshot({ path: path.join(__dirname, 'electron-ui/followup-compose.png') });
  await page.locator('button[title="放大当前作品"]').click();
  const viewer = page.getByRole('dialog', { name: '图片预览' });
  const buttons = await viewer.locator('.image-studio-viewer-toolbar button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  const sizeButton = viewer.getByRole('button', { name: '切换预览尺寸' });
  await sizeButton.click();
  const actualTransform = await viewer.locator('img').evaluate((node) => node.style.transform);
  await sizeButton.click();
  const fitTransform = await viewer.locator('img').evaluate((node) => node.style.transform);
  await page.screenshot({ path: path.join(__dirname, 'electron-ui/followup-viewer.png') });
  const result = { layout, viewerButtons: buttons, actualTransform, fitTransform };
  fs.writeFileSync(path.join(__dirname, 'electron-ui/followup-result.json'), JSON.stringify(result, null, 2));
  console.log(result);
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
