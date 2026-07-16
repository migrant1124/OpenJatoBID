const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { shell } = require('electron');
const { getLicenseFilePath } = require('../utils/paths.cjs');

const UPDATE_RELEASE_API = 'https://bidupdat.migrant1124.workers.dev/updates/latest';
const UPDATE_RELEASE_DOWNLOAD_URL = 'https://bidupdat.migrant1124.workers.dev/updates/latest';
const LICENSE_HEADER = 'X-Jato-License';
const UPDATE_STAGES = new Set(['latest', 'license', 'select-asset', 'download', 'integrity', 'open-installer']);

let autoUpdaterInstance = null;
let downloadedUpdateVersion = '';
let downloadedUpdateChannel = '';
let downloadedUpdateFilePath = '';
let downloadedUpdateFileSize = 0;
let downloadedUpdateSha256 = '';
let activeUpdateCheckPromise = null;

function compareVersions(a, b) {
  const parse = (value) => {
    const match = String(value || '').match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function normalizeUpdateChannel(value) {
  return 'cloudflare-r2';
}

function getUpdateChannel(configStore) {
  if (!configStore) {
    return 'cloudflare-r2';
  }
  const config = configStore.load();
  return normalizeUpdateChannel(config.update_channel);
}

function createUpdateError(stage, code, message, details = {}) {
  const error = new Error(message);
  error.stage = UPDATE_STAGES.has(stage) ? stage : 'latest';
  error.code = code;
  error.statusCode = Number.isInteger(details.statusCode) ? details.statusCode : undefined;
  error.version = details.version ? String(details.version) : undefined;
  error.fileName = details.fileName ? String(details.fileName) : undefined;
  return error;
}

function getUpdateErrorCode(error, stage) {
  if (error?.code && String(error.code).startsWith('UPDATE_')) return error.code;
  if (error?.code === 'ETIMEDOUT' || /超时/.test(error?.message || '')) return 'UPDATE_TIMEOUT';
  if (/CERT_|TLS|SSL/i.test(error?.code || '') || /证书|TLS|SSL/i.test(error?.message || '')) return 'UPDATE_TLS_FAILURE';
  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(error?.code || '')) return 'UPDATE_NETWORK_UNREACHABLE';
  return stage === 'download' ? 'UPDATE_DOWNLOAD_FAILED' : 'UPDATE_SERVICE_UNAVAILABLE';
}

function toUpdateError(error, stage, details = {}) {
  if (error?.stage && error?.code?.startsWith?.('UPDATE_')) return error;
  return createUpdateError(stage, getUpdateErrorCode(error, stage), formatErrorMessage(error), details);
}

function getUpdateErrorPayload(error, details = {}) {
  const normalized = toUpdateError(error, details.stage || error?.stage || 'latest', details);
  return {
    stage: normalized.stage,
    code: normalized.code,
    statusCode: normalized.statusCode,
    version: normalized.version,
    fileName: normalized.fileName,
    message: String(normalized.message || '更新失败').replace(/<[^>]*>/g, '').slice(0, 240),
  };
}

function logUpdateFailure(error, details = {}) {
  const payload = getUpdateErrorPayload(error, details);
  console.warn('[update]', payload);
  return payload;
}

function readLimitedErrorBody(response, limit = 8 * 1024) {
  let bytes = 0;
  response.on('data', (chunk) => { bytes += Math.min(Buffer.byteLength(chunk), Math.max(0, limit - bytes)); });
  return new Promise((resolve) => response.on('end', resolve));
}

function createHttpStatusError(stage, label, statusCode) {
  const code = statusCode === 401 || statusCode === 403
    ? 'UPDATE_AUTH_REJECTED'
    : (statusCode === 404 && stage === 'latest' ? 'UPDATE_LATEST_NOT_FOUND' : 'UPDATE_SERVICE_UNAVAILABLE');
  return createUpdateError(stage, code, `${label}请求失败：${statusCode}`, { statusCode });
}

function requestJson(url, label, headers = {}, stage = 'latest') {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'yibiao-client', ...headers } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        requestJson(new URL(response.headers.location, url).toString(), label, headers, stage).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        readLimitedErrorBody(response).then(() => reject(createHttpStatusError(stage, label, response.statusCode)));
        return;
      }
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(createUpdateError(stage, 'UPDATE_RESPONSE_INVALID', `解析${label}响应失败`));
        }
      });
    });
    request.on('error', (error) => reject(toUpdateError(error, stage)));
    request.setTimeout(10000, () => {
      request.destroy(createUpdateError(stage, 'UPDATE_TIMEOUT', '请求超时'));
    });
  });
}

