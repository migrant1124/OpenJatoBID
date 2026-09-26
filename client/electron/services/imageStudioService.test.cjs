const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const { __aiServiceRuntime } = require('./aiService.cjs');
const { createImageStudioSchema } = require('./sqliteDatabase.cjs');
const { createImageStudioService } = require('./imageStudioService.cjs');

test('草稿、生成快照、作品恢复与三种真实编码导出', async () => {
  assert.equal(__aiServiceRuntime.normalizeImagePrompt({ prompt: '红色咖啡杯', preservePrompt: true }), '红色咖啡杯');
  assert.match(__aiServiceRuntime.normalizeImagePrompt({ prompt: '设备图' }), /投标技术方案插图/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  const sourcePath = path.join(directory, 'source.png');
  await sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 220, g: 40, b: 80, alpha: 0.5 } } }).png().toFile(sourcePath);
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  createImageStudioSchema(db);
  let outputPath = '';
  let request = null;
  const service = createImageStudioService({
    db,
    app: {},
    configStore: { load: () => ({ image_model: { provider: 'mock', model_name: 'local-test', image_size: '8x6' } }) },
    aiService: {
      getImageModelAvailability: () => ({ available: true }),
      withQueueScope: () => ({ generateImage: async (input) => { request = input; return { file_path: sourcePath, asset_url: 'yibiao-asset://test/source.png', mime_type: 'image/png' }; } }),
    },
    dialogApi: { showSaveDialog: async ({ defaultPath }) => ({ canceled: false, filePath: outputPath = path.join(directory, defaultPath) }) },
  });
  assert.equal(service.saveDraft({ prompt: '一张透明的红图', revision: 0 }).draft.revision, 1);
  assert.equal(service.saveDraft({ prompt: '旧稿', revision: 0 }).conflict, true);
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('任务未完成')), 3000);
    const unsubscribe = service.onEvent((event) => {
      if (event.tasks[0]?.status === 'completed') { clearTimeout(timeout); unsubscribe(); resolve(event); }
    });
  });
  service.start({ prompt: '一张透明的红图' });
  await done;
  assert.equal(request.preservePrompt, true);
  const work = service.getState().works[0];
  assert.deepEqual([work.width, work.height, work.prompt], [8, 6, '一张透明的红图']);
  for (const [format, magic] of [['png', '89504e47'], ['jpg', 'ffd8ff'], ['webp', '52494646']]) {
    await service.exportImage({ workId: work.workId, format });
    assert.equal(fs.readFileSync(outputPath).subarray(0, magic.length / 2).toString('hex'), magic);
  }
  const reopened = new DatabaseSync(databasePath);
  createImageStudioSchema(reopened);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM image_studio_works').get().count, 1);
  assert.equal(reopened.prepare('SELECT prompt FROM image_studio_draft WHERE id = 1').get().prompt, '一张透明的红图');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), reopened.prepare('SELECT sha256 FROM image_studio_works').get().sha256);
  reopened.close();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
