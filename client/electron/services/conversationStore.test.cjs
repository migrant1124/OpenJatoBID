const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createConversationSchema } = require('./sqliteDatabase.cjs');
const { createConversationStore } = require('./conversationStore.cjs');

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try { const result = fn(...args); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  createConversationSchema(db);
  return db;
}

test('store creates a thread, binds a ready attachment, and persists a completed response transactionally', () => {
  const db = createDb();
  const store = createConversationStore({ db });
  const thread = store.createThread();
  const attachment = store.createAttachment({
    threadId: thread.threadId, fileName: '材料.txt', extension: '.txt', sizeBytes: 4, sha256: 'hash',
    storedFilePath: 'C:\\workspace\\original\\材料.txt', markdownPath: 'C:\\workspace\\parsed\\content.md', status: 'ready', progress: 100,
  });
  const created = store.createUserAndAssistantPlaceholder({
    threadId: thread.threadId, content: '请总结', attachmentIds: [attachment.attachmentId], taskId: 'task-1', source: 'manual',
  });
  store.completeAssistantMessage(created.assistantMessage.messageId, '总结结果');
  assert.equal(store.listMessages(thread.threadId).at(-1).contentMarkdown, '总结结果');
  assert.equal(store.getAttachment(attachment.attachmentId).originMessageId, created.userMessage.messageId);
  assert.equal('storedFilePath' in store.getAttachment(attachment.attachmentId), false);
  store.renameThread(thread.threadId, '新对话');
  store.autoTitleThread(thread.threadId, '不应覆盖手动标题');
  assert.equal(store.getThread(thread.threadId).title, '新对话');
  db.close();
});

test('store recovers interrupted assistant messages as errors', () => {
  const db = createDb();
  const store = createConversationStore({ db });
  const thread = store.createThread();
  const created = store.createUserAndAssistantPlaceholder({ threadId: thread.threadId, content: '问题', attachmentIds: [], taskId: 'task-2', source: 'manual' });
  assert.equal(store.recoverInterruptedMessages(), 1);
  assert.equal(store.getMessage(created.assistantMessage.messageId).errorCode, 'CONVERSATION_INTERRUPTED');
  db.close();
});
