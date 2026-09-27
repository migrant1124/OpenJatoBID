const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  fs.mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('heading', { name: '生图模式' }).waitFor();
  const metrics = await page.evaluate(() => ({
    promptHeight: Math.round(document.querySelector('.image-studio-compose-fields > textarea')?.getBoundingClientRect().height || 0),
    toolButtonHeight: Math.round(document.querySelector('.image-studio-tool-row > button')?.getBoundingClientRect().height || 0),
    taskTypeButtons: document.querySelectorAll('.image-studio-presets button').length,
    qualityControls: document.querySelectorAll('.image-studio-two-fields label').length,
  }));
  await page.screenshot({ path: path.join(output, 'create.png') });
  const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
  if (state.assets.length) {
    await page.getByRole('button', { name: '放大参考图片 1' }).click();
    await page.getByRole('dialog', { name: '图片预览' }).waitFor();
    await page.screenshot({ path: path.join(output, 'reference-viewer.png') });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '提示词中心' }).click();
  await page.locator('.image-studio-reference-card').first().waitFor();
  await page.screenshot({ path: path.join(output, 'prompt-center.png') });
  const promptCardCount = await page.locator('.image-studio-reference-card').count();
  const pagination = await page.locator('.image-studio-pagination').innerText();
  await page.getByRole('button', { name: 'AI 生图' }).click();
  await page.getByRole('button', { name: '局部修改' }).click();
  await page.getByRole('dialog', { name: '局部修改选区' }).waitFor();
  await page.getByRole('button', { name: '矩形框选' }).click();
  const canvas = page.getByRole('img', { name: '待处理原图' }).locator('..').locator('canvas[aria-label="图片选区画布"]');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .38, box.y + box.height * .5);
  await page.mouse.up();
  await page.getByRole('button', { name: '新增修改区域' }).click();
  await page.mouse.move(box.x + box.width * .57, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5);
  await page.mouse.up();
  await page.locator('.image-studio-region-inputs textarea').first().fill('改为蓝色');
  await page.locator('.image-studio-region-inputs textarea').last().fill('添加柔和高光');
  await page.screenshot({ path: path.join(output, 'two-regions.png') });
  const result = { screenshots: fs.readdirSync(output).filter((name) => name.endsWith('.png')), metrics,
    regionLabels: await page.locator('.image-studio-region-number').allTextContents(),
    regionInputs: await page.locator('.image-studio-region-inputs textarea').count(),
    promptCardCount, pagination };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
