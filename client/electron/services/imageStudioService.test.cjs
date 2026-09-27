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

test('参考收藏事务去重，取消不删个人副本且来源不覆盖编辑', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  createPromptLibrarySchema(db);
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  const library = createPromptLibraryStore({ db });
  const service = createImageStudioService({ db, promptLibraryStore: library,
    configStore: { load: () => ({ image_model: {} }) },
    aiService: { getImageModelAvailability: () => ({ available: false }) } });
  db.prepare(`INSERT INTO image_studio_reference_items (item_id, source_id, title_zh, title_original,
    prompt_zh, prompt_original, tags_json, cover_url, content_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('awesome-gpt-image:cup', 'awesome-gpt-image',
    '杯子', 'Cup', '白色杯子', 'White cup', '["摄影"]', 'https://example.com/cup.png', 'hash-1', '2026-09-01');
  const input = { sourceId: 'awesome-gpt-image', itemId: 'awesome-gpt-image:cup' };
  const saved = service.saveMyPrompt({ title: '先另存的杯子', contentMarkdown: '个人先存文本',
    originKind: 'reference', originSourceId: input.sourceId, originItemId: input.itemId,
    coverUrl: 'https://example.com/cup.png' });
  const repeated = service.saveMyPrompt({ title: '上游更新标题', contentMarkdown: '上游更新正文',
    originKind: 'reference', originSourceId: input.sourceId, originItemId: input.itemId });
  assert.equal(repeated.promptId, saved.promptId);
  assert.equal(repeated.contentMarkdown, '个人先存文本');
  const first = service.toggleReferenceFavorite({ ...input, isFavorite: true });
  const second = service.toggleReferenceFavorite({ ...input, isFavorite: true });
  assert.equal(first.promptId, saved.promptId);
  assert.equal(first.promptId, second.promptId);
  assert.equal(service.listMyPrompts().length, 1);
  library.updatePrompt({ promptId: first.promptId, contentMarkdown: '我改过的杯子' });
  service.toggleReferenceFavorite({ ...input, isFavorite: false });
  assert.equal(service.listMyPrompts()[0].contentMarkdown, '我改过的杯子');
  service.toggleReferenceFavorite({ ...input, isFavorite: true });
  assert.equal(service.listMyPrompts()[0].contentMarkdown, '我改过的杯子');
  assert.equal(service.listItems({ sourceId: input.sourceId }).items[0].isFavorite, true);
  assert.equal(service.listMyPrompts()[0].coverUrl, 'https://example.com/cup.png');
  db.close();
});

test('受管参考图实际字节超限时不发送模型请求', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-large-ref-'));
  const filePath = path.join(directory, 'oversized.png');
  fs.writeFileSync(filePath, Buffer.alloc(25_000_001));
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db); extendImageStudioSchema(db);
  db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
    VALUES ('large', ?, 'yibiao-asset://generated-images/oversized.png', 'image/png', 1, 1, 'hash', '2026-09-01')`).run(filePath);
  let calls = 0;
  const service = createImageStudioService({ db, configStore: { load: () => ({ image_model: {} }) },
    aiService: { getImageModelAvailability: () => ({ available: true }),
      withQueueScope: () => ({ generateImage: () => { calls += 1; } }) } });
  assert.throws(() => service.start({ prompt: '产品图', references: [{ assetId: 'large', role: '主体' }] }), /实际 PNG 超过 25 MB/);
  assert.equal(calls, 0);
  db.close(); fs.rmSync(directory, { recursive: true, force: true });
});

