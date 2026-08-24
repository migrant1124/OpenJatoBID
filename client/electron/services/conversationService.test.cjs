const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createConversationSchema } = require('./sqliteDatabase.cjs');
const { createConversationStore } = require('./conversationStore.cjs');
const { createConversationService, isReasoningUnsupported } = require('./conversationService.cjs');

test('reasoning negotiation only falls back for explicit capability errors', () => {
  assert.equal(isReasoningUnsupported(new Error('reasoning_effort is unsupported by this model')), true);
  assert.equal(isReasoningUnsupported(new Error('HTTP 503 upstream unavailable')), false);
});

test('deleting the last thread creates exactly one replacement thread', async () => {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try { const result = fn(...args); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  createConversationSchema(db);
  const store = createConversationStore({ db });
  const thread = store.createThread();
  const service = createConversationService({
    app: { getPath: () => os.tmpdir() },
    configStore: { load: () => ({}) },
    store,
    attachmentService: { cleanupExpiredAttachments: async () => {} },
    agentService: {},
    exportService: {},
  });
  await service.deleteThread({ threadId: thread.threadId });
  const threads = service.listThreads();
  assert.equal(threads.length, 1);
  assert.notEqual(threads[0].threadId, thread.threadId);
  await service.close();
  db.close();
});

test('send returns placeholders immediately, streams in memory, and persists once on completion', async () => {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try { const result = fn(...args); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  createConversationSchema(db);
  const store = createConversationStore({ db });
  const thread = store.createThread();
  const service = createConversationService({
    app: { getPath: () => os.tmpdir() },
    configStore: { load: () => ({ context_length_limit: 48000 }) },
    store,
    attachmentService: { cleanupExpiredAttachments: async () => {}, selectAttachments: async () => ({}), createTextAttachment: async () => ({}), removeAttachment: async () => ({}) },
    agentService: { async runTask(payload) { payload.onActivity({ stage: 'starting' }); payload.onEvent({ type: 'assistant_delta', delta: '流式' }); return { assistant_text: '流式完成' }; } },
    exportService: {},
  });
  const completed = new Promise((resolve) => service.onEvent((event) => event.type === 'message-complete' && resolve(event)));
  const created = await service.sendMessage({ threadId: thread.threadId, content: '测试问题', attachmentIds: [] });
  assert.equal(created.assistantMessage.status, 'queued');
  await completed;
  const stored = store.getMessage(created.assistantMessage.messageId);
  assert.equal(stored.status, 'completed');
  assert.equal(stored.contentMarkdown, '流式完成');
  await service.close();
  db.close();
});

test('cancel aborts the active Pi task and persists streamed partial content once', async () => {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try { const result = fn(...args); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  createConversationSchema(db);
  const store = createConversationStore({ db });
  const thread = store.createThread();
  const service = createConversationService({
    app: { getPath: () => os.tmpdir() },
    configStore: { load: () => ({ context_length_limit: 48000 }) },
    store,
    attachmentService: { cleanupExpiredAttachments: async () => {} },
    agentService: { runTask: (payload) => new Promise((_resolve, reject) => {
      payload.onActivity({ stage: 'starting' });
      payload.onEvent({ type: 'assistant_delta', delta: '部分回答' });
      if (payload.signal.aborted) reject(payload.signal.reason);
      else payload.signal.addEventListener('abort', () => reject(payload.signal.reason), { once: true });
    }) },
    exportService: {},
  });
  let resolveStarted;
  const started = new Promise((resolve) => { resolveStarted = resolve; });
  const canceled = new Promise((resolve) => service.onEvent((event) => {
    if (event.type === 'message-start') resolveStarted();
    if (event.type === 'message-canceled') resolve(event);
  }));
  const created = await service.sendMessage({ threadId: thread.threadId, content: '测试停止', attachmentIds: [] });
  await started;
  await service.cancelMessage({ threadId: thread.threadId, assistantMessageId: created.assistantMessage.messageId });
  await canceled;
  const stored = store.getMessage(created.assistantMessage.messageId);
  assert.equal(stored.status, 'canceled');
  assert.equal(stored.contentMarkdown, '部分回答');
  await service.close();
  db.close();
});