function postJson(url, label, body, headers = {}, stage = 'latest') {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(createUpdateError(stage, 'UPDATE_RESPONSE_INVALID', `${label}地址无效`));
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
        postJson(new URL(response.headers.location, parsedUrl).toString(), label, body, headers, stage).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        readLimitedErrorBody(response).then(() => reject(createHttpStatusError(stage, label, response.statusCode)));
        return;
      }
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(createUpdateError(stage, 'UPDATE_RESPONSE_INVALID', `解析${label}响应失败`));
        }
      });
    });
    request.on('error', (error) => reject(toUpdateError(error, stage)));
    request.setTimeout(10000, () => {
      request.destroy(createUpdateError(stage, 'UPDATE_TIMEOUT', '请求超时'));
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
    throw createUpdateError('license', 'UPDATE_LICENSE_MISSING', '请先完成软件授权后再检查更新');
  }
  return base64UrlEncodeText(JSON.stringify(license));
}

function normalizeUpdateSha256(value) {
  const normalized = String(value || '').trim().replace(/^sha256:/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : '';
}

async function fetchAuthorizedLatestRelease(options = {}) {
  const license = readUpdateLicense(options.app);
  if (!license) {
    throw createUpdateError('license', 'UPDATE_LICENSE_MISSING', '请先完成软件授权后再检查更新');
  }

  const result = await postJson(UPDATE_RELEASE_API, '更新服务 ', { license }, {}, 'latest');
  const release = result?.release || {};
  const files = Array.isArray(release.assets)
    ? release.assets.map((asset) => ({
      name: asset.name || '',
      url: asset.browser_download_url || '',
      size: Number(asset.size || 0),
      sha256: normalizeUpdateSha256(asset.sha256 || asset.digest),
    }))
    : Array.isArray(release.files)
      ? release.files.map((file) => ({
        name: file.name || '',
        url: file.url || '',
        size: Number(file.size || 0),
        sha256: normalizeUpdateSha256(file.sha256 || file.digest),
      }))
    : [];
  const downloadFile = pickPlatformDownloadFile(files);
  const version = String(release.version || release.tagName || '').replace(/^v/, '');
  if (!version || !Array.isArray(release.assets) && !Array.isArray(release.files)) {
    throw createUpdateError('latest', 'UPDATE_RESPONSE_INVALID', '更新服务返回的数据不完整');
  }
  return {
    channel: 'authorized',
    version,
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

function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function isDownloadedFileReady(filePath, expectedSize = 0, expectedSha256 = '', removeInvalid = false) {
  if (!filePath) {
    return false;
  }
  let valid = false;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || (expectedSize && stat.size !== expectedSize)) {
      return false;
    }
    const normalizedSha256 = normalizeUpdateSha256(expectedSha256);
    if (expectedSha256 && !normalizedSha256) {
      return false;
    }
    valid = !normalizedSha256 || await calculateFileSha256(filePath) === normalizedSha256;
    return valid;
  } catch {
    return false;
  } finally {
    if (!valid && removeInvalid) {
      try { fs.rmSync(filePath, { force: true }); } catch {}
    }
  }
}

function requestModuleForUrl(url) {
  if (url.protocol === 'https:') return https;
  if (url.protocol === 'http:') return http;
  throw createUpdateError('download', 'UPDATE_ASSET_UNSUPPORTED', `不支持的下载地址协议：${url.protocol}`);
}

function downloadFile(url, destinationPath, options = {}, redirectCount = 0) {
  const { expectedSize = 0, expectedSha256 = '', onProgress, headers = {} } = options;
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(createUpdateError('download', 'UPDATE_ASSET_UNSUPPORTED', '更新包下载地址无效'));
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
            fail(createUpdateError('download', 'UPDATE_DOWNLOAD_FAILED', '更新包下载重定向次数过多'));
            return;
          }
          downloadFile(new URL(response.headers.location, parsedUrl).toString(), destinationPath, options, redirectCount + 1)
            .then(resolve, reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          readLimitedErrorBody(response).then(() => fail(createUpdateError('download', 'UPDATE_DOWNLOAD_FAILED', `更新包下载失败：${response.statusCode}`, { statusCode: response.statusCode })));
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
          output.close(async () => {
            try {
              if (expectedSize && fs.statSync(tempPath).size !== expectedSize) {
                throw createUpdateError('integrity', 'UPDATE_DOWNLOAD_INCOMPLETE', '更新包下载不完整，请重新检查更新');
              }
              const normalizedSha256 = normalizeUpdateSha256(expectedSha256);
              if (expectedSha256 && !normalizedSha256) {
                throw createUpdateError('integrity', 'UPDATE_SHA256_INVALID', '更新清单缺少有效的 SHA-256');
              }
              if (normalizedSha256 && await calculateFileSha256(tempPath) !== normalizedSha256) {
                fs.rmSync(destinationPath, { force: true });
                throw createUpdateError('integrity', 'UPDATE_SHA256_MISMATCH', '更新包校验失败，请重新检查更新');
              }
              fs.rmSync(destinationPath, { force: true });
              fs.renameSync(tempPath, destinationPath);
              tempPath = '';
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
      request.destroy(createUpdateError('download', 'UPDATE_TIMEOUT', '下载更新包超时'));
    });
  });
}

