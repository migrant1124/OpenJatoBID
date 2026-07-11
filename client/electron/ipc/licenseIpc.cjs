const { ipcMain, powerMonitor } = require('electron');

function registerLicenseIpc({ licenseService, mainWindow }) {
  const notifyStatus = (status) => {
    if (status && !mainWindow?.isDestroyed()) mainWindow.webContents.send('license:status-changed', status);
    return status;
  };
  const verifyAndNotify = () => licenseService.verify().then(notifyStatus);

  ipcMain.handle('license:get-status', () => licenseService.getStatus());
  ipcMain.handle('license:refresh', () => verifyAndNotify());
  ipcMain.handle('license:test-server', (_event, serverAddress) => licenseService.testServer(serverAddress));
  ipcMain.handle('license:submit-application', (_event, input) => licenseService.submitApplication(input));
  ipcMain.handle('license:get-application-status', () => licenseService.getApplicationStatus());
  ipcMain.handle('license:login', (_event, input) => licenseService.login(input).then(notifyStatus));
  ipcMain.handle('license:verify', () => verifyAndNotify());

  powerMonitor.on('resume', () => {
    void verifyAndNotify().catch(() => {});
  });
}

module.exports = {
  registerLicenseIpc,
};
