const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'local-edit-r2');
  const screens = [];
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(output, `LE-S06-${width}x${height}.png`) });
    screens.push(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight],
      dialog: document.querySelector('.local-edit-dialog')?.getBoundingClientRect().toJSON(),
      textareaHeight: document.querySelector('.local-edit-card textarea')?.getBoundingClientRect().height,
      footer: document.querySelector('.local-edit-footer')?.getBoundingClientRect().toJSON(),
      toolbarOverflow: document.querySelector('.local-edit-tools')?.scrollWidth > document.querySelector('.local-edit-tools')?.clientWidth })));
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  const dialog = page.getByRole('dialog', { name: '局部修改' });
  if (await dialog.locator('.local-edit-card').count() !== 2) throw new Error('需要先运行 local-edit-r2-ui.cjs 建立两个区域。');
  const stage = dialog.locator('.local-edit-stage');
  const stageBox = await stage.boundingBox();
  const panBefore = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  await dialog.locator('.local-edit-head h2').click();
  await page.keyboard.down('Space');
  await page.mouse.move(stageBox.x + stageBox.width * .6, stageBox.y + stageBox.height * .6);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * .4, stageBox.y + stageBox.height * .4, { steps: 5 });
  await page.mouse.up(); await page.keyboard.up('Space');
  const panAfter = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  await dialog.getByRole('button', { name: '撤回' }).click();
  const undoCount = await dialog.locator('.local-edit-card').count();
  await dialog.getByRole('button', { name: '重做' }).click();
  const redoCount = await dialog.locator('.local-edit-card').count();
  await dialog.getByRole('button', { name: '清空选区' }).click();
  await dialog.getByRole('button', { name: '清空全部' }).click();
  const clearCount = await dialog.locator('.local-edit-card').count();
  await dialog.getByRole('button', { name: '撤回' }).click();
  const restoredCount = await dialog.locator('.local-edit-card').count();
  const result = { screens, panBefore, panAfter, undoCount, redoCount, clearCount, restoredCount };
  fs.writeFileSync(path.join(output, 'extra-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
