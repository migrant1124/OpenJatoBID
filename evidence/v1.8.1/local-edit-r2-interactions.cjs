const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1536, height: 1024 }); await page.reload();
  const notice = page.getByText('知道了', { exact: true }); if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  const trigger = page.getByRole('button', { name: '局部修改' }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: '局部修改' });
  await dialog.getByRole('button', { name: '矩形框选' }).click();
  const canvas = dialog.locator('canvas[aria-label="图片选区画布"]'); await canvas.waitFor();
  const box = await canvas.boundingBox();
  const select = async (x) => { await page.mouse.move(box.x + box.width * x, box.y + box.height * .22);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * (x + .08), box.y + box.height * .34); await page.mouse.up(); };
  await select(.18); await dialog.getByRole('textbox', { name: '修改区域 1 的要求' }).fill('第一处');
  await select(.45); await dialog.getByRole('textbox', { name: '修改区域 2 的要求' }).fill('第二处');
  await dialog.getByRole('button', { name: '激活修改区域 1' }).click();
  const imageToCard = await dialog.locator('.local-edit-card').first().evaluate((node) => node.classList.contains('active'));
  await dialog.locator('.local-edit-card').nth(1).click();
  const cardToImage = await dialog.getByRole('button', { name: '激活修改区域 2' }).evaluate((node) => node.classList.contains('active'));
  await dialog.getByRole('button', { name: '删除修改区域 2' }).click();
  await dialog.getByRole('button', { name: '撤回' }).click();
  await dialog.getByRole('button', { name: '放大' }).click();
  const redoAfterZoom = await dialog.getByRole('button', { name: '重做' }).isEnabled();
  await dialog.getByRole('button', { name: '重做' }).click();
  const redoCount = await dialog.locator('.local-edit-card').count();
  const stage = dialog.locator('.local-edit-stage');
  const beforeMap = await stage.evaluate((node) => [node.scrollLeft, node.scrollTop]);
  await dialog.locator('.local-edit-minimap').click({ position: { x: 145, y: 75 } });
  const afterMap = await stage.evaluate((node) => [node.scrollLeft, node.scrollTop]);
  await dialog.getByRole('button', { name: '取消' }).click();
  const confirmation = await page.getByRole('alertdialog', { name: '确认放弃修改' }).isVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  const retained = await dialog.getByRole('textbox', { name: '修改区域 1 的要求' }).inputValue();
  await dialog.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();
  const focusReturned = await trigger.evaluate((node) => document.activeElement === node);
  const result = { imageToCard, cardToImage, redoAfterZoom, redoCount, beforeMap, afterMap,
    confirmation, retained, focusReturned };
  fs.writeFileSync(path.join(__dirname, 'local-edit-r2', 'interactions-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
