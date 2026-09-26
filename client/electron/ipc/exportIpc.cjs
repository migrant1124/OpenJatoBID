const { ipcMain, shell } = require('electron');

function registerExportIpc({ exportService, getTechnicalPlanProjects }) {
  ipcMain.handle('export:word', async (event, payload = {}) => {
    const requestId = payload.requestId || payload.request_id;
    const sendProgress = (progress) => {
      event.sender.send('export:word-progress', { requestId, ...progress });
    };

    try {
      const run = () => exportService.exportWord(payload, sendProgress);
      return payload.source === 'technical-plan' || payload.source === 'technical-plan-analysis' || payload.source === 'technical-plan-outline'
        ? await getTechnicalPlanProjects().runOperation(async () => {
          const snapshotPayload = payload.source === 'technical-plan' ? payload : { ...payload, project_name: getTechnicalPlanProjects().projectName() };
          const result = await exportService.exportWord(snapshotPayload, sendProgress);
          if (result?.success && result.path) {
            try { getTechnicalPlanProjects().recordExport(payload.source, result.path); }
            catch (error) { result.warnings = [...(result.warnings || []), `导出成功，但本地记录失败：${error.message}`]; }
          }
          return result;
        })
        : await run();
    } catch (error) {
      sendProgress({
        phase: 'error',
        progress: 100,
        message: error.message || '导出 Word 失败',
      });
      throw error;
    }
  });

  ipcMain.handle('export:open-file', async (_event, filePath) => {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) {
      throw new Error('缺少要打开的文件路径');
    }

    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(`打开文件失败：${errorMessage}`);
    }

    return { success: true };
  });
}

module.exports = {
  registerExportIpc,
};
