const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
    aiService: { chat: async (request) => { calls.push(request); request.onAttempt(); request.onDelta('蓝色猫与“标题”，{颜色}'); return '蓝色猫与“标题”，{颜色}'; } },
  });
  const input = { prompt: '蓝色猫与“标题”，{颜色}', mode: '简化', modelKey: 'banana2', size: '1024x1024',
    references: [], useKnowledge: false, requestId: 'opt-1', onEvent: (event) => events.push(event) };
  await assert.rejects(service.optimizePrompt({ ...input, mode: '', requestId: 'no-mode' }), /优化方向无效/);
  assert.equal(calls.length, 0);
  const result = await service.optimizePrompt(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].noRetry, true);
  assert.equal(calls[0].stream, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(events.filter((event) => ['queued', 'dispatching', 'streaming'].includes(event.status)).map((event) => event.status),
    ['queued', 'dispatching', 'streaming']);
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
  const input = { prompt: '产品摄影', mode: '优化', modelKey: 'gpt2', requestId: 'source-on' };
  const first = await service.optimizePrompt(input);
  assert.ok(first.sources.some((item) => item.sourceId === 'openjatobid-starter'));
  service.saveSource({ sourceId: 'openjatobid-starter', enabled: false });
  const second = await service.optimizePrompt({ ...input, requestId: 'source-off' });
  assert.equal(second.cacheHit, false);
  assert.ok(second.sources.every((item) => item.sourceId !== 'openjatobid-starter'));
  assert.equal(calls, 2);
  db.close();
});

test('优化案例快照保留完整原文和实际发送文本，并限制跨窗口读取', async () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db); createImageStudioSchema(db); extendImageStudioSchema(db);
  let actualMessage = '';
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ model_name: 'mock-text', base_url: 'https://mock.invalid', api_key: 'test', image_model: {} }) },
    aiService: { chat: async (request) => {
      actualMessage = request.messages[1].content;
      request.onResponse?.();
      return '产品摄影，清楚留白';
    } },
  });
  for (let i = 0; i < 30 && !service.knowledgeStatus().ready; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const result = await service.optimizePrompt({ prompt: '产品摄影，清楚留白', mode: '产品摄影',
    modelKey: 'gpt2', requestId: 'case-1', ownerId: 7, useKnowledge: true });
  assert.ok(result.sources.length > 0);
  const first = result.sources[0];
  const detail = service.optimizationCase(result.sessionId, first.caseSnapshotId, 7);
  assert.ok(detail.promptOriginal.length > 0);
  assert.ok(actualMessage.includes(detail.sentText));
  assert.equal(detail.sentStatus, 'submitted');
  assert.throws(() => service.optimizationCase(result.sessionId, first.caseSnapshotId, 8), /无权/);
  const cached = await service.optimizePrompt({ prompt: '产品摄影，清楚留白', mode: '产品摄影',
    modelKey: 'gpt2', requestId: 'case-2', ownerId: 8, useKnowledge: true });
  assert.equal(cached.cacheHit, true);
  assert.notEqual(cached.sources[0].caseSnapshotId, first.caseSnapshotId);
  assert.equal(service.optimizationCase(cached.sessionId, cached.sources[0].caseSnapshotId, 8).sentStatus, 'historical');
  service.saveSource({ sourceId: 'openjatobid-starter', enabled: false });
  assert.deepEqual(service.optimizationCase(result.sessionId, first.caseSnapshotId, 7).promptOriginal, detail.promptOriginal);
  assert.throws(() => service.optimizationCase(result.sessionId, first.caseSnapshotId, 8), /无权/);
  service.saveOptimizationEdit({ sessionId: result.sessionId, text: '人工改稿', ownerId: 7, recoverable: true });
  assert.equal(db.prepare('SELECT edited_text FROM image_studio_optimization_sessions WHERE session_id = ?').get(result.sessionId).edited_text, '人工改稿');
  assert.equal(service.latestOptimization(7).edited, '人工改稿');
  assert.equal(service.latestOptimization(8), null);
  service.saveOptimizationEdit({ sessionId: result.sessionId, text: '人工改稿', ownerId: 7, recoverable: false });
  assert.equal(service.latestOptimization(7), null);
  db.close();
});

