const path = require('node:path');
const os = require('node:os');

function getUserDataPath(app) {
  return app.getPath('userData');
}

function getConfigFilePath(app) {
  return path.join(getUserDataPath(app), 'user_config.json');
}

function getLicenseFilePath(app) {
  return path.join(getUserDataPath(app), 'license.json');
}

function getDeviceBootstrapFilePath({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(homeDir, 'AppData', 'Local');
    return path.win32.join(localAppData, 'JatoDigital', 'OpenJatoBID', 'bootstrap.json');
  }
  if (platform === 'darwin') {
    return path.posix.join(homeDir, 'Library', 'Application Support', 'JatoDigital', 'OpenJatoBID', 'bootstrap.json');
  }
  const configRoot = env.XDG_CONFIG_HOME || path.posix.join(homeDir, '.config');
  return path.posix.join(configRoot, 'JatoDigital', 'OpenJatoBID', 'bootstrap.json');
}

function getGpuStartupProbePath(app) {
  return path.join(getUserDataPath(app), 'gpu_startup_probe.json');
}

function getWorkspaceDir(app) {
  return path.join(getUserDataPath(app), 'workspace');
}

function getWorkspaceDatabasePath(app) {
  return path.join(getWorkspaceDir(app), 'yibiao.sqlite');
}

function getTechnicalPlanDir(app) {
  return path.join(getWorkspaceDir(app), 'technical-plan');
}

function getTechnicalPlanTenderMarkdownPath(app) {
  return path.join(getTechnicalPlanDir(app), 'tender.md');
}

function getTechnicalPlanOriginalPlanMarkdownPath(app) {
  return path.join(getTechnicalPlanDir(app), 'original-plan.md');
}

function getTechnicalPlanIllustrationsDir(app) {
  return path.join(getTechnicalPlanDir(app), 'illustrations');
}

function getTechnicalPlanGeneratedIllustrationsDir(app) {
  return path.join(getGeneratedImagesDir(app), 'technical-plan', 'illustrations');
}

function getDuplicateCheckDir(app) {
  return path.join(getWorkspaceDir(app), 'duplicate-check');
}

function getDuplicateCheckContentDir(app) {
  return path.join(getDuplicateCheckDir(app), 'contents');
}

function getRejectionCheckDir(app) {
  return path.join(getWorkspaceDir(app), 'rejection-check');
}

function getRejectionCheckDocumentMarkdownPath(app, role, documentId) {
  if (role === 'bid') {
    const safeDocumentId = String(documentId || 'bid').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(getRejectionCheckDir(app), 'bids', `${safeDocumentId}.md`);
  }
  const tenderDocumentId = String(documentId || '').trim();
  if (tenderDocumentId && tenderDocumentId !== 'tender') {
    const safeDocumentId = tenderDocumentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(getRejectionCheckDir(app), 'tenders', `${safeDocumentId}.md`);
  }
  return path.join(getRejectionCheckDir(app), 'tender.md');
}

function getGeneratedImagesDir(app) {
  return path.join(getWorkspaceDir(app), 'generated-images');
}

function getImportedImagesDir(app) {
  return path.join(getWorkspaceDir(app), 'imported-images');
}

function getKnowledgeBaseDir(app) {
  return path.join(getWorkspaceDir(app), 'knowledge-base');
}

function getAiLogsDir(app) {
  return path.join(getUserDataPath(app), 'logs', 'ai');
}

function getDeveloperLogsDir(app, moduleName) {
  return path.join(getUserDataPath(app), 'logs', String(moduleName || 'app'));
}

function getTechnicalPlanLogsDir(app) {
  return getDeveloperLogsDir(app, 'technical-plan');
}

function getAgentRuntimeDir(app) {
  return path.join(getUserDataPath(app), 'agent-runtime');
}

function getAgentCacheDir(app) {
  return path.join(getUserDataPath(app), 'agent-cache');
}

function getPlatformArchKey() {
  return `${process.platform}-${process.arch}`;
}

function getBundledAgentToolsBinDir(app) {
  if (!app.isPackaged && process.env.YIBIAO_AGENT_TOOLS_BIN_DIR) {
    return process.env.YIBIAO_AGENT_TOOLS_BIN_DIR;
  }

  const platformArch = getPlatformArchKey();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'agent-tools', platformArch, 'bin');
  }

  return path.join(__dirname, '..', '..', 'vendor', 'agent-tools', platformArch, 'bin');
}

module.exports = {
  getAgentCacheDir,
  getAgentRuntimeDir,
  getAiLogsDir,
  getBundledAgentToolsBinDir,
  getDeveloperLogsDir,
  getDuplicateCheckContentDir,
  getDuplicateCheckDir,
  getConfigFilePath,
  getDeviceBootstrapFilePath,
  getGpuStartupProbePath,
  getGeneratedImagesDir,
  getImportedImagesDir,
  getKnowledgeBaseDir,
  getLicenseFilePath,
  getRejectionCheckDir,
  getRejectionCheckDocumentMarkdownPath,
  getTechnicalPlanDir,
  getTechnicalPlanGeneratedIllustrationsDir,
  getTechnicalPlanIllustrationsDir,
  getTechnicalPlanLogsDir,
  getTechnicalPlanOriginalPlanMarkdownPath,
  getTechnicalPlanTenderMarkdownPath,
  getWorkspaceDir,
  getWorkspaceDatabasePath,
  getUserDataPath,
};
