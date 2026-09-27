const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'local-edit-r2');
  const userData = path.resolve(__dirname, '../../.tmp/v181-electron-userdata');
  await page.setViewportSize({ width: 1536, height: 1024 }); await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.locator('.image-studio-filmstrip button').first().click();
  const before = await page.evaluate(async () => window.yibiao.imageStudio.getState());
  const configPath = path.join(userData, 'user_config.json');
  if (!path.resolve(configPath).startsWith(userData + path.sep)) throw new Error('隔离配置路径越界，停止测试。');
  const original = fs.readFileSync(configPath);
  try {
    await page.getByRole('button', { name: '局部修改' }).click();
    const dialog = page.getByRole('dialog', { name: '局部修改' });
    const canvas = dialog.locator('canvas[aria-label="图片选区画布"]'); await canvas.waitFor();
    await dialog.getByRole('button', { name: '矩形框选' }).click();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * .15, box.y + box.height * .15); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .28, box.y + box.height * .31, { steps: 4 }); await page.mouse.up();
    const field = dialog.getByRole('textbox', { name: '修改区域 1 的要求' });
    await field.fill('把这一处改为暖色，保留纹理');
    const config = JSON.parse(original.toString('utf8'));
    config.image_model.status = 'unavailable';
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
    await dialog.getByRole('button', { name: /提交局部修改/ }).click();
    await page.getByText(/生图模型未测试可用/).first().waitFor();
    const after = await page.evaluate(async () => window.yibiao.imageStudio.getState());
    const result = { draft: await field.inputValue(), regions: await dialog.locator('.local-edit-card').count(),
      error: await dialog.locator('.local-edit-footer > span').innerText(), taskDelta: after.tasks.length - before.tasks.length };
    await page.screenshot({ path: path.join(output, 'LE-S07-failure-recovery.png') });
    fs.writeFileSync(path.join(output, 'failure-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { fs.writeFileSync(configPath, original); await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