async function runMacDmgUpdateCheck(options, release, channel) {
  const { app, mainWindow, onProgress, onDownloaded, onError } = options;
  const dmgFile = pickMacDmgFile(release.files);
  if (!dmgFile) {
    const error = createUpdateError('select-asset', 'UPDATE_ASSET_NOT_FOUND', '未找到适用于 macOS 的 DMG 更新包', { version: release.version });
    const payload = logUpdateFailure(error, { version: release.version });
    onError?.(payload);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message: payload.message, code: payload.code, stage: payload.stage, channel };
  }

  const destinationPath = getMacDmgDownloadPath(app, release, dmgFile);
  const expectedSize = Number(dmgFile.size || 0);

  try {
    if (await isDownloadedFileReady(destinationPath, expectedSize)) {
      downloadedUpdateVersion = release.version;
      downloadedUpdateChannel = channel;
      downloadedUpdateFilePath = destinationPath;
      downloadedUpdateFileSize = expectedSize;
      downloadedUpdateSha256 = '';
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
    downloadedUpdateFileSize = expectedSize;
    downloadedUpdateSha256 = '';
    setProgressBar(mainWindow, -1);
    onDownloaded?.(release.version);
    return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
  } catch (error) {
    const payload = logUpdateFailure(error, { stage: error?.stage || 'download', version: release.version, fileName: dmgFile.name });
    setProgressBar(mainWindow, -1);
    onError?.(payload);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message: payload.message, code: payload.code, stage: payload.stage, channel };
  }
}

