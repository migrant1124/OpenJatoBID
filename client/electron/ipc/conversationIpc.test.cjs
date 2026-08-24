const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadIpc(electronMock) {
  const modulePath = path.join(__dirname, 'conversationIpc.cjs');
  delete require.cache[require.resolve(modulePath)];
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(modulePath); } finally { Module._load = originalLoad; }
}

test('registers conversation handlers and forwards public events', async () => {
  const handlers = new Map();
  const sent = [];
  let listener;
  const service = new Proxy({ onEvent(callback) { listener = callback; return () => {}; } }, {
    get(target, key) { return target[key] || ((input) => ({ key, input })); },
  });
  const { registerConversationIpc } = loadIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } });
  registerConversationIpc({ conversationService: service, mainWindow: { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } } });
  assert.equal(handlers.has('conversation:send-message'), true);
  assert.equal((await handlers.get('conversation:get-thread')({}, { threadId: 't1' })).key, 'getThread');
  listener({ type: 'thread-list-changed' });
  assert.deepEqual(sent, [['conversation:event', { type: 'thread-list-changed' }]]);
});
