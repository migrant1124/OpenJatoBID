const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'local-edit-r2');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: '局部修改' }).click();
  const dialog = page.getByRole('dialog', { name: '局部修改' });
  await dialog.waitFor();
  const canvas = dialog.locator('canvas[aria-label="图片选区画布"]');
  await canvas.waitFor();
  await page.screenshot({ path: path.join(output, 'LE-S01-open.png') });
  const initial = await dialog.evaluate((node) => ({
    dialog: node.getBoundingClientRect().toJSON(),
    body: node.querySelector('.local-edit-body')?.getBoundingClientRect().toJSON(),
    stage: node.querySelector('.local-edit-stage')?.getBoundingClientRect().toJSON(),
    panel: node.querySelector('.local-edit-panel')?.getBoundingClientRect().toJSON(),
    count: node.querySelectorAll('.local-edit-card').length,
  }));
  await dialog.getByRole('button', { name: '矩形框选' }).click();
  const box = await canvas.boundingBox();
  const select = async (x1, y1, x2, y2) => {
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 5 });
    await page.mouse.up();
  };
  await select(.15, .16, .3, .38);
  const field1 = dialog.getByRole('textbox', { name: '修改区域 1 的要求' });
  await field1.waitFor();
  const focused = await field1.evaluate((node) => document.activeElement === node);
  await page.screenshot({ path: path.join(output, 'LE-S02-first-selection.png') });
  await field1.fill('把左侧区域改为暖色，保留纹理');
  await select(.42, .18, .55, .36);
  await dialog.getByRole('textbox', { name: '修改区域 2 的要求' }).fill('改成深蓝色，保留形状');
  await select(.67, .2, .83, .4);
  await dialog.getByRole('textbox', { name: '修改区域 3 的要求' }).fill('改成浅绿色，保留纹理');
  await page.screenshot({ path: path.join(output, 'LE-S03-three-regions.png') });
  const three = await dialog.evaluate((node) => ({ count: node.querySelectorAll('.local-edit-card').length,
    labels: [...node.querySelectorAll('.local-edit-card strong')].map((item) => item.textContent),
    prompts: [...node.querySelectorAll('.local-edit-card textarea')].map((item) => item.value),
    submit: node.querySelector('.local-edit-footer .image-studio-primary')?.textContent }));
  await dialog.getByRole('button', { name: '删除修改区域 2' }).click();
  await page.screenshot({ path: path.join(output, 'LE-S04-delete-middle.png') });
  const two = await dialog.evaluate((node) => ({ count: node.querySelectorAll('.local-edit-card').length,
    prompts: [...node.querySelectorAll('.local-edit-card textarea')].map((item) => item.value) }));
  await dialog.getByRole('button', { name: '放大' }).click();
  const beforeWheel = await dialog.locator('.local-edit-zoom output').innerText();
  const stage = dialog.locator('.local-edit-stage');
  const scrollBefore = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(100);
  const afterWheel = await dialog.locator('.local-edit-zoom output').innerText();
  const scrollAfter = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  await page.mouse.wheel(0, -300);
  const dprBefore = await page.evaluate(() => window.devicePixelRatio);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  const afterCtrlWheel = await dialog.locator('.local-edit-zoom output').innerText();
  const dprAfter = await page.evaluate(() => window.devicePixelRatio);
  await page.screenshot({ path: path.join(output, 'LE-S05-zoom.png') });
  const result = { initial, focused, three, two, beforeWheel, afterWheel, scrollBefore, scrollAfter,
    afterCtrlWheel, dprBefore, dprAfter, errors };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
