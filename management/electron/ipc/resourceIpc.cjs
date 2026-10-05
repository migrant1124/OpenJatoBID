function registerResourceIpc({ ipcMain, service, requireBusinessAccess, dialog, getWindow }) {
  const handle = (channel, action) => ipcMain.handle(`management:resources:${channel}`, async (_event, input) => {
    const denied = requireBusinessAccess();
    if (denied) return denied;
    try { return { success: true, data: await action(input) }; }
    catch (error) { return { success: false, message: String(error.message) }; }
  });
  handle('status', () => service.status());
  handle('enable', ({ sourceId, enabled }) => service.sync.enable(sourceId, enabled));
  handle('check', (sourceId) => service.sync.check(sourceId));
  handle('cancel', (sourceId) => service.sync.cancel(sourceId));
  handle('configure', (input) => service.configure(input));
  handle('cleanup', (input) => service.cleanup(input));
  handle('repository-decision', (input) => service.repositoryDecision(input));
  handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: '选择资源镜像目录', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : service.inspectDirectory(result.filePaths[0]);
  });
}

module.exports = { registerResourceIpc };
