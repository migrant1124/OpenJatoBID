const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  const before = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const submitted = await page.evaluate((input) => window.yibiao.imageStudio.start(input), {
    prompt: '一个橙色圆柱形陶瓷花瓶，白色背景，居中产品摄影，柔和侧光。',
    count: 1, size: '1024x1024', ratio: '1:1', references: [],
  });
  let task;
  for (let i = 0; i < 180; i += 1) {
    const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
    task = state.tasks.find((item) => item.taskId === submitted.taskId);
    if (task && ['completed', 'failed', 'unknown', 'partial'].includes(task.status)) break;
    await page.waitForTimeout(1000);
  }
  const after = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const work = after.works.find((item) => item.taskId === submitted.taskId);
  const report = { task, work: work ? { workId: work.workId, kind: work.kind,
    width: work.width, height: work.height, generation: work.generation } : null,
    globalSizeUnchanged: before.imageModel.size === after.imageModel.size };
  const output = path.join(__dirname, 'electron-ui');
  if (work) {
    const image = await page.evaluate((workId) => window.yibiao.imageStudio.readManagedImage({ workId }), work.workId);
    fs.writeFileSync(path.join(output, 'text-to-image-1024.png'), Buffer.from(image.dataUrl.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(output, 'text-to-image-result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
  await browser.close();
  if (task?.status !== 'completed') process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
