const { contextBridge, ipcRenderer } = require('electron');

const bridge = {
  appName: 'Jato AI BID',
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getGpuHardwareAccelerationStatus: () => ipcRenderer.invoke('app:get-gpu-hardware-acceleration-status'),
  saveGpuHardwareAccelerationPreference: (enabled) => ipcRenderer.invoke('app:save-gpu-hardware-acceleration-preference', enabled),
  startGpuHardwareAccelerationTrial: () => ipcRenderer.invoke('app:start-gpu-hardware-acceleration-trial'),
  relaunchWithGpuHardwareAccelerationDisabled: () => ipcRenderer.invoke('app:relaunch-with-gpu-hardware-acceleration-disabled'),
  getLatestVersion: () => ipcRenderer.invoke('app:get-latest-version'),
  getUpdateDownloadUrl: () => ipcRenderer.invoke('app:get-update-download-url'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  startUpdate: () => ipcRenderer.invoke('app:start-update'),
  quitAndInstall: () => ipcRenderer.invoke('app:quit-and-install'),
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-progress', listener);
    return () => ipcRenderer.removeListener('app:update-progress', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-downloaded', listener);
    return () => ipcRenderer.removeListener('app:update-downloaded', listener);
  },
  onUpdateError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-error', listener);
    return () => ipcRenderer.removeListener('app:update-error', listener);
  },
  diagnostics: {
    getLast: () => ipcRenderer.invoke('diagnostics:get-last'),
    runAll: (options) => ipcRenderer.invoke('diagnostics:run-all', options),
    runOne: (id, options) => ipcRenderer.invoke('diagnostics:run-one', id, options),
    cancel: () => ipcRenderer.invoke('diagnostics:cancel'),
    exportReport: (format) => ipcRenderer.invoke('diagnostics:export-report', format),
    subscribe: () => ipcRenderer.send('diagnostics:subscribe'),
    onUpdate: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('diagnostics:update', listener);
      return () => ipcRenderer.removeListener('diagnostics:update', listener);
    },
  },
  database: {
    getStatus: () => ipcRenderer.invoke('workspace-database:get-status'),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('workspace-database:status', listener);
      return () => ipcRenderer.removeListener('workspace-database:status', listener);
    },
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    listModels: (config) => ipcRenderer.invoke('config:list-models', config),
    openConfigFolder: () => ipcRenderer.invoke('config:open-config-folder'),
  },
  license: {
    getStatus: () => ipcRenderer.invoke('license:get-status'),
    refresh: () => ipcRenderer.invoke('license:refresh'),
    testServer: (serverAddress) => ipcRenderer.invoke('license:test-server', serverAddress),
    submitApplication: (input) => ipcRenderer.invoke('license:submit-application', input),
    getApplicationStatus: () => ipcRenderer.invoke('license:get-application-status'),
    login: (input) => ipcRenderer.invoke('license:login', input),
    verify: () => ipcRenderer.invoke('license:verify'),
    onStatusChanged: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('license:status-changed', listener);
      return () => ipcRenderer.removeListener('license:status-changed', listener);
    },
  },
  analytics: {
    track: (payload) => ipcRenderer.invoke('analytics:track', payload),
    flush: () => ipcRenderer.invoke('analytics:flush'),
  },
  ai: {
    chat: (request) => ipcRenderer.invoke('ai:chat', request),
    requestJson: (request) => ipcRenderer.invoke('ai:request-json', request),
    testImageModel: (config) => ipcRenderer.invoke('ai:test-image-model', config),
    onHttpError: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('ai:http-error', listener);
      return () => ipcRenderer.removeListener('ai:http-error', listener);
    },
  },
  agent: {
    listRuntimes: () => ipcRenderer.invoke('agent:list-runtimes'),
    run: (payload) => ipcRenderer.invoke('agent:run', payload),
    selfCheck: () => ipcRenderer.invoke('agent:self-check'),
    exportSelfCheckReport: (payload) => ipcRenderer.invoke('agent:export-self-check-report', payload),
    getStatus: () => ipcRenderer.invoke('agent:get-status'),
    restart: (reason) => ipcRenderer.invoke('agent:restart', reason),
    getPendingQuestion: () => ipcRenderer.invoke('agent:get-pending-question'),
    answerQuestion: (payload) => ipcRenderer.invoke('agent:answer-question', payload),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('agent:status', listener);
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    onQuestion: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('agent:question-state', listener);
      return () => ipcRenderer.removeListener('agent:question-state', listener);
    },
  },
  conversation: {
    listThreads: (input) => ipcRenderer.invoke('conversation:list-threads', input),
    createThread: () => ipcRenderer.invoke('conversation:create-thread'),
    getThread: (input) => ipcRenderer.invoke('conversation:get-thread', input),
    renameThread: (input) => ipcRenderer.invoke('conversation:rename-thread', input),
    deleteThread: (input) => ipcRenderer.invoke('conversation:delete-thread', input),
    selectAttachments: (input) => ipcRenderer.invoke('conversation:select-attachments', input),
    createTextAttachment: (input) => ipcRenderer.invoke('conversation:create-text-attachment', input),
    removeAttachment: (input) => ipcRenderer.invoke('conversation:remove-attachment', input),
    sendMessage: (input) => ipcRenderer.invoke('conversation:send-message', input),
    cancelMessage: (input) => ipcRenderer.invoke('conversation:cancel-message', input),
    regenerateMessage: (input) => ipcRenderer.invoke('conversation:regenerate-message', input),
    quickAction: (input) => ipcRenderer.invoke('conversation:quick-action', input),
    exportMessageWord: (input) => ipcRenderer.invoke('conversation:export-message-word', input),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('conversation:event', listener);
      return () => ipcRenderer.removeListener('conversation:event', listener);
    },
  },
  promptLibrary: {
    listGroups: () => ipcRenderer.invoke('prompt-library:list-groups'),
    createGroup: (input) => ipcRenderer.invoke('prompt-library:create-group', input),
    updateGroup: (input) => ipcRenderer.invoke('prompt-library:update-group', input),
    deleteGroup: (input) => ipcRenderer.invoke('prompt-library:delete-group', input),
    batchDelete: (input) => ipcRenderer.invoke('prompt-library:batch-delete', input),
    listPrompts: (input) => ipcRenderer.invoke('prompt-library:list-prompts', input),
    getPrompt: (input) => ipcRenderer.invoke('prompt-library:get-prompt', input),
    createPrompt: (input) => ipcRenderer.invoke('prompt-library:create-prompt', input),
    updatePrompt: (input) => ipcRenderer.invoke('prompt-library:update-prompt', input),
    deletePrompt: (input) => ipcRenderer.invoke('prompt-library:delete-prompt', input),
    setFavorite: (input) => ipcRenderer.invoke('prompt-library:set-favorite', input),
    importSingle: (input) => ipcRenderer.invoke('prompt-library:import-single', input),
    prepareBatchImport: (input) => ipcRenderer.invoke('prompt-library:prepare-batch-import', input),
    commitBatchImport: (input) => ipcRenderer.invoke('prompt-library:commit-batch-import', input),
  },
  imageStudio: {
    getState: () => ipcRenderer.invoke('image-studio:get-state'),
    saveDraft: (input) => ipcRenderer.invoke('image-studio:save-draft', input),
    start: (input) => ipcRenderer.invoke('image-studio:start', input),
    cancelTask: (input) => ipcRenderer.invoke('image-studio:cancel-task', input),
    setFavorite: (input) => ipcRenderer.invoke('image-studio:set-favorite', input),
    deleteWork: (input) => ipcRenderer.invoke('image-studio:delete-work', input),
    exportImage: (input) => ipcRenderer.invoke('image-studio:export-image', input),
    importAsset: () => ipcRenderer.invoke('image-studio:import-asset'),
    invertImage: (input) => ipcRenderer.invoke('image-studio:invert-image', input),
    optimizePrompt: (input) => ipcRenderer.invoke('image-studio:optimize-prompt', input),
    listMyPrompts: () => ipcRenderer.invoke('image-studio:list-my-prompts'),
    saveMyPrompt: (input) => ipcRenderer.invoke('image-studio:save-my-prompt', input),
    listStyles: () => ipcRenderer.invoke('image-studio:list-styles'),
    saveStyle: (input) => ipcRenderer.invoke('image-studio:save-style', input),
    deleteStyle: (input) => ipcRenderer.invoke('image-studio:delete-style', input),
    listSources: (input) => ipcRenderer.invoke('image-studio:list-sources', input),
    saveSource: (input) => ipcRenderer.invoke('image-studio:save-source', input),
    deleteSource: (sourceId) => ipcRenderer.invoke('image-studio:delete-source', sourceId),
    restoreSource: (sourceId) => ipcRenderer.invoke('image-studio:restore-source', sourceId),
    checkSource: (sourceId) => ipcRenderer.invoke('image-studio:check-source', sourceId),
    checkSourceUrl: (url) => ipcRenderer.invoke('image-studio:check-source-url', url),
    refreshSource: (sourceId, options) => ipcRenderer.invoke('image-studio:refresh-source', sourceId, options),
    listReferenceItems: (input) => ipcRenderer.invoke('image-studio:list-reference-items', input),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('image-studio:event', listener);
      return () => ipcRenderer.removeListener('image-studio:event', listener);
    },
  },
  developerTokenStats: {
    openWindow: () => ipcRenderer.invoke('developer-token-stats:open-window'),
    get: () => ipcRenderer.invoke('developer-token-stats:get'),
    reset: () => ipcRenderer.invoke('developer-token-stats:reset'),
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('developer-token-stats:changed', listener);
      return () => ipcRenderer.removeListener('developer-token-stats:changed', listener);
    },
  },
  developerAgentMonitor: {
    openWindow: () => ipcRenderer.invoke('developer-agent-monitor:open-window'),
    openWorkspace: (workspaceDir) => ipcRenderer.invoke('developer-agent-monitor:open-workspace', workspaceDir),
    attach: () => ipcRenderer.invoke('developer-agent-monitor:attach'),
    detach: () => ipcRenderer.invoke('developer-agent-monitor:detach'),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('developer-agent-monitor:event', listener);
      return () => ipcRenderer.removeListener('developer-agent-monitor:event', listener);
    },
  },
  developerExpansionReplaceTest: {
    run: (payload) => ipcRenderer.invoke('developer-expansion-replace-test:run', payload),
  },
  file: {
    selectDuplicateCheckFiles: (options) => ipcRenderer.invoke('file:select-duplicate-check-files', options),
  },
  knowledgeBase: {
    getMigrationStatus: () => ipcRenderer.invoke('knowledge-base:get-migration-status'),
    migrateLegacy: () => ipcRenderer.invoke('knowledge-base:migrate-legacy'),
    list: () => ipcRenderer.invoke('knowledge-base:list'),
    createFolder: (name) => ipcRenderer.invoke('knowledge-base:create-folder', name),
    renameFolder: (folderId, name) => ipcRenderer.invoke('knowledge-base:rename-folder', folderId, name),
    reorderFolder: (draggedFolderId, targetFolderId, position) => ipcRenderer.invoke('knowledge-base:reorder-folder', draggedFolderId, targetFolderId, position),
    deleteFolder: (folderId) => ipcRenderer.invoke('knowledge-base:delete-folder', folderId),
    deleteDocument: (documentId) => ipcRenderer.invoke('knowledge-base:delete-document', documentId),
    deleteDocuments: (documentIds) => ipcRenderer.invoke('knowledge-base:delete-documents', documentIds),
    moveDocument: (documentId, targetFolderId, targetDocumentId, position) => ipcRenderer.invoke('knowledge-base:move-document', documentId, targetFolderId, targetDocumentId, position),
    uploadDocuments: (folderId) => ipcRenderer.invoke('knowledge-base:upload-documents', folderId),
    retryDocument: (documentId) => ipcRenderer.invoke('knowledge-base:retry-document', documentId),
    startMatching: (documentId, batchSize) => ipcRenderer.invoke('knowledge-base:start-matching', documentId, batchSize), // batchSize 已忽略
    readMarkdown: (documentId) => ipcRenderer.invoke('knowledge-base:read-markdown', documentId),
    readItems: (documentId) => ipcRenderer.invoke('knowledge-base:read-items', documentId),
    readAnalysis: (documentId) => ipcRenderer.invoke('knowledge-base:read-analysis', documentId),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('knowledge-base:event', listener);
      return () => ipcRenderer.removeListener('knowledge-base:event', listener);
    },
  },
  technicalPlan: {
    listProjects: () => ipcRenderer.invoke('technical-plan:list-projects'),
    createProject: (data) => ipcRenderer.invoke('technical-plan:create-project', data),
    openProject: (id) => ipcRenderer.invoke('technical-plan:open-project', id),
    leaveProject: () => ipcRenderer.invoke('technical-plan:leave-project'),
    deleteProject: (id) => ipcRenderer.invoke('technical-plan:delete-project', id),
    activeProject: () => ipcRenderer.invoke('technical-plan:active-project'),
    loadState: () => ipcRenderer.invoke('technical-plan:load-state'),
    importTenderDocument: () => ipcRenderer.invoke('technical-plan:import-tender-document'),
    resolveTenderImport: (token, action) => ipcRenderer.invoke('technical-plan:resolve-tender-import', token, action),
    replaceTenderSource: (sourceId) => ipcRenderer.invoke('technical-plan:replace-tender-source', sourceId),
    removeTenderSource: (sourceId) => ipcRenderer.invoke('technical-plan:remove-tender-source', sourceId),
    importOriginalPlanDocument: () => ipcRenderer.invoke('technical-plan:import-original-plan-document'),
    checkBidSections: () => ipcRenderer.invoke('technical-plan:check-bid-sections'),
    selectBidSection: (selectedSection) => ipcRenderer.invoke('technical-plan:select-bid-section', selectedSection),
    readTenderMarkdown: () => ipcRenderer.invoke('technical-plan:read-tender-markdown'),
    readTenderSourceMarkdown: (sourceId) => ipcRenderer.invoke('technical-plan:read-tender-source-markdown', sourceId),
    readOriginalPlanMarkdown: () => ipcRenderer.invoke('technical-plan:read-original-plan-markdown'),
    updateStep: (step) => ipcRenderer.invoke('technical-plan:update-step', step),
    setWorkflowKind: (workflowKind) => ipcRenderer.invoke('technical-plan:set-workflow-kind', workflowKind),
    switchWorkflowKind: (workflowKind) => ipcRenderer.invoke('technical-plan:switch-workflow-kind', workflowKind),
    saveBidAnalysisConfig: (payload) => ipcRenderer.invoke('technical-plan:save-bid-analysis-config', payload),
    saveOutlineConfig: (payload) => ipcRenderer.invoke('technical-plan:save-outline-config', payload),
    saveOutline: (outlineData) => ipcRenderer.invoke('technical-plan:save-outline', outlineData),
    saveGlobalFacts: (globalFacts) => ipcRenderer.invoke('technical-plan:save-global-facts', globalFacts),
    saveContentGenerationOptions: (options) => ipcRenderer.invoke('technical-plan:save-content-generation-options', options),
    saveContentIllustrationPlan: (plan) => ipcRenderer.invoke('technical-plan:save-content-illustration-plan', plan),
    saveChapterContent: (payload) => ipcRenderer.invoke('technical-plan:save-chapter-content', payload),
    updateProjectUnderstanding: (payload) => ipcRenderer.invoke('technical-plan:update-project-understanding', payload),
    clear: () => ipcRenderer.invoke('technical-plan:clear'),
  },
  duplicateCheck: {
    loadState: () => ipcRenderer.invoke('duplicate-check:load-state'),
    saveFiles: (payload) => ipcRenderer.invoke('duplicate-check:save-files', payload),
    saveUiState: (payload) => ipcRenderer.invoke('duplicate-check:save-ui-state', payload),
    updateState: (partial) => ipcRenderer.invoke('duplicate-check:update-state', partial),
    clear: () => ipcRenderer.invoke('duplicate-check:clear'),
  },
  rejectionCheck: {
    loadState: () => ipcRenderer.invoke('rejection-check:load-state'),
    importDocument: (role) => ipcRenderer.invoke('rejection-check:import-document', role),
    importTenderFromTechnicalPlan: () => ipcRenderer.invoke('rejection-check:import-tender-from-technical-plan'),
    removeDocument: (role, documentId) => ipcRenderer.invoke('rejection-check:remove-document', role, documentId),
    saveUiState: (payload) => ipcRenderer.invoke('rejection-check:save-ui-state', payload),
    updateState: (partial) => ipcRenderer.invoke('rejection-check:update-state', partial),
    clear: () => ipcRenderer.invoke('rejection-check:clear'),
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    get: (templateId) => ipcRenderer.invoke('templates:get', templateId),
    create: (config) => ipcRenderer.invoke('templates:create', config),
    update: (templateId, config) => ipcRenderer.invoke('templates:update', templateId, config),
    delete: (templateId) => ipcRenderer.invoke('templates:delete', templateId),
  },
  tasks: {
    startBidSectionExtraction: (payload) => ipcRenderer.invoke('tasks:start-bid-section-extraction', payload),
    startBidAnalysis: (payload) => ipcRenderer.invoke('tasks:start-bid-analysis', payload),
    startOutlineGeneration: (payload) => ipcRenderer.invoke('tasks:start-outline-generation', payload),
    confirmOutlineGeneration: (payload) => ipcRenderer.invoke('tasks:confirm-outline-generation', payload),
    startGlobalFactsGeneration: (payload) => ipcRenderer.invoke('tasks:start-global-facts-generation', payload),
    startContentGeneration: (payload) => ipcRenderer.invoke('tasks:start-content-generation', payload),
    pauseContentGeneration: () => ipcRenderer.invoke('tasks:pause-content-generation'),
    startProjectUnderstandingResearch: (payload) => ipcRenderer.invoke('tasks:start-project-understanding-research', payload),
    cancelProjectUnderstandingResearch: () => ipcRenderer.invoke('tasks:cancel-project-understanding-research'),
    startRejectionItemsExtraction: (payload) => ipcRenderer.invoke('tasks:start-rejection-items-extraction', payload),
    startRejectionCheck: (payload) => ipcRenderer.invoke('tasks:start-rejection-check', payload),
    startDuplicateAnalysis: (payload) => ipcRenderer.invoke('tasks:start-duplicate-analysis', payload),
    getActiveTasks: () => ipcRenderer.invoke('tasks:get-active'),
    onTaskEvent: (callback) => {
      ipcRenderer.send('tasks:subscribe');
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('tasks:event', listener);
      return () => ipcRenderer.removeListener('tasks:event', listener);
    },
  },
  export: {
    exportWord: (payload) => ipcRenderer.invoke('export:word', payload),
    openFile: (filePath) => ipcRenderer.invoke('export:open-file', filePath),
    onWordExportProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('export:word-progress', listener);
      return () => ipcRenderer.removeListener('export:word-progress', listener);
    },
  },
  systemFonts: {
    list: () => ipcRenderer.invoke('system-fonts:list'),
  },
};

contextBridge.exposeInMainWorld('yibiao', bridge);
contextBridge.exposeInMainWorld('jatoaibid', bridge);

contextBridge.exposeInMainWorld('yibiaoClient', {
  appName: bridge.appName,
  platform: bridge.platform,
});
