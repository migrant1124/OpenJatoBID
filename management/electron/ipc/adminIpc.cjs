const net = require('node:net');

const SERVER_CONFIG_KEY = 'server_config';

function readSetting(database, key) {
  const row = database.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value_json) : null;
}

function writeSetting(database, key, value) {
  database.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

function errorMessage(error) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'CURRENT_PASSWORD_INCORRECT') return '当前管理员密码不正确';
  if (code === 'NEW_PASSWORD_MUST_DIFFER') return '新密码不能与当前密码相同';
  if (code === 'INITIAL_PASSWORD_CHANGE_NOT_REQUIRED') return '当前账号不需要修改初始密码';
  if (code === 'OWNER_PASSWORD_NOT_ACTIVE') return '请先完成初始密码修改';
  if (code === 'SERVER_ALREADY_CONFIGURED') return '局域网服务已经完成设置';
  if (code === 'INVALID_SERVER_CONFIG') return '请输入有效的监听 IP 和端口';
  return '操作失败，请检查输入和管理端配置';
}

function normalizeServerConfig(input) {
  const host = typeof input?.server?.host === 'string' ? input.server.host.trim() : '';
  const port = Number(input?.server?.port);
  if (net.isIP(host) === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INVALID_SERVER_CONFIG');
  }
  return { host, port };
}

function validNewPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

function registerAdminIpc({
  ipcMain,
  database,
  authService,
  authorizationService,
  analyticsQueryService,
  onSetupComplete = async () => {},
}) {
  let session = { authenticated: false, username: null, mustChangePassword: false };
  const resetSession = () => {
    session = { authenticated: false, username: null, mustChangePassword: false };
  };
  const readServer = () => readSetting(database, SERVER_CONFIG_KEY);
  const businessAccessMessage = () => {
    if (!session.authenticated) return '请先验证管理员身份';
    if (session.mustChangePassword) return '请先修改初始管理员密码';
    if (!readServer()) return '请先完成局域网服务设置';
    return '';
  };
  const requireBusinessAccess = () => {
    const message = businessAccessMessage();
    return message ? { success: false, message } : null;
  };

  ipcMain.handle('management:setup:get-status', () => {
    const server = readServer();
    return { serverConfigured: Boolean(server), server };
  });

  ipcMain.handle('management:setup:complete', async (_event, input) => {
    try {
      if (!session.authenticated) return { success: false, message: '请先验证管理员身份' };
      if (session.mustChangePassword) return { success: false, message: '请先修改初始管理员密码' };
      if (readServer()) throw new Error('SERVER_ALREADY_CONFIGURED');
      const server = normalizeServerConfig(input);
      await onSetupComplete(server);
      writeSetting(database, SERVER_CONFIG_KEY, server);
      return { success: true };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:auth:login', (_event, input) => {
    const username = typeof input?.username === 'string' ? input.username.trim() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (!username || !password) {
      resetSession();
      return { success: false, username: null, mustChangePassword: false, message: '请输入管理员账号和密码' };
    }
    const result = authService.login({ username, password });
    if (!result.success) {
      resetSession();
      return { ...result, message: '管理员账号或密码不正确' };
    }
    session = {
      authenticated: true,
      username: result.username,
      mustChangePassword: result.mustChangePassword,
    };
    return result;
  });

  ipcMain.handle('management:auth:complete-initial-password-change', (_event, newPassword) => {
    if (!session.authenticated) return { success: false, message: '请先验证管理员身份' };
    if (!session.mustChangePassword) return { success: false, message: '当前账号不需要修改初始密码' };
    if (!validNewPassword(newPassword)) return { success: false, message: '新密码至少需要 8 个字符' };
    try {
      authService.completeInitialPasswordChange(newPassword);
      session = { ...session, mustChangePassword: false };
      return { success: true };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:auth:change-password', (_event, input) => {
    if (!session.authenticated) return { success: false, message: '请先验证管理员身份' };
    if (session.mustChangePassword) return { success: false, message: '请先修改初始管理员密码' };
    if (typeof input?.currentPassword !== 'string' || !input.currentPassword) {
      return { success: false, message: '请输入当前管理员密码' };
    }
    if (!validNewPassword(input?.newPassword)) {
      return { success: false, message: '新密码至少需要 8 个字符' };
    }
    try {
      authService.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
      return { success: true };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:auth:get-session', () => ({ ...session }));
  ipcMain.handle('management:auth:logout', () => {
    resetSession();
    return { success: true };
  });

  ipcMain.handle('management:authorization:list', () => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    return {
      success: true,
      applications: authorizationService.listApplications(),
      employees: authorizationService.listEmployees(),
    };
  });

  ipcMain.handle('management:authorization:approve', (_event, applicationId) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    try {
      return { success: true, application: authorizationService.approveApplication(applicationId) };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:authorization:reject', (_event, applicationId) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    try {
      return { success: true, application: authorizationService.rejectApplication(applicationId) };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:authorization:revoke', (_event, licenseId) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    try {
      authorizationService.revokeLicense(licenseId);
      return { success: true };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:authorization:renew', (_event, licenseId) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    try {
      return { success: true, license: authorizationService.renewLicense(licenseId) };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  });

  ipcMain.handle('management:analytics:get-dashboard', (_event, range) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    return { success: true, dashboard: analyticsQueryService.getDashboard(range) };
  });

  ipcMain.handle('management:analytics:cleanup', (_event, months) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    return { success: true, deleted: analyticsQueryService.cleanupOlderThanMonths(months) };
  });
}

module.exports = { registerAdminIpc };