async function runDirectUpdateCheck(options, release, channel) {
  const { app, mainWindow, onProgress, onDownloaded, onError } = options;
  const download = pickPlatformDownloadFile(release.files);
  if (!download) {
    const error = createUpdateError('select-asset', 'UPDATE_ASSET_NOT_FOUND', '未找到适用于当前系统的更新包', { version: release.version });
    const payload = logUpdateFailure(error, { version: release.version });
    onError?.(payload);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message: payload.message, code: payload.code, stage: payload.stage, channel };
  }

  const destinationPath = getUpdateDownloadPath(app, release, download);
  const expectedSize = Number(download.size || 0);
  const expectedSha256 = normalizeUpdateSha256(download.sha256);

  if (!expectedSha256) {
    const error = createUpdateError('integrity', 'UPDATE_SHA256_INVALID', '更新清单缺少有效的 SHA-256', { version: release.version, fileName: download.name });
    const payload = logUpdateFailure(error, { version: release.version, fileName: download.name });
    onError?.(payload);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message: payload.message, code: payload.code, stage: payload.stage, channel };
  }

  try {
    if (await isDownloadedFileReady(destinationPath, expectedSize, expectedSha256, true)) {
      downloadedUpdateVersion = release.version;
      downloadedUpdateChannel = channel;
      downloadedUpdateFilePath = destinationPath;
      downloadedUpdateFileSize = expectedSize;
      downloadedUpdateSha256 = expectedSha256;
      onDownloaded?.(release.version);
      return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
    }

    setProgressBar(mainWindow, 0);
    await downloadFile(download.url, destinationPath, {
      expectedSize,
      expectedSha256,
      headers: { [LICENSE_HEADER]: getUpdateLicenseHeader(app) },
      onProgress: (percent) => {
        setProgressBar(mainWindow, Math.max(0, Math.min(1, percent / 100)));
        onProgress?.(percent);
      },
    });

    downloadedUpdateVersion = release.version;
    downloadedUpdateChannel = channel;
    downloadedUpdateFilePath = destinationPath;
    downloadedUpdateFileSize = expectedSize;
    downloadedUpdateSha256 = expectedSha256;
    setProgressBar(mainWindow, -1);
    onDownloaded?.(release.version);
    return { enabled: true, updateAvailable: true, version: release.version, downloaded: true, channel };
  } catch (error) {
    const payload = logUpdateFailure(error, { stage: error?.stage || 'download', version: release.version, fileName: download.name });
    setProgressBar(mainWindow, -1);
    onError?.(payload);
    return { enabled: true, updateAvailable: true, version: release.version, failed: true, message: payload.message, code: payload.code, stage: payload.stage, channel };
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
    if (await isDownloadedFileReady(
      downloadedUpdateFilePath,
      downloadedUpdateFileSize,
      downloadedUpdateSha256,
      true,
    )) {
      return { enabled: true, updateAvailable: true, version: downloadedUpdateVersion, downloaded: true, channel };
    }
    downloadedUpdateVersion = '';
    downloadedUpdateChannel = '';
    downloadedUpdateFilePath = '';
    downloadedUpdateFileSize = 0;
    downloadedUpdateSha256 = '';
  }
  if (activeUpdateCheckPromise) {
    return activeUpdateCheckPromise;
  }

  activeUpdateCheckPromise = runUpdateCheck(options)
    .catch((error) => {
      const payload = logUpdateFailure(error, { stage: error?.stage || 'latest' });
      options.onError?.(payload);
      return { enabled: true, updateAvailable: false, failed: true, message: payload.message, code: payload.code, stage: payload.stage, channel };
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
  if (await isDownloadedFileReady(
    downloadedUpdateFilePath,
    downloadedUpdateFileSize,
    downloadedUpdateSha256,
    true,
  )) {
    const openError = await shell.openPath(downloadedUpdateFilePath);
    if (openError) {
      const payload = logUpdateFailure(
        createUpdateError('open-installer', 'UPDATE_INSTALLER_OPEN_FAILED', '打开更新安装包失败'),
        { stage: 'open-installer', version: downloadedUpdateVersion, fileName: path.basename(downloadedUpdateFilePath) },
      );
      return { success: false, message: payload.message, code: payload.code, stage: payload.stage };
    }

    const { app } = options;
    setTimeout(() => {
      if (app?.quit) {
        app.quit();
      }
    }, 500);
    return { success: true };
  }

  return { success: false, message: '更新包尚未下载完成，请先检查更新', code: 'UPDATE_DOWNLOAD_INCOMPLETE', stage: 'integrity' };
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
  __test__: {
    compareVersions,
    calculateFileSha256,
    downloadFile,
    isDownloadedFileReady,
    normalizeUpdateSha256,
    normalizeUpdateChannel,
    pickPlatformDownloadFile,
    createUpdateError,
    getUpdateErrorPayload,
    toUpdateError,
  },
};
