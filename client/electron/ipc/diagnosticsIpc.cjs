const { ipcMain } = require('electron');

function registerDiagnosticsIpc({ diagnosticsService }) {
  const subscribers = new Set();
  const unsubscribe = diagnosticsService.subscribe((snapshot) => {
    for (const webContents of subscribers) if (!webContents.isDestroyed()) webContents.send('diagnostics:update', snapshot);
  });
  ipcMain.handle('diagnostics:get-last', () => diagnosticsService.getLast());
  ipcMain.handle('diagnostics:run-all', (_event, options) => diagnosticsService.runAll(options));
  ipcMain.handle('diagnostics:run-one', (_event, id, options) => diagnosticsService.runOne(id, options));
  ipcMain.handle('diagnostics:cancel', () => { diagnosticsService.cancel(); return { success: true }; });
  ipcMain.handle('diagnostics:export-report', (_event, format) => diagnosticsService.exportReport(format));
  ipcMain.on('diagnostics:subscribe', (event) => { subscribers.add(event.sender); event.sender.once('destroyed', () => subscribers.delete(event.sender)); });
  return () => { unsubscribe(); subscribers.clear(); };
}

module.exports = { registerDiagnosticsIpc };
