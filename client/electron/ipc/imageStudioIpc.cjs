const { ipcMain } = require('electron');

function registerImageStudioIpc({ service, mainWindow }) {
  ipcMain.handle('image-studio:get-state', () => service.getState());
  ipcMain.handle('image-studio:save-draft', (_event, input) => service.saveDraft(input));
  ipcMain.handle('image-studio:start', (_event, input) => service.start(input));
  ipcMain.handle('image-studio:cancel-task', (_event, input) => service.cancelTask(input));
  ipcMain.handle('image-studio:set-favorite', (_event, input) => service.setFavorite(input));
  ipcMain.handle('image-studio:delete-work', (_event, input) => service.deleteWork(input));
  ipcMain.handle('image-studio:export-image', (_event, input) => service.exportImage(input));
  ipcMain.handle('image-studio:import-asset', () => service.importAsset());
  ipcMain.handle('image-studio:invert-image', (_event, input) => service.invertImage(input));
  ipcMain.handle('image-studio:optimize-prompt', (_event, input) => service.optimizePrompt(input));
  ipcMain.handle('image-studio:list-my-prompts', () => service.listMyPrompts());
  ipcMain.handle('image-studio:save-my-prompt', (_event, input) => service.saveMyPrompt(input));
  ipcMain.handle('image-studio:list-styles', () => service.listStyles());
  ipcMain.handle('image-studio:save-style', (_event, input) => service.saveStyle(input));
  ipcMain.handle('image-studio:delete-style', (_event, input) => service.deleteStyle(input));
  ipcMain.handle('image-studio:list-sources', (_event, input) => service.listSources(input));
  ipcMain.handle('image-studio:save-source', (_event, input) => service.saveSource(input));
  ipcMain.handle('image-studio:delete-source', (_event, sourceId) => service.deleteSource(sourceId));
  ipcMain.handle('image-studio:restore-source', (_event, sourceId) => service.restoreSource(sourceId));
  ipcMain.handle('image-studio:check-source', (_event, sourceId) => service.checkSource(sourceId));
  ipcMain.handle('image-studio:check-source-url', (_event, url) => service.checkSourceUrl(url));
  ipcMain.handle('image-studio:refresh-source', (_event, sourceId, options) => service.refreshSource(sourceId, options));
  ipcMain.handle('image-studio:list-reference-items', (_event, input) => service.listItems(input));
  return service.onEvent((event) => {
    if (!mainWindow?.isDestroyed?.() && !mainWindow?.webContents?.isDestroyed?.()) {
      mainWindow.webContents.send('image-studio:event', event);
    }
  });
}

module.exports = { registerImageStudioIpc };
