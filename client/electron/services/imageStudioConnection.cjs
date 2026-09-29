const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

const BASE_URL = 'https://img-api.jlaudeapi.com/v1';

function createImageStudioConnection(app) {
  const keyPath = path.join(app.getPath('userData'), 'image-studio-jinlong-key.bin');
  function readKey() {
    if (!fs.existsSync(keyPath)) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据保护不可用，暂不能读取生图密钥。');
    return safeStorage.decryptString(fs.readFileSync(keyPath));
  }
  function status() {
    return { provider: 'jinlong', baseUrl: BASE_URL, configured: Boolean(readKey()), channelVerified: false };
  }
  function saveKey(input = {}) {
    const key = String(input.apiKey || '').trim();
    if (!key) throw new Error('请输入金龙 API Key。');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据保护不可用，暂不能保存生图密钥。');
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const temporary = `${keyPath}.tmp`;
    fs.writeFileSync(temporary, safeStorage.encryptString(key));
    fs.renameSync(temporary, keyPath);
    return status();
  }
  return { readKey, status, saveKey };
}

module.exports = { BASE_URL, createImageStudioConnection };
