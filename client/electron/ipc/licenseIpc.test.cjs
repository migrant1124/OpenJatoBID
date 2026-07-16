const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadLicenseIpc(electronMock) {
  const modulePath = path.join(__dirname, 'licenseIpc.cjs');
  delete require.cache[require.resolve(modulePath)];
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test('starts and closes the license lifecycle and forwards service status events to the renderer', () => {
  const handles = new Map();
  const powerMonitor = new EventEmitter();
  const sent = [];
  let listener = null;
  let lifecycleStarts = 0;
  let closes = 0;
  let unsubscribes = 0;
  const licenseService = {
    getStatus: async () => ({ status: 'missing' }),
    verify: async () => ({ status: 'active' }),
    testServer: async () => ({}),
    submitApplication: async () => ({}),
    getApplicationStatus: async () => ({}),
    login: async () => ({ status: 'active' }),
    onStatusChanged(callback) {
      listener = callback;
      return () => { unsubscribes += 1; };
    },
    startLifecycle() { lifecycleStarts += 1; },
    close() { closes += 1; },
  };
  const { registerLicenseIpc } = loadLicenseIpc({
    ipcMain: { handle: (channel, handler) => handles.set(channel, handler) },
    powerMonitor,
  });
  const cleanup = registerLicenseIpc({
    licenseService,
    mainWindow: {
      isDestroyed: () => false,
      webContents: { send: (...args) => sent.push(args) },
    },
  });

  listener({ status: 'revoked' });

  assert.equal(lifecycleStarts, 1);
  assert.deepEqual(sent, [['license:status-changed', { status: 'revoked' }]]);
  assert.equal(powerMonitor.listenerCount('resume'), 1);
  cleanup();
  assert.equal(powerMonitor.listenerCount('resume'), 0);
  assert.equal(unsubscribes, 1);
  assert.equal(closes, 1);
  assert.equal(handles.has('license:login'), true);
});
