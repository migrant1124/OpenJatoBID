const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../client/node_modules/sharp');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: 'AI 生图' }).click();
  await page.locator('.image-studio-two-fields select').nth(1).selectOption('1536x1024');
  await page.locator('#image-studio-prompt').fill('只将猫的眼睛改成明亮的蓝色，保持其它区域不变。');
  const before = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const parent = before.works[0];
  const parentImage = await page.evaluate((workId) => window.yibiao.imageStudio.readManagedImage({ workId }), parent.workId);
  await page.getByRole('button', { name: '局部修改' }).click();
  const dialog = page.getByRole('dialog', { name: '局部修改选区' });
  await dialog.waitFor();
  const canvas = dialog.locator('canvas');
  await canvas.evaluate((element) => new Promise((resolve) => {
    const ready = () => element.width > 300 && element.height > 300 ? resolve() : setTimeout(ready, 50);
    ready();
  }));
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * .61, box.y + box.height * .64);
  await page.screenshot({ path: path.join(output, 'edit-selection-before-submit.png') });
  await dialog.getByRole('button', { name: '提交局部修改' }).click();
  let task;
  for (let i = 0; i < 180; i += 1) {
    const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
    task = state.tasks.find((item) => item.taskId !== before.tasks[0]?.taskId);
    if (task && ['completed', 'failed', 'unknown', 'partial'].includes(task.status)) break;
    await page.waitForTimeout(1000);
  }
  const after = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const work = after.works.find((item) => item.parentWorkId === parent.workId && item.kind === 'edit');
  const report = { task, parentWorkId: parent.workId, work: work ? { workId: work.workId,
    parentWorkId: work.parentWorkId, width: work.width, height: work.height, kind: work.kind } : null,
    maskRetainedOnFailure: task?.status !== 'completed' ? await dialog.isVisible() : null,
    screenshot: task?.status === 'completed' ? 'edit-complete.png' : 'edit-failed-selection-retained.png' };
  await page.screenshot({ path: path.join(output, report.screenshot) });
  if (work) {
    const row = await page.evaluate((workId) => window.yibiao.imageStudio.readManagedImage({ workId }), work.workId);
    const saved = path.join(output, 'edit-output.png');
    fs.writeFileSync(saved, Buffer.from(row.dataUrl.split(',')[1], 'base64'));
    const result = await sharp(saved).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const original = await sharp(Buffer.from(parentImage.dataUrl.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer();
    let changed = 0; let outsideChanged = 0;
    for (let y = 0; y < result.info.height; y += 1) for (let x = 0; x < result.info.width; x += 1) {
      const offset = (y * result.info.width + x) * 4;
      const different = result.data.subarray(offset, offset + 4).some((value, channel) => value !== original[offset + channel]);
      if (!different) continue;
      changed += 1;
      if (Math.hypot(x - result.info.width * .61, y - result.info.height * .64) > 45) outsideChanged += 1;
    }
    report.outputPath = saved; report.changedPixels = changed; report.outsideChangedPixels = outsideChanged;
    report.outputDimensions = [result.info.width, result.info.height];
  }
  fs.writeFileSync(path.join(output, 'edit-ui-result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
  await browser.close();
  if (task?.status !== 'completed') process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
