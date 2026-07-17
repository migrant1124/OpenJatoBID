const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDeviceBootstrapStore } = require('./deviceBootstrapStore.cjs');
const { getDeviceBootstrapFilePath } = require('../utils/paths.cjs');

test('uses a fixed Windows bootstrap path outside Electron userData', () => {
  const bootstrapPath = getDeviceBootstrapFilePath({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' },
    homeDir: 'C:\\Users\\Tester',
  });

  assert.equal(bootstrapPath, 'C:\\Users\\Tester\\AppData\\Local\\JatoDigital\\OpenJatoBID\\bootstrap.json');
  assert.equal(bootstrapPath.includes('Jato AI BID'), false);
});

test('persists only the management address and public-key trust bootstrap fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-bootstrap-'));
  const filePath = path.join(root, 'bootstrap.json');
  const store = createDeviceBootstrapStore({
    filePath,
    now: () => new Date('2026-07-10T00:00:00.000Z'),
  });

  store.save({
    serverAddress: '192.168.10.8:47821',
    managementPublicKey: 'public-key',
    license: 'must-not-be-written',
    employeeName: 'must-not-be-written',
    apiKey: 'must-not-be-written',
  });

  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(stored, {
    schemaVersion: 1,
    serverAddress: '192.168.10.8:47821',
    managementPublicKey: 'public-key',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
  assert.deepEqual(store.load(), stored);

  store.save({ serverAddress: '192.168.10.9:47821' });
  assert.deepEqual(store.load(), {
    ...stored,
    serverAddress: '192.168.10.9:47821',
  });
  fs.rmSync(root, { recursive: true, force: true });
});
