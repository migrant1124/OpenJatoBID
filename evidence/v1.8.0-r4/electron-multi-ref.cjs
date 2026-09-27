const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  const before = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const parent = before.works.find((work) => work.workId === '07ad8c64-2c3a-4cb1-9858-6edf7d4c0b95');
  const detail = before.assets[0];
  if (!parent || !detail) throw new Error('隔离测试素材不存在。');
  const response = await page.evaluate((input) => window.yibiao.imageStudio.start(input), {
    prompt: '以图 1 的室内猫和客厅为主体，以图 2 的猫眼特写作为色彩风格参考，生成一张自然写实的室内猫照片。',
    count: 1, size: '1536x1024', ratio: '3:2', parentWorkId: parent.workId,
    references: [{ workId: parent.workId, role: '主体' }, { assetId: detail.assetId, role: '风格' }],
  });
  let task;
  for (let i = 0; i < 180; i += 1) {
    const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
    task = state.tasks.find((item) => item.taskId === response.taskId);
    if (task && ['completed', 'failed', 'unknown', 'partial'].includes(task.status)) break;
    await page.waitForTimeout(1000);
  }
  const after = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const work = after.works.find((item) => item.taskId === response.taskId);
  const report = { task, work: work ? { workId: work.workId, kind: work.kind, parentWorkId: work.parentWorkId,
    generation: work.generation, width: work.width, height: work.height } : null,
    globalSizeUnchanged: before.imageModel.size === after.imageModel.size };
  if (work) {
    const image = await page.evaluate((workId) => window.yibiao.imageStudio.readManagedImage({ workId }), work.workId);
    fs.writeFileSync(path.join(output, 'multi-ref-result.png'), Buffer.from(image.dataUrl.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(output, 'multi-ref-result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
  await browser.close();
  if (task?.status !== 'completed') process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
