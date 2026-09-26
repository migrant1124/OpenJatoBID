const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const { __aiServiceRuntime } = require('./aiService.cjs');
const { createImageStudioSchema, createPromptLibrarySchema, extendImageStudioSchema } = require('./sqliteDatabase.cjs');
const { createImageStudioService } = require('./imageStudioService.cjs');
const { createPromptLibraryStore } = require('./promptLibraryStore.cjs');

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
  extendImageStudioSchema(db);
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
  extendImageStudioSchema(reopened);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM image_studio_works').get().count, 1);
  assert.equal(reopened.prepare('SELECT prompt FROM image_studio_draft WHERE id = 1').get().prompt, '一张透明的红图');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), reopened.prepare('SELECT sha256 FROM image_studio_works').get().sha256);
  reopened.close();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('生图用途元数据跨分组重命名保留，旧对话提示词不混入', () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  const library = createPromptLibraryStore({ db });
  const group = library.createGroup({ groupName: '生图提示词' });
  library.createPrompt({ groupId: group.groupId, title: '旧对话', contentMarkdown: '原对话提示词' });
  const service = createImageStudioService({ db, promptLibraryStore: library,
    configStore: { load: () => ({ image_model: {} }) },
    aiService: { getImageModelAvailability: () => ({ available: false }) } });
  const image = service.saveMyPrompt({ groupId: group.groupId, title: '杯子', contentMarkdown: '白色杯子' });
  library.updateGroup({ groupId: group.groupId, groupName: '我的产品摄影' });
  assert.equal(service.listMyPrompts()[0].promptId, image.promptId);
  assert.equal(service.listMyPrompts().length, 1);
  assert.equal(library.listPrompts({ groupId: group.groupId }).length, 2);
  db.close();
});

test('停止未发送任务只暂停目标作用域且不调用图片模型', async () => {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  let calls = 0;
  let paused = '';
  const service = createImageStudioService({ db,
    configStore: { load: () => ({ image_model: { provider: 'jinlong', model_name: 'gpt-image-2-1k', image_size: '8x6' } }) },
    aiService: { getImageModelAvailability: () => ({ available: true }),
      withQueueScope: () => ({ generateImage: () => { calls += 1; } }),
      pauseQueueScope: (scope) => { paused = scope; } },
  });
  const { taskId } = service.start({ prompt: '取消前的请求' });
  service.cancelTask({ taskId });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  assert.equal(paused, `image-studio:${taskId}`);
  assert.equal(service.getState().tasks[0].status, 'cancelled');
  db.close();
});

test('已发送任务停止等待后结果仍保存且进度不回跳', async () => {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-stop-'));
  const filePath = path.join(directory, 'result.png');
  await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff0000' } }).png().toFile(filePath);
  let finish;
  let sent;
  const statuses = [];
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ image_model: { provider: 'jinlong', model_name: 'gpt-image-2-1k', image_size: '8x6' } }) },
    aiService: { getImageModelAvailability: () => ({ available: true }),
      withQueueScope: () => ({ generateImage: (request) => { request.onSent(); sent(); return new Promise((resolve) => { finish = resolve; }); } }),
      pauseQueueScope: () => {} },
  });
  const sentPromise = new Promise((resolve) => { sent = resolve; });
  service.onEvent((event) => statuses.push(event.tasks[0]?.status));
  const { taskId } = service.start({ prompt: '停止后仍接收已发送结果' });
  await sentPromise;
  service.cancelTask({ taskId });
  finish({ file_path: filePath, asset_url: 'yibiao-asset://test/result.png', mime_type: 'image/png' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(service.getState().works.length, 1);
  assert.equal(service.getState().tasks[0].status, 'completed');
  assert.equal(statuses.slice(statuses.indexOf('stopped_waiting') + 1).includes('downloading'), false);
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