test('局部编辑以标注图请求，并逐像素保留选区外原图', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-edit-'));
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db); extendImageStudioSchema(db);
  const source = path.join(directory, 'source.png');
  const generated = path.join(directory, 'generated.png');
  await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff0000' } }).png().toFile(source);
  await sharp({ create: { width: 8, height: 6, channels: 4, background: '#0000ff' } }).png().toFile(generated);
  const masks = await Promise.all([4, 5, 6].map(async (x) => {
    const pixels = Buffer.alloc(8 * 6 * 4, 255);
    pixels[(3 * 8 + x) * 4 + 3] = 0;
    return sharp(pixels, { raw: { width: 8, height: 6, channels: 4 } }).png().toBuffer();
  }));
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
    VALUES ('asset', ?, 'yibiao-asset://generated-images/source.png', 'image/png', 8, 6, 'hash', ?)`).run(source, now);
  let request;
  const service = createImageStudioService({ db, app: { getPath: () => directory },
    configStore: { load: () => ({ image_model: { provider: 'mock', model_name: 'gpt-image-2', image_size: '1024x1024' } }) },
    aiService: { getImageModelAvailability: () => ({ available: true }),
      withQueueScope: () => ({ generateImage: async (input) => { request = input;
        return { file_path: generated, asset_url: 'yibiao-asset://generated-images/generated.png', mime_type: 'image/png' }; } }) },
  });
  const terminal = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('编辑任务超时')), 5000);
    service.onEvent((event) => {
      if (['completed', 'failed', 'unknown'].includes(event.tasks[0]?.status)) {
        clearTimeout(timeout); resolve(event.tasks[0]);
      }
    });
  });
  service.start({ prompt: '分区修改', kind: 'edit', size: '8x6', references: [{ assetId: 'asset', role: '主体' }],
    regions: masks.map((mask, index) => ({ prompt: ['改蓝', '改绿', '改黄'][index],
      maskDataUrl: `data:image/png;base64,${mask.toString('base64')}` })) });
  const task = await terminal;
  assert.equal(task.status, 'completed', task.error);
  assert.equal(request.mask, undefined);
  assert.equal(request.images.length, 4);
  assert.match(request.prompt, /图 2 的红色标记是修改区域 1，要求：改蓝/);
  assert.match(request.prompt, /图 4 的红色标记是修改区域 3，要求：改黄/);
  const marked = await Promise.all(request.images.slice(1).map((image) => sharp(image.buffer).raw().toBuffer()));
  assert.equal(marked[0][(3 * 8 + 4) * 4 + 2], 29);
  assert.equal(marked[0][(3 * 8 + 5) * 4 + 2], 0);
  assert.equal(marked[1][(3 * 8 + 5) * 4 + 2], 29);
  assert.equal(marked[2][(3 * 8 + 6) * 4 + 2], 29);
  assert.equal(request.size, '8x6');
  const workPath = db.prepare('SELECT file_path AS filePath FROM image_studio_works').get().filePath;
  const pixels = await sharp(workPath).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...pixels.subarray((3 * 8 + 4) * 4, (3 * 8 + 4) * 4 + 4)], [0, 0, 255, 255]);
  assert.deepEqual([...pixels.subarray((3 * 8 + 6) * 4, (3 * 8 + 6) * 4 + 4)], [0, 0, 255, 255]);
  db.close(); fs.rmSync(directory, { recursive: true, force: true });
});

test('图层换序后细修仍只写入稳定主体图层', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-psd-order-'));
  const source = path.join(directory, 'source.png');
  await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff0000' } }).png().toFile(source);
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db); extendImageStudioSchema(db);
  db.prepare(`INSERT INTO image_studio_psd_sessions
    (set_id, source_kind, source_id, source_path, width, height, status, created_at, updated_at, subject_layer_id, background_layer_id)
    VALUES ('set', 'asset', 'asset', ?, 8, 6, 'ready', '2026-09-01', '2026-09-01', 'subject', 'background')`).run(source);
  db.prepare(`INSERT INTO image_studio_psd_sessions
    (set_id, source_kind, source_id, source_path, width, height, status, created_at, updated_at)
    VALUES ('newer', 'asset', 'asset', ?, 8, 6, 'ready', '2026-09-02', '2026-09-02')`).run(source);
  const insert = db.prepare(`INSERT INTO image_studio_psd_layers
    (layer_id, set_id, name, file_path, asset_url, sort_order, sha256) VALUES (?, 'set', ?, ?, ?, ?, 'hash')`);
  insert.run('background', '背景', source, 'yibiao-asset://generated-images/background.png', 0);
  insert.run('subject', '主体', source, 'yibiao-asset://generated-images/subject.png', 1);
  insert.run('other', '另一对象', source, 'yibiao-asset://generated-images/other.png', 2);
  const service = createImageStudioService({ db, app: { getPath: () => directory },
    configStore: { load: () => ({ image_model: {} }) }, aiService: { getImageModelAvailability: () => ({ available: false }) } });
  assert.throws(() => service.updateLayer({ setId: 'set', layerId: 'background', sortOrder: 1 }), /最底层/);
  assert.equal(service.updateLayer({ setId: 'set', layerId: 'subject', sortOrder: 2 }).setId, 'set');
  const maskPixels = Buffer.alloc(8 * 6 * 4);
  maskPixels[(3 * 8 + 4) * 4 + 3] = 255;
  const mask = await sharp(maskPixels, { raw: { width: 8, height: 6, channels: 4 } }).png().toBuffer();
  assert.equal((await service.refineLayerSet({ setId: 'set', maskDataUrl: `data:image/png;base64,${mask.toString('base64')}` })).setId, 'set');
  const rows = db.prepare('SELECT layer_id AS id, file_path AS filePath FROM image_studio_psd_layers WHERE set_id = ?').all('set');
  const subject = await sharp(rows.find((row) => row.id === 'subject').filePath).ensureAlpha().raw().toBuffer();
  const background = await sharp(rows.find((row) => row.id === 'background').filePath).ensureAlpha().raw().toBuffer();
  assert.equal(subject[(3 * 8 + 4) * 4 + 3], 255);
  assert.equal(background[(3 * 8 + 4) * 4 + 3], 255);
  assert.equal(service.deleteLayer({ setId: 'set', layerId: 'other' }).setId, 'set');
  db.close(); fs.rmSync(directory, { recursive: true, force: true });
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
