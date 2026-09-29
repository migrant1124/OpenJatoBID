const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const { dialog } = require('electron');
const { assertPublicUrl } = require('./imageStudioSources.cjs');

function createImageStudioKnowledge(app, dialogApi = dialog) {
  const bundledRoot = path.join(__dirname, '../resources/image-studio-knowledge');
  const targetRoot = app?.getPath ? path.join(app.getPath('userData'), 'image-studio-knowledge') : '';
  const pointerPath = targetRoot ? path.join(targetRoot, 'current.json') : '';
  const checkPath = targetRoot ? path.join(targetRoot, 'upstream-check.json') : '';
  const distribution = JSON.parse(fs.readFileSync(path.join(bundledRoot, 'distribution.json'), 'utf8'));
  const settingsPath = targetRoot ? path.join(targetRoot, 'settings.json') : '';
  let enabled = !settingsPath || !fs.existsSync(settingsPath)
    || JSON.parse(fs.readFileSync(settingsPath, 'utf8')).enabled !== false;
  const activeRoot = () => {
    if (!pointerPath || !fs.existsSync(pointerPath)) return bundledRoot;
    const { version } = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    return /^youmind-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/.test(version)
      ? path.join(targetRoot, version) : bundledRoot;
  };
  let worker;
  let ready = false;
  let version = '';
  let error = '';
  let nextId = 0;
  const pending = new Map();
  function ensureWorker() {
    if (worker) return;
    const running = new Worker(path.join(__dirname, 'imageStudioKnowledgeWorker.cjs'), { workerData: { root: activeRoot() } });
    worker = running;
    running.on('message', (message) => {
      if (message.type === 'ready') { ready = true; version = message.version; return; }
      if (message.type === 'error') { error = message.error; return; }
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    });
    running.on('error', (cause) => { if (worker === running) { error = String(cause.message || cause); ready = false; } });
    running.on('exit', () => {
      if (worker !== running) return;
      ready = false; worker = null;
      for (const resolve of pending.values()) resolve({ error: '知识工作线程已退出。' });
      pending.clear();
    });
    running.unref();
  }
  function status() { if (enabled) ensureWorker(); return { ready: enabled && ready, version, error, enabled }; }
  function setEnabled(value) {
    enabled = value === true;
    if (settingsPath) {
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({ enabled }), 'utf8');
    }
    return status();
  }
  async function search(query) {
    if (!enabled) return { items: [], status: 'disabled', version };
    ensureWorker();
    const deadline = Date.now() + 500;
    while (!ready && !error && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!ready) return { items: [], status: error ? 'error' : 'timeout', version };
    const id = ++nextId;
    const result = await Promise.race([
      new Promise((resolve) => { pending.set(id, resolve); worker.postMessage({ id, query }); }),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), Math.max(1, deadline - Date.now()))),
    ]);
    pending.delete(id);
    return { items: result.items || [], status: result.timeout ? 'timeout' : result.error ? 'error' : 'matched', version };
  }
  async function importPackage(filePath, expectedCommit) {
    if (!targetRoot) throw new Error('当前环境没有可写的用户数据目录。');
    if (!filePath) {
      const choice = await dialogApi.showOpenDialog({ properties: ['openFile'], filters: [{ name: '知识包 ZIP', extensions: ['zip'] }] });
      if (choice.canceled || !choice.filePaths?.[0]) return { canceled: true };
      filePath = choice.filePaths[0];
    }
    const currentManifest = JSON.parse(fs.readFileSync(path.join(activeRoot(), 'manifest.json'), 'utf8'));
    const result = await new Promise((resolve, reject) => {
      const validator = new Worker(path.join(__dirname, 'imageStudioKnowledgeImportWorker.cjs'), { workerData: {
        filePath, targetRoot, publicKeyPath: path.join(bundledRoot, 'trust-public.pem'),
        currentVersion: currentManifest.packageVersion, currentGeneratedAt: currentManifest.generatedAt, expectedCommit,
      } });
      validator.once('message', resolve);
      validator.once('error', reject);
    });
    if (result.error) throw new Error(result.error);
    if (!result.unchanged) {
      const old = worker;
      worker = null; ready = false; version = ''; error = '';
      if (old) await old.terminate();
      ensureWorker();
    }
    return result;
  }
  async function downloadPackage(rawUrl, expectedCommit) {
    fs.mkdirSync(targetRoot, { recursive: true });
    const temporary = path.join(targetRoot, `.download-${Date.now()}.zip`);
    try {
      let url = rawUrl;
      for (let redirect = 0; redirect < 4; redirect += 1) {
        await assertPublicUrl(url);
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new Error('知识包重定向缺少地址。');
          url = new URL(location, url).href;
          continue;
        }
        if (!response.ok) throw new Error(`知识包下载 HTTP ${response.status}`);
        if (Number(response.headers.get('content-length') || 0) > 35_000_000) throw new Error('知识包超过 35 MB。');
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 35_000_000) throw new Error('知识包超过 35 MB。');
          chunks.push(chunk);
        }
        fs.writeFileSync(temporary, Buffer.concat(chunks));
        return await importPackage(temporary, expectedCommit);
      }
      throw new Error('知识包重定向过多。');
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  async function checkUpdates({ manual = false } = {}) {
    const previous = checkPath && fs.existsSync(checkPath) ? JSON.parse(fs.readFileSync(checkPath, 'utf8')) : {};
    const now = Date.now();
    if (!manual && previous.nextCheckAt && now < previous.nextCheckAt) return previous.result;
    try {
      const response = await fetch('https://api.github.com/repos/YouMind-OpenLab/ai-image-prompts-skill/commits/main', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenJatoBID-image-studio' },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`上游检查 HTTP ${response.status}`);
      const commit = (await response.json()).sha;
      if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('上游提交标识无效。');
      const installed = JSON.parse(fs.readFileSync(path.join(activeRoot(), 'manifest.json'), 'utf8'));
      const available = commit !== installed.upstreamCommit;
      const installedPackage = available && distribution.packageUrl
        ? await downloadPackage(distribution.packageUrl, commit) : null;
      const result = { available, commit, status: installedPackage && !installedPackage.unchanged
        ? `签名知识包 ${installedPackage.version} 已安装。`
        : available ? '上游有新提交；待维护者制作并分发签名知识包。当前快照仍可使用。'
          : '上游提交未变化；当前知识快照可继续使用。' };
      if (checkPath) { fs.mkdirSync(targetRoot, { recursive: true }); fs.writeFileSync(checkPath, JSON.stringify({ nextCheckAt: now + 168 * 3600000, result }), 'utf8'); }
      return result;
    } catch (cause) {
      const result = { available: false, status: `上游检查失败，继续使用旧知识：${String(cause.message || cause)}` };
      if (checkPath) { fs.mkdirSync(targetRoot, { recursive: true }); fs.writeFileSync(checkPath, JSON.stringify({ nextCheckAt: now + 3600000, result }), 'utf8'); }
      return result;
    }
  }
  if (app?.on) {
    const timer = setTimeout(() => { void checkUpdates(); }, 15000);
    const hourly = setInterval(() => { void checkUpdates(); }, 3600000);
    timer.unref?.();
    hourly.unref?.();
    app.on('before-quit', () => { clearTimeout(timer); clearInterval(hourly); });
  }
  app?.on?.('before-quit', () => { void worker?.terminate(); });
  return { status, setEnabled, search, importPackage, checkUpdates, close: () => worker?.terminate() };
}

module.exports = { createImageStudioKnowledge };
