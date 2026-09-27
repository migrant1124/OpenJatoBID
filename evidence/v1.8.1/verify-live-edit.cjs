const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('../../client/node_modules/sharp');

async function main() {
  const database = new DatabaseSync(path.join(__dirname, '../../.tmp/v181-electron-userdata/workspace/yibiao.sqlite'));
  const work = database.prepare(`SELECT * FROM image_studio_works WHERE parent_work_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get();
  const parent = database.prepare('SELECT * FROM image_studio_works WHERE work_id = ?').get(work.parent_work_id);
  const task = database.prepare('SELECT status, request_json FROM image_studio_tasks WHERE task_id = ?').get(work.task_id);
  database.close();
  const original = await sharp(parent.file_path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const edited = await sharp(work.file_path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let changed = 0; let outsideChanged = 0;
  for (let index = 0; index < original.info.width * original.info.height; index += 1) {
    const x = index % original.info.width; const y = Math.floor(index / original.info.width);
    const inside = y >= 190 && y <= 370 && ((x >= 75 && x <= 215) || (x >= 760 && x <= 900));
    const offset = index * 4;
    if (original.data[offset] !== edited.data[offset] || original.data[offset + 1] !== edited.data[offset + 1] ||
      original.data[offset + 2] !== edited.data[offset + 2] || original.data[offset + 3] !== edited.data[offset + 3]) {
      changed += 1; if (!inside) outsideChanged += 1;
    }
  }
  const report = { status: task.status, workId: work.work_id, parentWorkId: work.parent_work_id,
    regionCount: JSON.parse(task.request_json).regions.length, changedPixels: changed, outsideChangedPixels: outsideChanged,
    outputPath: work.file_path };
  fs.writeFileSync(path.join(__dirname, 'electron-ui/live-edit-verified.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
