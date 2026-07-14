const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { shell } = require('electron');
const { getLicenseFilePath } = require('../utils/paths.cjs');

const UPDATE_RELEASE_API = 'https://bidupdat.migrant1124.workers.dev/updates/latest';
const UPDATE_RELEASE_DOWNLOAD_URL = 'https://bidupdat.migrant1124.workers.dev/updates/latest';
const LICENSE_HEADER = 'X-Jato-License';

let autoUpdaterInstance = null;
let downloadedUpdateVersion = '';
let downloadedUpdateChannel = '';
let downloadedUpdateFilePath = '';
let activeUpdateCheckPromise = null;

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function normalizeUpdateChannel(value) {
  return value === 'github' ? value : 'github';
}

function getUpdateChannel(configStore) {
  if (!configStore) {
    return 'github';
  }
  const config = configStore.load();
  return normalizeUpdateChannel(config.update_channel);
}

function requestJson(url, label, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'yibiao-client', ...headers } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        requestJson(new URL(response.headers.location, url).toString(), label, headers).then(resolve, reject);
        return;
      }

      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${label}请求失败：${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`解析${label}响应失败`));
        }
      });
    });
    request.on('error', (error) => reject(error));
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('请求超时'));
    });
  });
}

function postJson(url, label, body, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`${label}地址无效`));
      return;
    }

    const payload = JSON.stringify(body || {});
    const request = https.request(parsedUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'yibiao-client',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        postJson(new URL(response.headers.location, parsedUrl).toString(), label, body, headers).then(resolve, reject);
        return;
      }

      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${label}请求失败：${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`解析${label}响应失败`));
        }
      });
    });
    request.on('error', (error) => reject(error));
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('请求超时'));
    });
    request.write(payload);
    request.end();
  });
}

