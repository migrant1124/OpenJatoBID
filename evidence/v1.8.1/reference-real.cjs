const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
  const asset = state.assets[0];
  if (!asset) throw new Error('隔离工作区缺少真实参考图。');
  const task = await page.evaluate((assetId) => window.yibiao.imageStudio.start({
    prompt: '以参考图中猫的眼睛和毛色为主体，生成一张自然光下的猫咪肖像。', count: 1,
    size: '1024x1024', references: [{ assetId, role: '主体' }],
  }), asset.assetId);
  let current;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await page.waitForTimeout(2000);
    current = (await page.evaluate(() => window.yibiao.imageStudio.getState())).tasks.find((item) => item.taskId === task.taskId);
    if (['completed', 'partial', 'failed', 'unknown'].includes(current?.status)) break;
  }
  const database = new DatabaseSync(path.join(__dirname, '../../.tmp/v181-electron-userdata/workspace/yibiao.sqlite'));
  const row = database.prepare('SELECT status, kind, model_name, reference_assets_json FROM image_studio_tasks WHERE task_id = ?').get(task.taskId);
  const work = database.prepare('SELECT file_path FROM image_studio_works WHERE task_id = ?').get(task.taskId);
  database.close();
  const output = path.join(__dirname, 'reference-real-result.png');
  if (work) fs.copyFileSync(work.file_path, output);
  const report = { taskId: task.taskId, status: row.status, kind: row.kind, model: row.model_name,
    referenceCount: JSON.parse(row.reference_assets_json).length, output: work ? output : null,
    error: current?.error || null };
  fs.writeFileSync(path.join(__dirname, 'reference-real-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
