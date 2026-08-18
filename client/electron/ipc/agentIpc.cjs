const { ipcMain } = require('electron');

function registerAgentIpc({ agentService, mainWindow }) {
  ipcMain.handle('agent:list-runtimes', async () => agentService.listRuntimes());
  ipcMain.handle('agent:run', async (_event, payload) => agentService.runTask(payload));
  ipcMain.handle('agent:self-check', async () => agentService.selfCheck());
  ipcMain.handle('agent:export-self-check-report', async (_event, payload) => agentService.exportSelfCheckReport(payload));
  ipcMain.handle('agent:get-status', async () => agentService.getStatus());
  ipcMain.handle('agent:restart', async (_event, reason) => agentService.restart(reason || 'manual'));
  ipcMain.handle('agent:get-pending-question', async () => agentService.getPendingQuestion());
  ipcMain.handle('agent:answer-question', async (_event, payload) => agentService.answerQuestion(payload));

  agentService.onStatus?.((status) => {
    if (!mainWindow?.isDestroyed?.() && !mainWindow?.webContents?.isDestroyed?.()) {
      mainWindow.webContents.send('agent:status', status);
    }
  });
  agentService.onQuestion?.((question) => {
    if (!mainWindow?.isDestroyed?.() && !mainWindow?.webContents?.isDestroyed?.()) {
      mainWindow.webContents.send('agent:question-state', question);
    }
  });
}

module.exports = {
  registerAgentIpc,
};
