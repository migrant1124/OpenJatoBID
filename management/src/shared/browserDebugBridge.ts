import type { AnalyticsDashboard, AnalyticsRange, JatoManagementApi, ManagementSession } from './ipc';

function createEmptyDashboard(range: AnalyticsRange): AnalyticsDashboard {
  return {
    range,
    generatedAt: new Date().toISOString(),
    summary: {
      totalClients: 0,
      newClients: 0,
      activeClients: 0,
      onlineClients: 0,
      totalEvents: 0,
      aiRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      agentSuccess: 0,
      agentFailed: 0,
      agentRetries: 0,
    },
    versions: [],
    platforms: [],
    architectures: [],
    sourceIps: [],
    pages: [],
    configs: [],
    resources: [],
    models: [],
    licenseStatuses: [],
    dailyActive: [],
    authorization: { employees: 0, activeDevices: 0, activeLicenses: 0, revokedLicenses: 0 },
    recentEvents: [],
  };
}

export function installManagementBrowserDebugBridge() {
  let session: ManagementSession = { authenticated: false, username: null, mustChangePassword: false };
  const success = { success: true } as const;

  const api: JatoManagementApi = {
    resources: {
      repositoryDecision: async () => ({ success: false, message: '资源准入与下载需要真实 Electron 管理端' }),
      status: async () => ({ success: false, message: '资源中心需要通过 Electron 访问真实管理端数据' }),
      applySelection: async () => ({ success: false, message: '浏览器预览不能执行同步' }),
      enqueueChecks: async () => ({ success: false, message: '浏览器预览不能执行同步' }),
      audits: async () => ({ success: false, message: '审计需要真实 Electron 管理端' }),
      history: async () => ({ success: false, message: '发布记录需要真实 Electron 管理端' }),
      repositoryRequests: async () => ({ success: false, message: '获取申请需要真实 Electron 管理端' }),
      cancel: async () => ({ success: false, message: '浏览器预览不能执行同步' }),
      configure: async () => ({ success: false, message: '浏览器预览不能保存资源设置' }),
      cleanup: async () => ({ success: false, message: '浏览器预览不能清理资源暂存' }),
      chooseDirectory: async () => ({ success: false, message: '目录选择需要 Electron' }),
    },
    app: {
      getInfo: async () => ({ version: '1.0.0-browser-preview', platform: navigator.platform, isPackaged: false, autoStartEnabled: false }),
    },
    server: {
      getStatus: async () => ({ status: 'RUNNING', address: { host: '192.168.1.10', port: 47821 }, message: '浏览器 UI 预览' }),
    },
    window: {
      minimize: () => {},
      hide: () => {},
    },
    setup: {
      getStatus: async () => ({ serverConfigured: true, server: { host: '192.168.1.10', port: 47821 } }),
      complete: async () => success,
    },
    auth: {
      login: async ({ username, password }) => {
        if (!username.trim() || !password) {
          return { success: false, message: '请输入用户名和密码', username: null, mustChangePassword: false };
        }
        session = { authenticated: true, username: username.trim(), mustChangePassword: false };
        return { success: true, username: session.username, mustChangePassword: false };
      },
      completeInitialPasswordChange: async () => success,
      changePassword: async () => success,
      getSession: async () => ({ ...session }),
      logout: async () => {
        session = { authenticated: false, username: null, mustChangePassword: false };
        return success;
      },
    },
    authorization: {
      list: async () => ({ success: true, applications: [], employees: [] }),
      approve: async () => success,
      reject: async () => success,
      revoke: async () => success,
      renew: async () => success,
    },
    analytics: {
      getDashboard: async (range) => ({ success: true, dashboard: createEmptyDashboard(range) }),
      cleanup: async () => ({ success: true, deleted: 0 }),
    },
  };

  window.jatoManagement = api;
}
