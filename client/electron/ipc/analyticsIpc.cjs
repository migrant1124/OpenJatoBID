const { ipcMain } = require('electron');

function registerAnalyticsIpc({ analyticsService }) {
  ipcMain.handle('analytics:track', (_event, payload) => analyticsService.track(payload));
  ipcMain.handle('analytics:flush', () => analyticsService.flush());
}

module.exports = { registerAnalyticsIpc };
