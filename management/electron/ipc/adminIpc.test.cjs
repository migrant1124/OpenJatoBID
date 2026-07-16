const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerAdminIpc } = require('./adminIpc.cjs');
const { createAdminAuthService } = require('../services/adminAuthService.cjs');
const { createDatabaseService } = require('../services/databaseService.cjs');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  invoke(channel, ...args) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return handler({}, ...args);
  }
}

function createInitialCredential() {
  const passwordSalt = '0123456789abcdef0123456789abcdef';
  return {
    username: 'initial-owner',
    passwordSalt,
    passwordHash: crypto.scryptSync('Initial-Password-123', passwordSalt, 64).toString('hex'),
    credentialVersion: 'test-v1',
  };
}

function createFixture() {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const authService = createAdminAuthService({
    database: databaseService.database,
    initialCredential: createInitialCredential(),
    allowInitialBootstrap: databaseService.isNewDatabase,
  });
  const ipcMain = new FakeIpcMain();
  const serverStarts = [];
  registerAdminIpc({
    ipcMain,
    database: databaseService.database,
    authService,
    authorizationService: {
      getSummary: () => ({
        applicationCount: 1,
        pendingApplicationCount: 1,
        employeeCount: 1,
        activeDeviceBindingCount: 1,
      }),
      listApplications: () => [{ id: 'application-1' }],
      listEmployees: () => [{ id: 'employee-1' }],
      approveApplication: () => ({}),
      rejectApplication: () => ({}),
      revokeLicense: () => {},
      renewLicense: () => ({}),
    },
    analyticsQueryService: {
      getDashboard: () => ({ summary: {} }),
      cleanupOlderThanMonths: () => 0,
    },
    onSetupComplete: async (server) => { serverStarts.push(server); },
  });
  return { databaseService, ipcMain, serverStarts };
}

test('enforces initial login, password change, and server setup before business access', async () => {
  const fixture = createFixture();
  const { ipcMain } = fixture;

  assert.deepEqual(await ipcMain.invoke('management:setup:get-status'), {
    serverConfigured: false,
    server: null,
  });
  assert.deepEqual(await ipcMain.invoke('management:auth:get-session'), {
    authenticated: false,
    username: null,
    mustChangePassword: false,
  });
  assert.equal((await ipcMain.invoke('management:authorization:list')).success, false);
  assert.equal((await ipcMain.invoke('management:setup:complete', {
    server: { host: '0.0.0.0', port: 47821 },
  })).success, false);

  const initialLogin = await ipcMain.invoke('management:auth:login', {
    username: 'initial-owner',
    password: 'Initial-Password-123',
  });
  assert.deepEqual(initialLogin, {
    success: true,
    username: 'initial-owner',
    mustChangePassword: true,
  });
  assert.equal((await ipcMain.invoke('management:authorization:list')).success, false);
  assert.equal((await ipcMain.invoke('management:setup:complete', {
    server: { host: '0.0.0.0', port: 47821 },
  })).success, false);
  assert.equal((await ipcMain.invoke('management:auth:complete-initial-password-change', 'short')).success, false);
  assert.deepEqual(
    await ipcMain.invoke('management:auth:complete-initial-password-change', 'Initial-Password-123'),
    { success: false, message: '新密码不能与当前密码相同' },
  );

  assert.deepEqual(
    await ipcMain.invoke('management:auth:complete-initial-password-change', 'Owner-Password-456'),
    { success: true },
  );
  assert.equal((await ipcMain.invoke('management:authorization:list')).success, false);
  assert.equal((await ipcMain.invoke('management:setup:complete', {
    server: { host: 'not-an-ip-address', port: 47821 },
  })).success, false);
  assert.deepEqual(fixture.serverStarts, []);

  assert.deepEqual(await ipcMain.invoke('management:setup:complete', {
    server: { host: '0.0.0.0', port: 47821 },
  }), { success: true });
  assert.deepEqual(fixture.serverStarts, [{ host: '0.0.0.0', port: 47821 }]);
  assert.deepEqual(await ipcMain.invoke('management:setup:get-status'), {
    serverConfigured: true,
    server: { host: '0.0.0.0', port: 47821 },
  });
  const authorizationList = await ipcMain.invoke('management:authorization:list');
  assert.equal(authorizationList.success, true);
  assert.deepEqual(authorizationList.summary, {
    applicationCount: 1,
    pendingApplicationCount: 1,
    employeeCount: 1,
    activeDeviceBindingCount: 1,
  });
  fixture.databaseService.close();
});

test('supports active password change and exposes no password-recovery handler', async () => {
  const fixture = createFixture();
  const { ipcMain } = fixture;
  await ipcMain.invoke('management:auth:login', {
    username: 'initial-owner',
    password: 'Initial-Password-123',
  });
  await ipcMain.invoke('management:auth:complete-initial-password-change', 'Owner-Password-456');
  await ipcMain.invoke('management:setup:complete', {
    server: { host: '127.0.0.1', port: 47821 },
  });

  assert.equal(ipcMain.handlers.has('management:auth:forgot-password'), false);
  assert.equal((await ipcMain.invoke('management:auth:change-password', {
    currentPassword: 'Owner-Password-456',
    newPassword: 'short',
  })).success, false);
  assert.equal((await ipcMain.invoke('management:auth:change-password', {
    currentPassword: 'wrong-password',
    newPassword: 'Owner-Password-789',
  })).success, false);
  assert.deepEqual(await ipcMain.invoke('management:auth:change-password', {
    currentPassword: 'Owner-Password-456',
    newPassword: 'Owner-Password-456',
  }), { success: false, message: '新密码不能与当前密码相同' });
  assert.deepEqual(await ipcMain.invoke('management:auth:change-password', {
    currentPassword: 'Owner-Password-456',
    newPassword: 'Owner-Password-789',
  }), { success: true });

  await ipcMain.invoke('management:auth:logout');
  assert.equal((await ipcMain.invoke('management:auth:login', {
    username: 'initial-owner',
    password: 'Owner-Password-456',
  })).success, false);
  assert.equal((await ipcMain.invoke('management:auth:login', {
    username: 'initial-owner',
    password: 'Owner-Password-789',
  })).success, true);
  fixture.databaseService.close();
});