function base64UrlEncodeText(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function readUpdateLicense(app) {
  if (!app) {
    return null;
  }
  try {
    const licensePath = getLicenseFilePath(app);
    if (!fs.existsSync(licensePath)) {
      return null;
    }
    const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    return license && typeof license === 'object' ? license : null;
  } catch {
    return null;
  }
}

function getUpdateLicenseHeader(app) {
  const license = readUpdateLicense(app);
  if (!license) {
    throw new Error('请先完成软件授权后再检查更新');
  }
  return base64UrlEncodeText(JSON.stringify(license));
}

async function fetchAuthorizedLatestRelease(options = {}) {
  const license = readUpdateLicense(options.app);
  if (!license) {
    throw new Error('请先完成软件授权后再检查更新');
  }

  const result = await postJson(UPDATE_RELEASE_API, '更新服务 ', { license });
  const release = result?.release || {};
  const files = Array.isArray(release.assets)
    ? release.assets.map((asset) => ({
      name: asset.name || '',
      url: asset.browser_download_url || '',
      size: Number(asset.size || 0),
      digest: asset.digest || '',
    }))
    : Array.isArray(release.files)
      ? release.files.map((file) => ({
        name: file.name || '',
        url: file.url || '',
        size: Number(file.size || 0),
        digest: file.digest || '',
      }))
    : [];
  const downloadFile = pickPlatformDownloadFile(files);
  return {
    channel: 'authorized',
    version: String(release.version || release.tagName || '').replace(/^v/, ''),
    name: release.name || '',
    body: release.body || '',
    published_at: release.published_at || release.generatedAt || '',
    html_url: release.html_url || release.githubReleaseUrl || UPDATE_RELEASE_DOWNLOAD_URL,
    download_url: downloadFile?.url || UPDATE_RELEASE_DOWNLOAD_URL,
    files,
  };
}

function getMacUpdateArch() {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function pickMacDmgFile(files = []) {
  const validFiles = Array.isArray(files) ? files.filter((file) => file?.url && file?.name) : [];
  const arch = getMacUpdateArch();
  return validFiles.find((file) => new RegExp(`-mac-${arch}\\.dmg$`, 'i').test(file.name))
    || validFiles.find((file) => /-mac-(?:x64|arm64)\.dmg$/i.test(file.name))
    || validFiles.find((file) => /\.dmg$/i.test(file.name));
}

function pickPlatformDownloadFile(files = []) {
  const validFiles = Array.isArray(files) ? files.filter((file) => file?.url && file?.name) : [];
  if (process.platform === 'win32') {
    return validFiles.find((file) => /-win-x64\.exe$/i.test(file.name))
      || validFiles.find((file) => /-win-x64\.msi$/i.test(file.name))
      || validFiles.find((file) => /-win-x64\.zip$/i.test(file.name));
  }
  if (process.platform === 'darwin') {
    const arch = getMacUpdateArch();
    return pickMacDmgFile(validFiles)
      || validFiles.find((file) => new RegExp(`-mac-${arch}\\.zip$`, 'i').test(file.name))
      || validFiles.find((file) => /-mac-(?:x64|arm64)\.zip$/i.test(file.name));
  }
  return null;
}

function fetchLatestRelease(_channel, options = {}) {
  return fetchAuthorizedLatestRelease(options);
}

async function getLatestVersion(options = {}) {
  const channel = getUpdateChannel(options.configStore);
  return fetchLatestRelease(channel, options);
}

async function getUpdateDownloadUrl() {
  return UPDATE_RELEASE_DOWNLOAD_URL;
}

function configureAutoUpdater() {
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function setProgressBar(mainWindow, progress) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.setProgressBar(progress);
}

function getDisabledResult() {
  return { enabled: false, updateAvailable: false };
}

function sanitizeDownloadFileName(fileName, fallback) {
  const normalized = String(fileName || '').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
  const baseName = path.basename(normalized);
  return baseName && baseName !== '.' && baseName !== '..' ? baseName : fallback;
}

function getMacDmgDownloadPath(app, release, file) {
  const fallbackName = `Jato-AI-BID-${release.version || 'update'}-mac-${getMacUpdateArch()}.dmg`;
  const fileName = sanitizeDownloadFileName(file?.name, fallbackName);
  return path.join(app.getPath('userData'), 'updates', fileName);
}

function getUpdateDownloadPath(app, release, file) {
  if (process.platform === 'darwin') {
    return getMacDmgDownloadPath(app, release, file);
  }
  const fallbackName = `Jato-AI-BID-${release.version || 'update'}-win-x64.exe`;
  const fileName = sanitizeDownloadFileName(file?.name, fallbackName);
  return path.join(app.getPath('userData'), 'updates', fileName);
}

function isDownloadedFileReady(filePath, expectedSize = 0) {
  if (!filePath) {
    return false;
  }
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0 && (!expectedSize || stat.size === expectedSize);
  } catch {
    return false;
  }
}

function requestModuleForUrl(url) {
  if (url.protocol === 'https:') return https;
  if (url.protocol === 'http:') return http;
  throw new Error(`不支持的下载地址协议：${url.protocol}`);
}

function downloadFile(url, destinationPath, options = {}, redirectCount = 0) {
  const { expectedSize = 0, onProgress, headers = {} } = options;
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error('更新包下载地址无效'));
      return;
    }

    let settled = false;
    let tempPath = '';
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (tempPath) {
        try { fs.rmSync(tempPath, { force: true }); } catch {}
      }
      reject(error);
    };

    let request;
    try {
      request = requestModuleForUrl(parsedUrl).get(parsedUrl, { headers: { 'User-Agent': 'yibiao-client', ...headers } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          if (redirectCount >= 5) {
            fail(new Error('更新包下载重定向次数过多'));
            return;
          }
          downloadFile(new URL(response.headers.location, parsedUrl).toString(), destinationPath, options, redirectCount + 1)
            .then(resolve, reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          fail(new Error(`更新包下载失败：${response.statusCode}`));
          return;
        }

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
        const output = fs.createWriteStream(tempPath);
        const total = Number(response.headers['content-length'] || expectedSize || 0);
        let downloaded = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            onProgress?.(Math.max(0, Math.min(100, (downloaded / total) * 100)));
          }
        });
        response.on('error', fail);
        output.on('error', fail);
        output.on('finish', () => {
          output.close(() => {
            try {
              fs.rmSync(destinationPath, { force: true });
              fs.renameSync(tempPath, destinationPath);
              tempPath = '';
              if (expectedSize && fs.statSync(destinationPath).size !== expectedSize) {
                throw new Error('更新包下载不完整，请重新检查更新');
              }
              onProgress?.(100);
              settled = true;
              resolve(destinationPath);
            } catch (error) {
              if (!tempPath) {
                try { fs.rmSync(destinationPath, { force: true }); } catch {}
              }
              fail(error);
            }
          });
        });

        response.pipe(output);
      });
    } catch (error) {
      fail(error);
      return;
    }

    request.on('error', fail);
    request.setTimeout(60000, () => {
      request.destroy(new Error('下载更新包超时'));
    });
  });
}

