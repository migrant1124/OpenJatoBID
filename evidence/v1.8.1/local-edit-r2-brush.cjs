const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'local-edit-r2');
  await page.setViewportSize({ width: 1536, height: 1024 }); await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: '局部修改' }).click();
  const dialog = page.getByRole('dialog', { name: '局部修改' });
  const canvas = dialog.locator('canvas[aria-label="图片选区画布"]'); await canvas.waitFor();
  const box = await canvas.boundingBox();
  const points = [[.14, .13], [.32, .13], [.33, .36], [.14, .36], [.14, .13]];
  await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height); await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 5 });
  await page.mouse.up();
  await dialog.locator('.local-edit-card').first().waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '修改区域 1 的要求');
  await page.screenshot({ path: path.join(output, 'LE-brush-closed.png') });
  const fill = await dialog.evaluate(async (node) => {
    const style = node.querySelector('.local-edit-mask').style.maskImage;
    const source = style.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)[0];
    const picture = new Image(); picture.src = source; await picture.decode();
    const canvas = document.createElement('canvas'); canvas.width = picture.width; canvas.height = picture.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(picture, 0, 0);
    const alpha = (x, y) => ctx.getImageData(Math.round(x * picture.width), Math.round(y * picture.height), 1, 1).data[3];
    return { inside: alpha(.24, .24), outside: alpha(.45, .45) };
  });
  await dialog.getByRole('button', { name: '矩形框选' }).click();
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .13); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .3, { steps: 5 }); await page.mouse.up();
  const abandoned = await dialog.evaluate((node) => ({ cards: node.querySelectorAll('.local-edit-card').length,
    numbers: [...node.querySelectorAll('.local-edit-card strong')].map((item) => item.textContent),
    count: node.querySelector('.local-edit-panel-head strong')?.textContent }));
  const result = { fill, abandoned };
  fs.writeFileSync(path.join(output, 'brush-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
