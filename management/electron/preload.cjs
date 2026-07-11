const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jatoManagement', {
  app: {
    getInfo: () => ipcRenderer.invoke('management:app:get-info'),
  },
  server: {
    getStatus: () => ipcRenderer.invoke('management:server:get-status'),
  },
  window: {
    minimize: () => ipcRenderer.send('management:window:minimize'),
    hide: () => ipcRenderer.send('management:window:hide'),
  },
  setup: {
    getStatus: () => ipcRenderer.invoke('management:setup:get-status'),
    complete: (input) => ipcRenderer.invoke('management:setup:complete', input),
  },
  auth: {
    login: (input) => ipcRenderer.invoke('management:auth:login', input),
    completeInitialPasswordChange: (newPassword) => ipcRenderer.invoke('management:auth:complete-initial-password-change', newPassword),
    changePassword: (input) => ipcRenderer.invoke('management:auth:change-password', input),
    getSession: () => ipcRenderer.invoke('management:auth:get-session'),
    logout: () => ipcRenderer.invoke('management:auth:logout'),
  },
  authorization: {
    list: () => ipcRenderer.invoke('management:authorization:list'),
    approve: (applicationId) => ipcRenderer.invoke('management:authorization:approve', applicationId),
    reject: (applicationId) => ipcRenderer.invoke('management:authorization:reject', applicationId),
    revoke: (licenseId) => ipcRenderer.invoke('management:authorization:revoke', licenseId),
    renew: (licenseId) => ipcRenderer.invoke('management:authorization:renew', licenseId),
  },
  analytics: {
    getDashboard: (range) => ipcRenderer.invoke('management:analytics:get-dashboard', range),
    cleanup: (months) => ipcRenderer.invoke('management:analytics:cleanup', months),
  },
});
