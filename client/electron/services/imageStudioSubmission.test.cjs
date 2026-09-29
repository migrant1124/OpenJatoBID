const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const { createImageStudioSchema, extendImageStudioSchema, createImageStudioRiskSchema } = require('./sqliteDatabase.cjs');
const { createImageStudioService } = require('./imageStudioService.cjs');
const { createImageStudioConnection } = require('./imageStudioConnection.cjs');

function setup(key = 'test-key', errorStatus = 0, directory) {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  createImageStudioRiskSchema(db);
  const calls = [];
  const service = createImageStudioService({ db, app: directory ? { getPath: () => directory } : {},
    connection: { readKey: () => key, status: () => ({ configured: Boolean(key), baseUrl: 'https://img-api.jlaudeapi.com/v1' }) },
    configStore: { load: () => ({ image_model: { image_size: '1024x1024' } }) },
    aiService: { withQueueScope: () => ({ generateImage: async (input) => {
      calls.push(input); input.onSent();
      const error = new Error('模拟网络已发送但没有结果');
      error.statusCode = errorStatus;
      throw error;
    } }) },
  });
  return { db, service, calls };
}

test('六项白名单保留 Nano 精确请求 ID，均可走文生图模拟请求', async () => {
  const { db, service, calls } = setup();
  const ids = [
    'gpt-image-2', 'gpt-image-2-1k', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare',
    'Nano Banana Pro', 'Nano Banana 2',
  ];
  const models = service.getState().models;
  assert.deepEqual(models.map((item) => item.requestModelId), ids);
  assert.deepEqual(models.filter((item) => item.actions.includes('edit')).map((item) => item.requestModelId), ids);
  for (const model of models) service.submit({ prompt: '蓝色猫', modelKey: model.key, requestId: model.key });
  assert.throws(() => service.submit({ prompt: '蓝色猫', modelKey: 'grok', requestId: 'grok' }), /批准范围/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(calls.map((call) => call.configSnapshot.image_model.model_name).sort(), ids.sort());
  assert(calls.every((call) => call.configSnapshot.image_model.base_url === 'https://img-api.jlaudeapi.com/v1'));
  db.close();
});

test('六项参考图模拟请求均传递原图字节与精确模型 ID', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-reference-'));
  const filePath = path.join(directory, 'reference.png');
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
  fs.writeFileSync(filePath, png);
  const { db, service, calls } = setup();
  try {
    db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
      VALUES ('reference', ?, 'yibiao-asset://generated-images/reference.png', 'image/png', 2, 2, 'test', '2026-09-29')`).run(filePath);
    const models = service.getState().models;
    for (const model of models) service.submit({ prompt: '蓝色猫', modelKey: model.key, requestId: `ref-${model.key}`,
      references: [{ assetId: 'reference', role: '主体' }] });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(calls.map((call) => call.configSnapshot.image_model.model_name).sort(),
      models.map((model) => model.requestModelId).sort());
    assert(calls.every((call) => call.images.length === 1 && call.images[0].buffer.equals(png)));
  } finally {
    db.close();
    fs.unlinkSync(filePath);
    fs.rmdirSync(directory);
  }
});

test('六项局部修改均提交原图和标记图，PSD 仍限定原模型', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-edit-models-'));
  const filePath = path.join(directory, 'source.png');
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const pixels = Buffer.alloc(2 * 2 * 4, 255);
  pixels[3] = 0;
  const mask = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  fs.writeFileSync(filePath, png);
  const { db, service, calls } = setup('test-key', 0, directory);
  try {
    db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
      VALUES ('source', ?, 'yibiao-asset://generated-images/source.png', 'image/png', 2, 2, 'test', '2026-09-29')`).run(filePath);
    const models = service.getState().models;
    for (const model of models) service.submit({ prompt: '把选区改成蓝色', kind: 'edit', modelKey: model.key,
      requestId: `edit-${model.key}`, references: [{ assetId: 'source', role: '主体' }],
      regions: [{ prompt: '改成蓝色', maskDataUrl: `data:image/png;base64,${mask.toString('base64')}` }] });
    await assert.rejects(service.createLayerSet({ assetId: 'source', modelKey: 'banana2' }), /PSD 背景编辑方式/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(calls.map((call) => call.configSnapshot.image_model.model_name).sort(),
      models.map((model) => model.requestModelId).sort());
    assert(calls.every((call) => call.images.length === 2 && call.images[0].buffer.equals(png)));
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('生成不调用风险文本模型；同 ID 重放去重、异内容冲突、已发结果未知', async () => {
  const { db, service, calls } = setup();
  const input = { prompt: '蓝色猫', modelKey: 'gpt2', requestId: 'once' };
  const first = service.submit(input);
  assert.deepEqual(service.submit(input), first);
  assert.throws(() => service.submit({ ...input, prompt: '红色猫' }), /参数已变化/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].configSnapshot.image_model.model_name, 'gpt-image-2');
  assert.equal(db.prepare('SELECT status FROM image_studio_tasks WHERE task_id = ?').get(first.taskId).status, 'unknown');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_studio_risk_checks').get().count, 0);
  assert.deepEqual(service.submit(input), first);
  db.close();
});

test('未填金龙生图 Key 不复制其他渠道 Key', () => {
  const { db, service } = setup('');
  assert.equal(service.getState().connection.configured, false);
  assert.throws(() => service.submit({ prompt: '蓝色猫', modelKey: 'gpt2', requestId: 'no-key' }), /金龙中转站的生图模型 API Key/);
  db.close();
});

test('生图连接只读取设置中的金龙生图 Key', () => {
  const config = { image_model: { provider: 'custom', api_key: 'other-key' },
    image_model_profiles: { jinlong: { api_key: 'jinlong-key' } } };
  const connection = createImageStudioConnection({ load: () => config });
  assert.equal(connection.readKey(), 'jinlong-key');
  assert.equal(connection.status().configured, true);
  config.image_model_profiles.jinlong.api_key = '';
  assert.equal(connection.readKey(), '');
  assert.equal(connection.status().configured, false);
});

test('服务方确定性拒绝后不继续发送剩余张数', async () => {
  const { db, service, calls } = setup('test-key', 400);
  const { taskId } = service.submit({ prompt: '蓝色猫', modelKey: 'gpt2', requestId: 'rejected', count: 4 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.equal(db.prepare('SELECT status FROM image_studio_tasks WHERE task_id = ?').get(taskId).status, 'failed');
  db.close();
});
