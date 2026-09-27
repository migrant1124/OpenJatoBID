const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'local-edit-r2');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  const workIndex = await page.evaluate(async () => (await window.yibiao.imageStudio.getState()).works.findIndex((work) => work.workId === 'v181-layer-ui-sample'));
  if (workIndex < 0) throw new Error('隔离数据缺少既有 PSD 细修样本。');
  await page.locator('.image-studio-filmstrip button').nth(workIndex).click();
  await page.getByRole('button', { name: '分层 PSD' }).click();
  const layers = page.getByRole('dialog', { name: '分层 PSD' });
  await layers.locator('button[title="细修选区"]').first().click();
  const refine = page.getByRole('dialog', { name: '细修图层轮廓' });
  const save = refine.getByRole('button', { name: '保存细修' });
  await save.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="细修图层轮廓"] .image-studio-primary')?.disabled);
  const canvas = refine.locator('canvas[aria-label="图片选区画布"]');
  const point = await canvas.evaluate((node) => {
    const { width, height } = node; const data = node.getContext('2d').getImageData(0, 0, width, height).data;
    let best = null;
    for (let y = 20; y < height - 20; y += 8) for (let x = 20; x < width - 20; x += 8) {
      if (data[(y * width + x) * 4 + 3] < 200) continue;
      const distance = (x - width / 2) ** 2 + (y - height / 2) ** 2;
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    if (!best) throw new Error('图层没有可细修的非透明像素');
    const stage = node.closest('.image-studio-mask-stage');
    stage.scrollTo(best.x - stage.clientWidth / 2, best.y - stage.clientHeight / 2);
    return best;
  });
  const before = await canvas.evaluate((node) => {
    const data = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count += 1;
    return count;
  });
  await page.screenshot({ path: path.join(output, 'LE-S08-psd-refine.png') });
  await refine.getByRole('button', { name: '橡皮' }).click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + point.x / 1536 * box.width, box.y + point.y / 1024 * box.height);
  await page.mouse.down(); await page.mouse.up();
  const after = await canvas.evaluate((node) => {
    const data = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count += 1;
    return count;
  });
  if (after >= before) throw new Error('细修画笔没有改变图层 alpha');
  await save.click(); await refine.waitFor({ state: 'hidden' });
  const persisted = await page.evaluate(async () => {
    const set = (await window.yibiao.imageStudio.listLayerSets({ workId: 'v181-layer-ui-sample' }))[0];
    const image = await window.yibiao.imageStudio.readManagedImage({ layerId: set.layers[1].layerId });
    const picture = new Image(); picture.src = image.dataUrl; await picture.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(picture, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count += 1;
    return count;
  });
  if (persisted !== after) throw new Error('细修 alpha 未持久化到对象图层');
  const result = { hasPromptCard: 0, point: [point.x, point.y], alphaBefore: before, alphaAfter: after,
    persistedAlpha: persisted, saved: true,
    layerCount: (await page.evaluate(async () => (await window.yibiao.imageStudio.listLayerSets({ workId: 'v181-layer-ui-sample' }))[0].layers.length)) };
  fs.writeFileSync(path.join(output, 'psd-refine-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); await browser.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
