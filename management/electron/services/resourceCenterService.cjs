const fs = require('node:fs');
const path = require('node:path');
const { createResourceStore, WEEK_MS, hash } = require('./resourceStore.cjs');
const { DEFAULT_SOURCES, createResourceSourceAdapters } = require('./resourceSourceAdapters.cjs');
const { createResourceDownloadService } = require('./resourceDownloadService.cjs');
const { createResourceSyncService } = require('./resourceSyncService.cjs');
const { createResourceHttpRouter } = require('./resourceHttpRouter.cjs');

function createResourceCenterService({ database, signingService, defaultRoot, fetchImpl, validateImage, preparePreview, configureNetwork = async () => {} }) {
  const readSettings = () => {
    const row = database.prepare("SELECT value_json FROM settings WHERE key = 'resource_settings'").get();
    return row ? JSON.parse(row.value_json) : { root: defaultRoot, quotaBytes: 20 * 1024 ** 3, networkMode: 'system', proxyRules: '' };
  };
  const store = createResourceStore({ database, sources: DEFAULT_SOURCES });
  let settings = readSettings();
  let downloader = null, adapters = null, unavailable = '', configuring = false;
  async function prepare(config) {
    if (!fs.existsSync(config.root) && (database.prepare("SELECT 1 FROM settings WHERE key = 'resource_settings'").get() || database.prepare('SELECT COUNT(*) AS n FROM resource_assets').get().n)) throw new Error('资源目录失联，请重新连接或明确迁移；不会另建空镜像');
    await configureNetwork(config);
    const next = createResourceDownloadService({ root: config.root, store, fetchImpl, quotaBytes: config.quotaBytes, validateImage });
    downloader = next; adapters = createResourceSourceAdapters({ downloader, store, preparePreview: preparePreview ? (asset, report, options) => preparePreview(asset, report, { ...options, root: config.root, quotaBytes: config.quotaBytes, store }) : undefined }); unavailable = '';
  }
  const sync = createResourceSyncService({ store, adapters: {
    entries: (...args) => { if (!adapters) throw new Error(unavailable || '资源存储或网络尚未就绪'); return adapters.entries(...args); },
    prepare: (...args) => adapters.prepare(...args) } });
  let router = createResourceHttpRouter({ store, signingService, assetRoot: settings.root });
  const save = (value) => database.prepare(`INSERT INTO settings(key, value_json, updated_at) VALUES ('resource_settings', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run(JSON.stringify(value), new Date().toISOString());
  async function configure(input) {
    if (configuring || store.listSources().some((source) => source.running)) throw new Error('同步或迁移进行中，请先停止本次同步');
    const next = { ...settings, ...input };
    if (!path.isAbsolute(next.root) || !Number.isFinite(next.quotaBytes) || next.quotaBytes < 64 * 1024 ** 2 || !['system', 'proxy'].includes(next.networkMode)) throw new Error('请选择有效目录、配额及网络模式');
    if (next.networkMode === 'proxy' && !/^(?:(?:https?|socks[45]):\/\/)?[\w.\[\]:-]+$/.test(next.proxyRules)) throw new Error('请输入有效专用代理地址；凭据不放入URL');
    configuring = true; await sync.stop();
    try {
    fs.mkdirSync(next.root, { recursive: true });
    next.root = fs.realpathSync(next.root);
    if (path.resolve(next.root) !== path.resolve(settings.root)) {
      // 改目录时复制并验证归属文件，索引切换后旧副本仍保留，不触碰授权目录。
      const assets = database.prepare('SELECT * FROM resource_assets').all();
      for (const asset of assets) {
        const source = path.join(settings.root, asset.relative_path), destination = path.join(next.root, asset.relative_path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        await fs.promises.copyFile(source, destination);
        if (hash(await fs.promises.readFile(destination)) !== asset.hash) throw new Error('资源目录复制校验失败，原索引保持');
      }
    }
    await prepare(next);
    save(next); settings = next;
    router = createResourceHttpRouter({ store, signingService, assetRoot: settings.root });
    sync.start();
    return status();
    } catch (error) { await prepare(settings).catch((failure) => { unavailable = failure.message; }); sync.start(); throw error; }
    finally { configuring = false; }
  }
  function status() {
    const snapshot = store.snapshot();
    const bytes = database.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM resource_assets').get().bytes;
    let freeBytes = null;
    try { const stat = fs.statfsSync(settings.root); freeBytes = stat.bavail * stat.bsize; } catch { /* 资源盘失联不关闭授权数据库。 */ }
    return { ...sync.plan(), periodMs: WEEK_MS, version: snapshot.version, count: snapshot.items.length,
      settings: { root: settings.root, quotaBytes: settings.quotaBytes, networkMode: settings.networkMode, proxyRules: settings.proxyRules },
      bytes, freeBytes, unavailable, history: store.history(), audits: store.audits(),
      repositories: database.prepare('SELECT request_id AS requestId, locator_json AS locatorJson, status FROM resource_repository_requests ORDER BY created_at DESC').all() };
  }
  async function repositoryDecision({ requestId, approve }) {
    const row = database.prepare('SELECT * FROM resource_repository_requests WHERE request_id = ?').get(requestId);
    if (!row) throw new Error('资源获取申请不存在');
    if (!approve) { database.prepare("UPDATE resource_repository_requests SET status = 'rejected' WHERE request_id = ?").run(requestId); store.audit(null, 'REPOSITORY_REJECTED', { requestId }); return status(); }
    const locator = JSON.parse(row.locator_json), sourceId = `skill-repository-${requestId}`;
    const source = { sourceId, name: locator.repo, type: 'skill', repo: locator.repo, branch: locator.ref, root: locator.root,
      license: '保留仓库原许可，安装时审阅', hosts: ['api.github.com', 'raw.githubusercontent.com', 'codeload.github.com', 'github.com'] };
    database.prepare('INSERT OR IGNORE INTO resource_sources(source_id, config_json) VALUES (?, ?)').run(sourceId, JSON.stringify(source));
    database.prepare("UPDATE resource_repository_requests SET status = 'downloading' WHERE request_id = ?").run(requestId);
    try {
      await sync.enable(sourceId, true);
      const items = store.snapshot().items.filter((item) => item.sourceId === sourceId);
      if (!items.length || items.some((item) => !item.assets.some((asset) => asset.role === 'package'))) throw new Error('技能候选尚未就绪，请检查来源错误后重试');
      database.prepare("UPDATE resource_repository_requests SET status = 'ready', result_json = ? WHERE request_id = ?").run(JSON.stringify({ sourceId, resourceIds: items.map((item) => item.resourceId), commit: items[0].sourceRevision }), requestId);
      store.audit(sourceId, 'REPOSITORY_APPROVED', { requestId });
    } catch (error) { database.prepare("UPDATE resource_repository_requests SET status = 'failed', result_json = ? WHERE request_id = ?").run(JSON.stringify({ error: error.message }), requestId); throw error; }
    return status();
  }
  return { store, sync, status, configure, repositoryDecision,
    inspectDirectory: (directory) => { if (!preparePreview?.inspectDirectory) throw new Error('固定系统卷检查组件未准备'); return preparePreview.inspectDirectory(directory); },
    async cleanup({ confirmed }) {
      if (!confirmed || configuring || store.listSources().some((source) => source.running)) throw new Error('须明确确认并等待同步、迁移结束');
      configuring = true; await sync.stop(); let releasedBytes = 0;
      try {
        const base = fs.realpathSync(settings.root);
        const remove = (file) => { const target = fs.realpathSync(file); if (!target.startsWith(`${base}${path.sep}`)) throw new Error('暂存路径归属不符'); const entry = fs.lstatSync(file); if (entry.isSymbolicLink()) throw new Error('暂存含链接，停止清理'); if (entry.isDirectory()) { for (const name of fs.readdirSync(file)) remove(path.join(file, name)); fs.rmdirSync(file); } else { releasedBytes += entry.size; fs.unlinkSync(file); } };
        for (const name of fs.readdirSync(base)) if (/^[a-f0-9]{64}\.part(?:\.json)?$/.test(name)) remove(path.join(base, name));
        const preview = path.join(base, '.preview-candidates'); if (fs.existsSync(preview)) for (const name of fs.readdirSync(preview)) if (/^[a-f0-9-]{36}$/.test(name)) remove(path.join(preview, name));
        store.audit(null, 'TEMP_CLEANED', { releasedBytes, retainedMirrorsAndVersions: true }); return { releasedBytes };
      } finally { configuring = false; sync.start(); }
    },
    start: async () => {
      try { await prepare(settings); sync.start(); }
      catch (error) { unavailable = `资源中心不可用：${error.message}`; store.audit(null, 'UNAVAILABLE', { message: unavailable }); }
    }, stop: sync.stop,
    route: (...args) => router(...args) };
}

module.exports = { createResourceCenterService };
