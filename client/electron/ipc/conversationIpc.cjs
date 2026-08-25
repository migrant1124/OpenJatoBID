const { ipcMain } = require('electron');

function registerConversationIpc({ conversationService, mainWindow }) {
  ipcMain.handle('conversation:list-threads', (_event, input) => conversationService.listThreads(input));
  ipcMain.handle('conversation:create-thread', () => conversationService.createThread());
  ipcMain.handle('conversation:get-thread', (_event, input) => conversationService.getThread(input));
  ipcMain.handle('conversation:rename-thread', (_event, input) => conversationService.renameThread(input));
  ipcMain.handle('conversation:delete-thread', (_event, input) => conversationService.deleteThread(input));
  ipcMain.handle('conversation:select-attachments', (_event, input) => conversationService.selectAttachments(input));
  ipcMain.handle('conversation:create-text-attachment', (_event, input) => conversationService.createTextAttachment(input));
  ipcMain.handle('conversation:remove-attachment', (_event, input) => conversationService.removeAttachment(input));
  ipcMain.handle('conversation:send-message', (_event, input) => conversationService.sendMessage(input));
  ipcMain.handle('conversation:cancel-message', (_event, input) => conversationService.cancelMessage(input));
  ipcMain.handle('conversation:regenerate-message', (_event, input) => conversationService.regenerateMessage(input));
  ipcMain.handle('conversation:quick-action', (_event, input) => conversationService.applyQuickAction(input));
  ipcMain.handle('conversation:export-message-word', (_event, input) => conversationService.exportMessageWord(input));

  return conversationService.onEvent((payload) => {
    if (!mainWindow?.isDestroyed?.() && !mainWindow?.webContents?.isDestroyed?.()) {
      mainWindow.webContents.send('conversation:event', payload);
    }
  });
}

module.exports = { registerConversationIpc };
