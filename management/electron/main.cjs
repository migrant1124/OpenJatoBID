const { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Tray } = require('electron');
const path = require('node:path');
const initialAdminCredential = require('./generated/initialAdminCredential.cjs');
const { registerAdminIpc } = require('./ipc/adminIpc.cjs');
const { createAdminAuthService } = require('./services/adminAuthService.cjs');
const { createAnalyticsIngestService } = require('./services/analyticsIngestService.cjs');
const { createAnalyticsQueryService } = require('./services/analyticsQueryService.cjs');
const { createAuthorizationService } = require('./services/authorizationService.cjs');
const { createDatabaseService } = require('./services/databaseService.cjs');
const { createHttpRouter } = require('./services/httpRouter.cjs');
const { createHttpServerService } = require('./services/httpServerService.cjs');
const { createSigningService } = require('./services/signingService.cjs');
const { createWindowCloseHandler } = require('./services/windowLifecycle.cjs');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
const MANAGEMENT_WINDOW_TITLE = '佳图智能投标管理台';
const managementIconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
let mainWindow = null;
let tray = null;
let isQuitting = false;
let databaseService = null;
let httpServerService = null;
let httpServerState = { status: 'STOPPED', address: null, message: '' };
let authorizationService = null;
let analyticsIngestService = null;
let analyticsQueryService = null;

function readServerConfig() {
  const row = databaseService?.database.prepare('SELECT value_json FROM settings WHERE key = ?').get('server_config');
  return row ? JSON.parse(row.value_json) : null;
}

async function startLanServer(config) {
  if (httpServerService) await httpServerService.stop();
  httpServerService = createHttpServerService({
    router: createHttpRouter({
      getServiceInfo: () => ({ managementVersion: app.getVersion() }),
      authorizationService,
      analyticsIngestService,
    }),
  });
  try {
    const address = await httpServerService.start(config);
    httpServerState = { status: 'RUNNING', address, message: '' };
  } catch (error) {
    httpServerService = null;
    httpServerState = {
      status: 'ERROR',
      address: null,
      message: error?.code === 'EADDRINUSE' ? '监听端口已被占用' : '局域网服务启动失败',
    };
    throw error;
  }
}

function createTrayImage() {
  return nativeImage.createFromPath(managementIconPath).resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    title: MANAGEMENT_WINDOW_TITLE,
    backgroundColor: '#f8fafd',
    icon: managementIconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(MANAGEMENT_WINDOW_TITLE);
  });

  mainWindow.on('close', createWindowCloseHandler({
    isQuitting: () => isQuitting,
    hide: () => mainWindow?.hide(),
  }));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.setTitle(MANAGEMENT_WINDOW_TITLE);
    mainWindow?.show();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip('佳图智能投标管理台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开管理界面', click: showMainWindow },
    { type: 'separator' },
    {
      label: '退出服务',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', showMainWindow);
}

function registerAppIpc() {
  ipcMain.handle('management:app:get-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    autoStartEnabled: app.getLoginItemSettings().openAtLogin,
  }));
  ipcMain.handle('management:server:get-status', () => ({ ...httpServerState }));
  ipcMain.on('management:window:minimize', () => mainWindow?.minimize());
  ipcMain.on('management:window:hide', () => mainWindow?.hide());
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.jiatu.aibid.management');
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => {
    isQuitting = true;
    void httpServerService?.stop();
    databaseService?.close();
    databaseService = null;
  });
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'light';
    Menu.setApplicationMenu(null);
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    databaseService = createDatabaseService({
      databasePath: path.join(app.getPath('userData'), 'management.sqlite3'),
    });
    authorizationService = createAuthorizationService({
      database: databaseService.database,
      signingService: createSigningService({ database: databaseService.database }),
    });
    analyticsIngestService = createAnalyticsIngestService({ database: databaseService.database });
    analyticsQueryService = createAnalyticsQueryService({ database: databaseService.database });
    registerAdminIpc({
      ipcMain,
      database: databaseService.database,
      authService: createAdminAuthService({
        database: databaseService.database,
        initialCredential: initialAdminCredential,
      }),
      authorizationService,
      analyticsQueryService,
      onSetupComplete: startLanServer,
    });
    registerAppIpc();
    const serverConfig = readServerConfig();
    if (serverConfig) {
      void startLanServer(serverConfig).catch(() => {});
    }
    createMainWindow();
    createTray();
  });
}