test('排队取消与发起后失败分别记录待提供和送达未知', async () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db); createImageStudioSchema(db); extendImageStudioSchema(db);
  let entered;
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ model_name: 'mock-text', base_url: 'https://mock.invalid', api_key: 'test' }) },
    aiService: { chat: (request) => new Promise((_, reject) => {
      entered?.();
      request.signal.addEventListener('abort', () => reject(new Error('已取消')));
    }) },
  });
  const started = new Promise((resolve) => { entered = resolve; });
  const queued = service.optimizePrompt({ prompt: '产品摄影', mode: '优化', modelKey: 'gpt2', requestId: 'queued-cancel' });
  await started;
  service.cancelOptimization('queued-cancel');
  await assert.rejects(queued, /取消/);
  assert.equal(service.optimizationCases('queued-cancel', 0).sentStatus, 'pending');
  db.close();

  const failedDb = new DatabaseSync(':memory:');
  createPromptLibrarySchema(failedDb); createImageStudioSchema(failedDb); extendImageStudioSchema(failedDb);
  const failedService = createImageStudioService({ db: failedDb, app: {},
    configStore: { load: () => ({ model_name: 'mock-text', base_url: 'https://mock.invalid', api_key: 'test' }) },
    aiService: { chat: async (request) => { request.onAttempt(); throw new Error('网络失败'); } },
  });
  await assert.rejects(failedService.optimizePrompt({ prompt: '产品摄影', mode: '优化', modelKey: 'gpt2', requestId: 'after-attempt' }), /网络失败/);
  assert.equal(failedService.optimizationCases('after-attempt', 0).sentStatus, 'unknown');
  failedDb.close();
});

test('混合英文案例按原文显示，单条译文保留原样文字并复用缓存', async () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db); createImageStudioSchema(db); extendImageStudioSchema(db);
  let translationCalls = 0;
  let resolveLate;
  let lateMode = false;
  const service = createImageStudioService({ db, app: {},
    configStore: { load: () => ({ model_name: 'mock-text', base_url: 'https://mock.invalid', api_key: 'test' }) },
    aiService: { chat: async (request) => {
      if (request.logTitle !== '生图模式-单条案例翻译') return '产品摄影';
      translationCalls += 1;
      if (lateMode) return new Promise((resolve) => { resolveLate = resolve; });
      return '为华为手机制作产品摄影，保留原样文字 ABC 和 {name}，2 件商品。';
    } },
  });
  const result = await service.optimizePrompt({ prompt: '产品摄影', mode: '优化', modelKey: 'gpt2', requestId: 'mixed-language' });
  const id = result.sources[0].caseSnapshotId;
  const row = db.prepare('SELECT detail_json FROM image_studio_optimization_cases WHERE case_id = ?').get(id);
  const detail = JSON.parse(row.detail_json);
  detail.promptOriginal = '华为手机 product photography, keep "ABC" and {name}, 2 items';
  detail.promptZh = ''; detail.translationStatus = 'missing';
  detail.contentHash = crypto.createHash('sha256').update(detail.promptOriginal).digest('hex');
  db.prepare('UPDATE image_studio_optimization_cases SET detail_json = ? WHERE case_id = ?').run(JSON.stringify(detail), id);
  assert.equal(service.optimizationCase(result.sessionId, id, 0).promptZh, '');
  const [first, second] = await Promise.all([
    service.translateOptimizationCase({ sessionId: result.sessionId, caseSnapshotId: id, ownerId: 0 }),
    service.translateOptimizationCase({ sessionId: result.sessionId, caseSnapshotId: id, ownerId: 0 }),
  ]);
  assert.equal(first.promptZh, second.promptZh);
  assert.equal(translationCalls, 1);
  assert.equal(service.optimizationCase(result.sessionId, id, 0).translationStatus, 'ai');
  await service.translateOptimizationCase({ sessionId: result.sessionId, caseSnapshotId: id, ownerId: 0 });
  assert.equal(translationCalls, 1);
  detail.promptOriginal = '华为手机 product photography, keep "XYZ" and {name}, 3 items';
  detail.promptZh = ''; detail.translationStatus = 'missing';
  detail.contentHash = crypto.createHash('sha256').update(detail.promptOriginal).digest('hex');
  db.prepare('UPDATE image_studio_optimization_cases SET detail_json = ? WHERE case_id = ?').run(JSON.stringify(detail), id);
  lateMode = true;
  const late = service.translateOptimizationCase({ sessionId: result.sessionId, caseSnapshotId: id, ownerId: 0 });
  service.cancelCaseTranslation({ sessionId: result.sessionId, caseSnapshotId: id, ownerId: 0 });
  resolveLate('为华为手机制作产品摄影，保留原样文字 XYZ 和 {name}，3 件商品。');
  await assert.rejects(late, /取消/);
  assert.equal(service.optimizationCase(result.sessionId, id, 0).promptZh, '');
  db.close();
});
