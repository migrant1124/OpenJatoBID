function registerResourceIpc({ ipcMain, service }) {
  const channels = [];
  const handle = (name, action) => {
    const channel = `resources:${name}`; channels.push(channel);
    ipcMain.handle(channel, (_event, input) => action(input));
  };
  handle('sync', () => service.sync());
  handle('list', (input) => service.list(input));
  handle('digest', (input) => service.getDigest(input));
  handle('shown', (input) => service.markShown(input));
  handle('asset', (input) => service.loadAsset(input));
  handle('history', () => service.history());
  handle('legacy-sources', () => service.legacySources());
  handle('cache-status', () => service.cacheStatus());
  handle('cache-configure', (input) => service.configureCache(input));
  handle('cache-clear', (input) => service.clearCache(input));
  handle('repository-request', (input) => service.repositoryRequest(input));
  handle('repository-status', (id) => service.repositoryStatus(id));
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}
module.exports = { registerResourceIpc };
