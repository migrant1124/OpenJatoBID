const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'local-edit-r2');
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: '局部修改' }).click();
  const dialog = page.getByRole('dialog', { name: '局部修改' });
  const canvas = dialog.locator('canvas[aria-label="图片选区画布"]');
  await canvas.waitFor();
  await dialog.getByRole('button', { name: '魔法套选' }).click();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * .5, box.y + box.height * .56);
  await dialog.locator('.local-edit-card').first().waitFor({ timeout: 180000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '修改区域 1 的要求');
  await page.screenshot({ path: path.join(output, 'LE-S08-real-sam.png') });
  const result = await dialog.evaluate((node) => ({ cards: node.querySelectorAll('.local-edit-card').length,
    mask: node.querySelector('.local-edit-mask')?.getAttribute('style')?.slice(0, 80),
    error: node.querySelector('.local-edit-footer > span')?.textContent,
    focused: document.activeElement?.getAttribute('aria-label') }));
  fs.writeFileSync(path.join(output, 'sam-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
