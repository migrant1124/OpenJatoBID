const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema, createImageStudioRiskSchema } = require('./sqliteDatabase.cjs');
const { createImageStudioService } = require('./imageStudioService.cjs');

function setup(key = 'test-key', errorStatus = 0) {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  createImageStudioRiskSchema(db);
  const calls = [];
  const service = createImageStudioService({ db, app: {},
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

test('六项白名单保留 Nano 精确请求 ID，未知协议不试发', () => {
  const { db, service, calls } = setup();
  assert.deepEqual(service.getState().models.map((item) => item.requestModelId), [
    'gpt-image-2', 'gpt-image-2-1k', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare',
    'Nano Banana Pro', 'Nano Banana 2',
  ]);
  for (const modelKey of ['banana_pro', 'banana2']) assert.throws(() =>
    service.submit({ prompt: '蓝色猫', modelKey, requestId: modelKey }), /生成方式尚未通过/);
  assert.throws(() => service.submit({ prompt: '蓝色猫', modelKey: 'gpt2_1k', requestId: 'one-k' }), /生成方式尚未通过/);
  assert.throws(() => service.submit({ prompt: '蓝色猫', modelKey: 'sunburst', requestId: 'reference-unknown', references: [{ role: '主体' }] }), /生成方式尚未通过/);
  assert.throws(() => service.submit({ prompt: '蓝色猫', modelKey: 'grok', requestId: 'grok' }), /批准范围/);
  assert.equal(calls.length, 0);
  db.close();
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

test('未填独立金龙 Key 不复制旧图像 Key', () => {
  const { db, service } = setup('');
  assert.equal(service.getState().connection.configured, false);
  assert.throws(() => service.submit({ prompt: '蓝色猫', modelKey: 'gpt2', requestId: 'no-key' }), /金龙 API Key/);
  db.close();
});

test('服务方确定性拒绝后不继续发送剩余张数', async () => {
  const { db, service, calls } = setup('test-key', 400);
  const { taskId } = service.submit({ prompt: '蓝色猫', modelKey: 'gpt2', requestId: 'rejected', count: 4 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.equal(db.prepare('SELECT status FROM image_studio_tasks WHERE task_id = ?').get(taskId).status, 'failed');
  db.close();
});
