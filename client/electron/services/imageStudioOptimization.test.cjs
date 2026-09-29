const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema, createPromptLibrarySchema } = require('./sqliteDatabase.cjs');
const { createImageStudioService } = require('./imageStudioService.cjs');
const { __aiServiceRuntime } = require('./aiService.cjs');

test('优化只发一次文本请求并保留指定文字与模板变量', async () => {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db); extendImageStudioSchema(db);
  const calls = []; const events = [];
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ model_name: 'mock-text', base_url: 'https://mock.invalid', api_key: 'test', image_model: {} }) },
    aiService: { chat: async (request) => { calls.push(request); request.onDelta('蓝色猫与“标题”，{颜色}'); return '蓝色猫与“标题”，{颜色}'; } },
  });
  const input = { prompt: '蓝色猫与“标题”，{颜色}', mode: '简化', modelKey: 'banana2', size: '1024x1024',
    references: [], useKnowledge: false, requestId: 'opt-1', onEvent: (event) => events.push(event) };
  const result = await service.optimizePrompt(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].noRetry, true);
  assert.equal(calls[0].stream, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.sources, []);
  assert.equal(events.filter((event) => event.status === 'streaming').length, 1);
  assert.equal((await service.optimizePrompt({ ...input, requestId: 'opt-2' })).cacheHit, true);
  assert.equal(calls.length, 1);
  db.close();
});

test('SSE 跨字节中文按片段回调，length 结束不算完成', async () => {
  const oldFetch = global.fetch;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-stream-'));
  const encoder = new TextEncoder();
  let finish = 'stop';
  global.fetch = async () => {
    const bytes = encoder.encode(`data: {"choices":[{"delta":{"content":"蓝色猫"}}]}\n\ndata: {"choices":[{"finish_reason":"${finish}"}]}\n\ndata: [DONE]\n\n`);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 23)); controller.enqueue(bytes.slice(23, 49)); controller.enqueue(bytes.slice(49)); controller.close();
    } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const app = { getPath: () => temp, getVersion: () => '1.8.2' };
  const config = { api_key: 'test', model_name: 'mock', base_url: 'https://mock.invalid/v1', request_mode: 'stream' };
  const deltas = [];
  try {
    const result = await __aiServiceRuntime.chatWithConfig(app, config, { messages: [{ role: 'user', content: '猫' }],
      noRetry: true, stream: true, requireCompleteStream: true, onDelta: (delta) => deltas.push(delta) });
    assert.equal(result, '蓝色猫');
    assert.deepEqual(deltas, ['蓝色猫']);
    finish = 'length';
    await assert.rejects(__aiServiceRuntime.chatWithConfig(app, config, { messages: [{ role: 'user', content: '猫' }],
      noRetry: true, stream: true, requireCompleteStream: true }), /未完成/);
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('优化检索已启用的既有来源，停用后不再注入且缓存失效', async () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
  createImageStudioSchema(db); extendImageStudioSchema(db);
  let calls = 0;
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ model_name: 'mock-text', base_url: 'https://mock.invalid', api_key: 'test', image_model: {} }) },
    aiService: { chat: async () => { calls += 1; return '产品摄影'; } },
  });
  const input = { prompt: '产品摄影', modelKey: 'gpt2', requestId: 'source-on' };
  const first = await service.optimizePrompt(input);
  assert.ok(first.sources.some((item) => item.sourceId === 'openjatobid-starter'));
  service.saveSource({ sourceId: 'openjatobid-starter', enabled: false });
  const second = await service.optimizePrompt({ ...input, requestId: 'source-off' });
  assert.equal(second.cacheHit, false);
  assert.ok(second.sources.every((item) => item.sourceId !== 'openjatobid-starter'));
  assert.equal(calls, 2);
  db.close();
});
