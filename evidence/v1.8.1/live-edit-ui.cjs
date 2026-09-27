const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  await page.getByRole('dialog', { name: '局部修改选区' }).getByRole('button', { name: '取消' }).click();
  const before = await page.evaluate(() => window.yibiao.imageStudio.getState());
  await page.getByRole('button', { name: '局部修改' }).click();
  const dialog = page.getByRole('dialog', { name: '局部修改选区' });
  const canvas = dialog.locator('canvas[aria-label="图片选区画布"]');
  const box = await canvas.boundingBox();
  async function rectangle(left, top, right, bottom) {
    await page.mouse.move(box.x + box.width * left, box.y + box.height * top);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * right, box.y + box.height * bottom);
    await page.mouse.up();
  }
  await rectangle(.08, .2, .2, .35);
  await dialog.getByRole('button', { name: '新增修改区域' }).click();
  await rectangle(.75, .2, .87, .35);
  await dialog.locator('.image-studio-region-inputs textarea').first().fill('在此处添加淡蓝色柔和光斑');
  await dialog.locator('.image-studio-region-inputs textarea').last().fill('在此处添加淡绿色柔和光斑');
  await page.screenshot({ path: path.join(output, 'multi-region-before-submit.png') });
  await dialog.getByRole('button', { name: '提交局部修改' }).click();
  await page.waitForFunction(async (count) => (await window.yibiao.imageStudio.getState()).works.length > count,
    before.works.length, { timeout: 180000 });
  const after = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const work = after.works.find((item) => !before.works.some((old) => old.workId === item.workId));
  const report = { success: Boolean(work), workId: work?.workId, parentWorkId: work?.parentWorkId,
    filePath: work?.filePath, newWorkCount: after.works.length - before.works.length,
    task: after.tasks.find((item) => item.taskId === work?.taskId) };
  fs.writeFileSync(path.join(output, 'live-edit-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
