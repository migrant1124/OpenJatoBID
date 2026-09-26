const { ipcMain } = require('electron');

function registerTechnicalPlanIpc({ technicalPlanStore, technicalPlanProjects }) {
  ipcMain.handle('technical-plan:list-projects', () => technicalPlanProjects.list());
  ipcMain.handle('technical-plan:create-project', (_event, data) => technicalPlanProjects.create(data));
  ipcMain.handle('technical-plan:open-project', (_event, id) => technicalPlanProjects.open(id));
  ipcMain.handle('technical-plan:leave-project', () => technicalPlanProjects.leave());
  ipcMain.handle('technical-plan:delete-project', (_event, id) => technicalPlanProjects.remove(id));
  ipcMain.handle('technical-plan:active-project', () => technicalPlanProjects.active());
  ipcMain.handle('technical-plan:load-state', () => technicalPlanStore.loadTechnicalPlan());
  ipcMain.handle('technical-plan:import-tender-document', () => technicalPlanProjects.runOperation(() => technicalPlanStore.importTenderDocument()));
  ipcMain.handle('technical-plan:resolve-tender-import', (_event, token, action) => technicalPlanStore.resolveTenderImport(token, action));
  ipcMain.handle('technical-plan:replace-tender-source', (_event, sourceId) => technicalPlanProjects.runOperation(() => technicalPlanStore.replaceTenderSource(sourceId)));
  ipcMain.handle('technical-plan:remove-tender-source', (_event, sourceId) => technicalPlanStore.removeTenderSource(sourceId));
  ipcMain.handle('technical-plan:import-original-plan-document', () => technicalPlanProjects.runOperation(() => technicalPlanStore.importOriginalPlanDocument()));
  ipcMain.handle('technical-plan:check-bid-sections', () => technicalPlanStore.checkBidSections());
  ipcMain.handle('technical-plan:select-bid-section', (_event, selectedSection) => technicalPlanStore.selectBidSection(selectedSection));
  ipcMain.handle('technical-plan:read-tender-markdown', () => technicalPlanStore.readTenderMarkdown());
  ipcMain.handle('technical-plan:read-tender-source-markdown', (_event, sourceId) => technicalPlanStore.readTenderSourceMarkdown(sourceId));
  ipcMain.handle('technical-plan:read-original-plan-markdown', () => technicalPlanStore.readOriginalPlanMarkdown());
  ipcMain.handle('technical-plan:update-step', (_event, step) => {
    if (technicalPlanStore.hasPendingTenderImport()) throw new Error('请先处理同名文件选择');
    return technicalPlanStore.updateStep(step);
  });
  ipcMain.handle('technical-plan:set-workflow-kind', (_event, workflowKind) => technicalPlanStore.setWorkflowKind(workflowKind));
  ipcMain.handle('technical-plan:switch-workflow-kind', (_event, workflowKind) => technicalPlanStore.switchWorkflowKind(workflowKind));
  ipcMain.handle('technical-plan:save-bid-analysis-config', (_event, payload) => technicalPlanStore.saveBidAnalysisConfig(payload));
  ipcMain.handle('technical-plan:save-outline-config', (_event, payload) => technicalPlanStore.saveOutlineConfig(payload));
  ipcMain.handle('technical-plan:save-outline', (_event, outlineData) => technicalPlanStore.saveOutline(outlineData));
  ipcMain.handle('technical-plan:save-global-facts', (_event, globalFacts) => technicalPlanStore.saveGlobalFacts(globalFacts));
  ipcMain.handle('technical-plan:save-content-generation-options', (_event, options) => technicalPlanStore.saveContentGenerationOptions(options));
  ipcMain.handle('technical-plan:save-content-illustration-plan', (_event, plan) => technicalPlanStore.saveContentIllustrationPlan(plan));
  ipcMain.handle('technical-plan:save-chapter-content', (_event, payload) => technicalPlanStore.saveChapterContent(payload));
  ipcMain.handle('technical-plan:update-project-understanding', (_event, payload) => technicalPlanStore.updateProjectUnderstanding(payload?.action, payload?.versionId));
  ipcMain.handle('technical-plan:clear', () => technicalPlanStore.clearTechnicalPlan());
}

module.exports = {
  registerTechnicalPlanIpc,
};
