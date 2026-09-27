const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema, createPromptLibrarySchema } = require('../../client/electron/services/sqliteDatabase.cjs');
const { createAiService } = require('../../client/electron/services/aiService.cjs');
const { createImageStudioService } = require('../../client/electron/services/imageStudioService.cjs');
const { createPromptLibraryStore } = require('../../client/electron/services/promptLibraryStore.cjs');
const { writeLayeredPsd } = require('../../client/electron/services/imageStudioPsd.cjs');

async function main() {
  const output = path.join(__dirname, 'psd-poster-sample');
  fs.mkdirSync(output, { recursive: true });
  const db = new DatabaseSync(path.join(output, 'sample.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  createPromptLibrarySchema(db); createImageStudioSchema(db); extendImageStudioSchema(db);
  const app = { getPath: () => output, getVersion: () => '1.8.0-r4-probe' };
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'jatoaibid', 'user_config.json'), 'utf8'));
  const aiService = createAiService({ app, configStore: { load: () => config } });
  const service = createImageStudioService({ app, db, aiService,
    promptLibraryStore: createPromptLibraryStore({ db }), configStore: { load: () => config } });
  const file = path.join(__dirname, 'source-cover-sample/workspace/generated-images/studio-cover-471723329d4fb76a64f9535990115201d17bdf7c25612a8993c959a0119b9278.png');
  const workId = crypto.randomUUID(); const taskId = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO image_studio_tasks (task_id, status, prompt, model_provider, model_name,
    requested_size, created_at, updated_at) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?)`).run(taskId, '茶饮海报',
      config.image_model.provider, config.image_model.model_name, '1080x744', now, now);
  db.prepare(`INSERT INTO image_studio_works (work_id, task_id, file_path, asset_url, mime_type,
    width, height, sha256, created_at) VALUES (?, ?, ?, ?, 'image/png', 1080, 744, ?, ?)`).run(workId, taskId,
      file, 'yibiao-asset://generated-images/poster.png', crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), now);
  try {
    const session = await service.createLayerSet({ workId });
    const layers = db.prepare('SELECT name, file_path AS filePath FROM image_studio_psd_layers WHERE set_id = ? ORDER BY sort_order').all(session.setId);
    const psd = path.join(output, 'tea-poster-layered.psd');
    const exported = await writeLayeredPsd({ layers, outputPath: psd });
    const report = { success: true, textCalls: 1, setId: session.setId, width: session.width,
      height: session.height, layers: layers.map(({ name, filePath }) => ({ name, filePath })), psd, exported };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
  } catch (error) {
    const report = { success: false, textCalls: 1, message: String(error.message || error).slice(0, 700) };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report)); process.exitCode = 1;
  } finally { db.close(); }
}

main();
