const { ipcMain } = require('electron');

function registerImageStudioIpc({ service, mainWindow }) {
  ipcMain.handle('image-studio:get-state', () => service.getState());
  ipcMain.handle('image-studio:save-draft', (_event, input) => service.saveDraft(input));
  ipcMain.handle('image-studio:start', (_event, input) => service.start(input));
  ipcMain.handle('image-studio:set-favorite', (_event, input) => service.setFavorite(input));
  ipcMain.handle('image-studio:delete-work', (_event, input) => service.deleteWork(input));
  ipcMain.handle('image-studio:export-image', (_event, input) => service.exportImage(input));
  return service.onEvent((event) => {
    if (!mainWindow?.isDestroyed?.() && !mainWindow?.webContents?.isDestroyed?.()) {
      mainWindow.webContents.send('image-studio:event', event);
    }
  });
}

module.exports = { registerImageStudioIpc };