async function runMacDmgUpdateCheck(options, release, channel) {
  const { app, mainWindow, onProgress, onDownloaded, onError } = options;
  const dmgFile = pickMacDmgFile(release.files);
  if (!dmgFile) {
    const message = '未找到适用于 macOS 的 DMG 更新包';
    onError?.(message);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message, channel };
  }

  const destinationPath = getMacDmgDownloadPath(app, release, dmgFile);
  const expectedSize = Number(dmgFile.size || 0);

  try {
    if (isDownloadedFileReady(destinationPath, expectedSize)) {
      downloadedUpdateVersion = release.version;
      downloadedUpdateChannel = channel;
      downloadedUpdateFilePath = destinationPath;
      onDownloaded?.(release.version);
      return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
    }

    setProgressBar(mainWindow, 0);
    await downloadFile(dmgFile.url, destinationPath, {
      expectedSize,
      onProgress: (percent) => {
        setProgressBar(mainWindow, Math.max(0, Math.min(1, percent / 100)));
        onProgress?.(percent);
      },
    });

    downloadedUpdateVersion = release.version;
    downloadedUpdateChannel = channel;
    downloadedUpdateFilePath = destinationPath;
    setProgressBar(mainWindow, -1);
    onDownloaded?.(release.version);
    return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
  } catch (error) {
    const message = formatErrorMessage(error);
    setProgressBar(mainWindow, -1);
    onError?.(message);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message, channel };
  }
}

async function runDirectUpdateCheck(options, release, channel) {
  const { app, mainWindow, onProgress, onDownloaded, onError } = options;
  const download = pickPlatformDownloadFile(release.files);
  if (!download) {
    const message = '未找到适用于当前系统的更新包';
    onError?.(message);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message, channel };
  }

  const destinationPath = getUpdateDownloadPath(app, release, download);
  const expectedSize = Number(download.size || 0);

  try {
    if (isDownloadedFileReady(destinationPath, expectedSize)) {
      downloadedUpdateVersion = release.version;
      downloadedUpdateChannel = channel;
      downloadedUpdateFilePath = destinationPath;
      onDownloaded?.(release.version);
      return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
    }

    setProgressBar(mainWindow, 0);
    await downloadFile(download.url, destinationPath, {
      expectedSize,
      headers: { [LICENSE_HEADER]: getUpdateLicenseHeader(app) },
      onProgress: (percent) => {
        setProgressBar(mainWindow, Math.max(0, Math.min(1, percent / 100)));
        onProgress?.(percent);
      },
    });

    downloadedUpdateVersion = release.version;
    downloadedUpdateChannel = channel;
    downloadedUpdateFilePath = destinationPath;
    setProgressBar(mainWindow, -1);
    onDownloaded?.(release.version);
    return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
  } catch (error) {
    const message = formatErrorMessage(error);
    setProgressBar(mainWindow, -1);
    onError?.(message);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message, channel };
  }
}

async function runUpdateCheck(options = {}) {
  const { app, mainWindow, onProgress, onDownloaded, onError } = options;
  const channel = getUpdateChannel(options.configStore);
  const release = await fetchLatestRelease(channel, options);
  if (!release.version || compareVersions(release.version, app.getVersion()) <= 0) {
    return { enabled: true, updateAvailable: false, channel };
  }
  if (process.platform === 'darwin') {
    return runMacDmgUpdateCheck(options, release, channel);
  }
  return runDirectUpdateCheck(options, release, channel);
}

async function checkAndDownloadUpdate(options = {}) {
  const { app } = options;
  const channel = getUpdateChannel(options.configStore);
  if (!app?.isPackaged) {
    return getDisabledResult();
  }
  if (downloadedUpdateVersion && downloadedUpdateChannel === channel) {
    if (isDownloadedFileReady(downloadedUpdateFilePath)) {
      return { enabled: true, updateAvailable: true, version: downloadedUpdateVersion, downloaded: true, channel };
    }
    downloadedUpdateVersion = '';
    downloadedUpdateChannel = '';
    downloadedUpdateFilePath = '';
  }
  if (activeUpdateCheckPromise) {
    return activeUpdateCheckPromise;
  }

  activeUpdateCheckPromise = runUpdateCheck(options)
    .catch((error) => {
      const message = formatErrorMessage(error);
      options.onError?.(message);
      return { enabled: true, updateAvailable: false, failed: true, message, channel };
    })
    .finally(() => {
      activeUpdateCheckPromise = null;
    });
  return activeUpdateCheckPromise;
}

function triggerUpdateDownload(options) {
  return checkAndDownloadUpdate(options);
}

async function quitAndInstall(options = {}) {
  if (isDownloadedFileReady(downloadedUpdateFilePath)) {
    const openError = await shell.openPath(downloadedUpdateFilePath);
    if (openError) {
      return { success: false, message: `打开更新安装包失败：${openError}` };
    }

    const { app } = options;
    setTimeout(() => {
      if (app?.quit) {
        app.quit();
      }
    }, 500);
    return { success: true };
  }

  return { success: false, message: '更新包尚未下载完成，请先检查更新' };
}

function setupAutoUpdate({ app, mainWindow }) {
  if (app?.isPackaged) {
    setProgressBar(mainWindow, -1);
  }
}

module.exports = {
  setupAutoUpdate,
  checkAndDownloadUpdate,
  triggerUpdateDownload,
  quitAndInstall,
  getLatestVersion,
  getUpdateDownloadUrl,
};
