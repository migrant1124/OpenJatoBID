const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fetch: lanFetch } = require('undici');
const sharp = require('sharp');
const { normalizeLanServerAddress } = require('./lanServerAddress.cjs');
const { canonical, digest } = require('./resourceCacheStore.cjs');
const { registerResourceAsset } = require('./resourceAssets.cjs');

function resourceChanges(before, after) {
  const meaningful = (item) => ({ title: item.title, prompt: item.prompt, description: item.description, author: item.author,
    license: item.license, category: item.category, translatedTitle: item.translatedTitle, translatedPrompt: item.translatedPrompt, tags: [...(item.tags || [])].sort(),
    kind: item.kind, status: item.status, capability: item.capability, aspectRatio: item.aspectRatio, pageCount: item.pageCount,
    assets: item.assets?.map(({ assetId, hash, role, page }) => ({ hash: hash || assetId, role, page })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  const old = new Map(before.map((item) => [item.resourceId, item]));
  const next = new Map(after.map((item) => [item.resourceId, item]));
  const changes = [];
  for (const [id, item] of next) if (!old.has(id) || digest(meaningful(old.get(id))) !== digest(meaningful(item))) {
    changes.push({ ...item, action: old.has(id) ? 'updated' : 'added' });
  }
  for (const [id, item] of old) if (!next.has(id)) changes.push({ ...item, action: 'removed' });
  return changes.filter((item) => ['prompts', 'templates'].includes(item.center));
}

function createResourceClientService({ app, store, licenseService, fetchImpl = lanFetch }) {
  const setting = (key) => { const row = store.db.prepare('SELECT value_json FROM resource_client_settings WHERE key = ?').get(key); return row ? JSON.parse(row.value_json) : null; };
  const saveSetting = (key, value) => store.db.prepare('INSERT OR REPLACE INTO resource_client_settings(key, value_json) VALUES (?, ?)').run(key, JSON.stringify(value));
  let root = setting('cache_root') || path.join(app.getPath('userData'), 'workspace', 'resource-cache');
  if (!setting('cache_root')) fs.mkdirSync(root, { recursive: true });
  let session = null, scope = '', syncJob = null, migrationJob = null, lastError = '', autoShown = false;
  let identityHash = '', lifetime = new AbortController(), closed = false;
  const assets = new Map();
  let downloadActive = 0; const downloadWaiters = [];
  function verify(data, identity) {
    const envelope = data?.envelope;
    if (!envelope || envelope.algorithm !== 'ECDSA_P256_SHA256' || canonical(data.payload) !== canonical(envelope.payload)
      || !crypto.verify('sha256', Buffer.from(canonical(envelope.payload)), identity.publicKey, Buffer.from(envelope.signature || '', 'base64'))) throw new Error('资源清单签名或内容不可信');
    if (data.payload.protocolVersion !== 1) throw new Error('资源协议不兼容');
    return data.payload;
  }
  async function refreshIdentity() {
    if (closed) throw new Error('资源服务已关闭');
    const identity = await licenseService.getResourceIdentity();
    const base = normalizeLanServerAddress(identity.serverAddress).baseUrl;
    const next = digest([base, identity.publicKey, identity.employeeId, identity.deviceCode || identity.deviceFingerprint]);
    if (next !== identityHash) {
      lifetime.abort(); lifetime = new AbortController(); identityHash = next; session = null;
      scope = setting(`selected_stream:${next}`) || ''; autoShown = false;
    }
    return { identity, base, identityHash: next };
  }
  async function connection() {
    const { identity, base, identityHash: requestedIdentity } = await refreshIdentity();
    if (!session || session.identityHash !== requestedIdentity || session.expiresAt < Date.now() + 30000) {
      const response = await fetchImpl(`${base}/api/resource/v1/session`, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ license: identity.license, deviceCode: identity.deviceCode, deviceFingerprint: identity.deviceFingerprint }), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '管理端资源连接不可用');
      const ticket = JSON.parse(Buffer.from(result.data.token, 'base64url').toString('utf8'));
      verify({ envelope: ticket, payload: ticket.payload }, identity);
      if (ticket.payload.purpose !== 'resource-read-v1' || ticket.payload.expiresAt <= Date.now()
        || result.data.streamId !== ticket.payload.streamId || identity.license.payload.licenseId !== ticket.payload.licenseId) throw new Error('资源票据无效');
      if (requestedIdentity !== identityHash || closed) throw new Error('资源身份已改变，旧连接结果已丢弃');
      scope = digest([requestedIdentity, result.data.streamId]);
      saveSetting(`selected_stream:${requestedIdentity}`, scope);
      session = { ...result.data, identityHash: requestedIdentity, identity, base, scope };
    }
    return session;
  }
  async function request(route, options = {}) {
    const current = await connection();
    const response = await fetchImpl(`${current.base}/api/resource/v1${route}`, {
      ...options, redirect: 'error', headers: { authorization: `Bearer ${current.token}`, ...options.headers }, signal: AbortSignal.any([lifetime.signal, options.signal || AbortSignal.timeout(30000)]) });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      if (response.status === 401) session = null;
      throw new Error(result?.error?.message || `管理端资源HTTP ${response.status}`);
    }
    return { response, current };
  }
  function sync() {
    if (closed || migrationJob) return Promise.reject(new Error('资源服务正在迁移或已关闭'));
    if (syncJob) return syncJob;
    syncJob = (async () => {
      const items = []; let offset = 0, total = null, version, streamId, sourceStates = [], appliedScope, appliedIdentity;
      do {
        const { response, current } = await request(`/catalog?protocol=1&offset=${offset}&limit=100${version === undefined ? '' : `&version=${version}`}`);
        const payload = verify((await response.json()).data, current.identity);
        appliedScope ??= current.scope; appliedIdentity ??= current.identityHash;
        if (appliedScope !== current.scope || appliedIdentity !== identityHash || closed) throw new Error('资源流在分页中变化，旧目录保留');
        if (payload.streamId !== current.streamId || (version !== undefined && version !== payload.version)
          || payload.offset !== offset || !Array.isArray(payload.items) || payload.total > 100000 || (total !== null && total !== payload.total)) throw new Error('资源分页版本或范围不一致，旧目录保留');
        version = payload.version; total = payload.total; streamId = payload.streamId; sourceStates = payload.sourceStates;
        if (offset < total && !payload.items.length) throw new Error('资源目录缺页');
        items.push(...payload.items); offset += payload.items.length;
      } while (offset < total);
      if (new Set(items.map((item) => item.resourceId)).size !== items.length) throw new Error('资源清单存在重复ID');
      await refreshIdentity();
      if (appliedScope !== scope || appliedIdentity !== identityHash || closed) throw new Error('资源身份已改变，旧目录保留');
      const result = store.apply({ scope: appliedScope, streamId, version, items, sourceStates });
      lastError = ''; return { ...result, digest: await getDigest(), count: items.length };
    })().catch((error) => { lastError = error.message; throw error; }).finally(() => { syncJob = null; });
    return syncJob;
  }
  function currentSnapshot() {
    const cursor = scope ? store.stream(scope) : null;
    return cursor ? store.snapshot(scope, cursor.applied_version) || [] : [];
  }
  async function getDigest(input = {}) {
    await refreshIdentity();
    const cursor = scope ? store.stream(scope) : null;
    if (!cursor) return { scope, version: 0, changes: [], initialized: false, lastError, autoEligible: false };
    const from = input.fromVersion ?? cursor.shown_version, version = input.version ?? cursor.applied_version;
    const old = store.snapshot(scope, from), next = store.snapshot(scope, version);
    const comparable = Boolean(old && next);
    const changes = comparable ? resourceChanges(old, next) : [];
    return { scope, version, from, changes, comparable, initialized: true, lastError,
      autoEligible: !autoShown && cursor.shown_version < cursor.applied_version && (changes.length > 0 || !comparable) };
  }
  async function markShown(input) {
    await refreshIdentity();
    if (input.scope !== scope) throw new Error('管理端资源流已改变');
    store.shown(scope, input.version); autoShown = true;
    return getDigest();
  }
  async function loadAsset({ assetId, resourceId, version, retry = false }) {
    if (migrationJob) throw new Error('资源缓存正在迁移，请稍后重试');
    await refreshIdentity();
    const assetScope = scope, assetIdentity = identityHash;
    const cursor = store.stream(scope);
    const item = (store.snapshot(scope, version ?? cursor?.applied_version) || []).find((item) => item.resourceId === resourceId);
    const description = item?.assets?.find((asset) => asset.assetId === assetId);
    if (!description) throw new Error('资源尚未准备或不在当前目录');
    const cached = store.asset(assetId);
    if (!retry && cached && fs.existsSync(cached.file_path) && digest(await fs.promises.readFile(cached.file_path)) === cached.hash) {
      await refreshIdentity();
      if (scope !== assetScope || identityHash !== assetIdentity) throw new Error('资源身份已改变，旧缓存结果已丢弃');
      if (!description.mime.startsWith('image/')) return { filePath: cached.file_path, assetId, hash: cached.hash };
      if (cached.preview_path && fs.existsSync(cached.preview_path)) { await sharp(cached.preview_path).metadata(); await refreshIdentity(); if (scope !== assetScope || identityHash !== assetIdentity) throw new Error('资源身份已改变，旧预览结果已丢弃'); return { assetUrl: registerResourceAsset(assetId, cached.preview_path), filePath: cached.file_path, assetId }; }
    }
    const key = `${scope}:${assetId}`;
    if (assets.has(key)) return assets.get(key);
    const job = (async () => {
      if (downloadActive >= 4) await new Promise((resolve) => downloadWaiters.push(resolve)); else downloadActive += 1;
      try {
        const target = path.join(root, assetId), part = `${target}.part`;
        const existing = fs.existsSync(part) ? fs.statSync(part).size : 0;
        const applied = store.stream(assetScope).applied_version;
        const { response, current } = await request(`/assets/${assetId}?version=${version ?? applied}`, { headers: existing && existing < description.bytes
          ? { Range: `bytes=${existing}-`, 'If-Range': `"${description.hash}"` } : {}, signal: AbortSignal.timeout(300000) });
        if (current.scope !== assetScope || current.identityHash !== assetIdentity) { await response.body?.cancel(); throw new Error('资源身份已改变，未使用旧下载'); }
        if (description.bytes > 256 * 1024 ** 2 || fs.statfsSync(root).bavail * fs.statfsSync(root).bsize < description.bytes + 64 * 1024 ** 2) throw new Error('资源大小超限或本地空间不足');
        const append = response.status === 206;
        if (append && (!existing || response.headers.get('content-range') !== `bytes ${existing}-${description.bytes - 1}/${description.bytes}`)) throw new Error('管理端下载范围不一致');
        const handle = await fs.promises.open(part, append ? 'a' : 'w'); let bytes = append ? existing : 0;
        try {
          for await (const chunk of response.body) { bytes += chunk.length; if (bytes > description.bytes) throw new Error('管理端资源长度超限'); await handle.writeFile(chunk); }
          await handle.sync();
        } finally { await handle.close(); }
        if (bytes !== description.bytes || digest(await fs.promises.readFile(part)) !== description.hash) { await fs.promises.unlink(part); throw new Error('管理端资源长度或hash校验失败'); }
        let previewPath = null;
        if (description.mime.startsWith('image/')) {
          previewPath = `${target}.png`; await sharp(part, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toFile(previewPath);
        }
        if (closed || scope !== assetScope) throw new Error('资源身份已改变或服务已关闭，下载候选保留');
        await fs.promises.rename(part, target);
        if (closed || scope !== assetScope || identityHash !== assetIdentity) throw new Error('资源身份已改变或服务已关闭，未应用下载');
        store.saveAsset({ assetId, hash: description.hash, bytes, mime: description.mime, filePath: target, previewPath });
        return { assetId, filePath: target, assetUrl: previewPath ? registerResourceAsset(assetId, previewPath) : undefined };
      } finally { const next = downloadWaiters.shift(); if (next) next(); else downloadActive -= 1; }
    })();
    assets.set(key, job);
    try { return await job; } finally { assets.delete(key); }
  }
  async function loadCover(input) {
    await refreshIdentity();
    const id = typeof input === 'string' ? input : input.itemId;
    const requested = typeof input === 'string' ? '' : String(input.coverUrl || '').replace(/^managed-asset:/, '');
    const item = currentSnapshot().find((item) => item.resourceId === id || (requested && item.assets?.some((asset) => asset.assetId === requested)));
    const cover = item?.assets?.find((asset) => asset.role === 'cover' || asset.assetId === requested);
    if (!cover) throw new Error('该参考图尚未在管理端准备；已有本地缓存可离线使用');
    return loadAsset({ resourceId: item.resourceId, assetId: cover.assetId, retry: input.retry });
  }
  return { sync, getDigest, markShown, loadAsset, loadCover, getItem: async (id) => { await refreshIdentity(); return currentSnapshot().find((item) => item.resourceId === id); },
    promptIds: async () => { await refreshIdentity(); return currentSnapshot().filter((item) => item.center === 'prompts').map((item) => item.resourceId); },
    list: async ({ center, query = '', kind = '', aspectRatio = '', ids, offset = 0, limit = 40 } = {}) => {
      await refreshIdentity();
      const items = currentSnapshot().filter((item) => (!center || item.center === center) && (!kind || item.kind === kind)
        && (!ids?.length || ids.includes(item.resourceId))
        && (!aspectRatio || item.aspectRatio === aspectRatio || Math.abs(Number(item.aspectRatio) - (aspectRatio === '4:3' ? 4 / 3 : 16 / 9)) < .02)
        && (!query || `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase())));
      return { items: items.slice(offset, offset + Math.min(100, limit)), total: items.length, version: scope ? store.stream(scope)?.applied_version || 0 : 0, lastError };
    },
    history: async () => { await refreshIdentity(); return store.db.prepare('SELECT version, created_at AS createdAt FROM resource_client_snapshots WHERE scope_id = ? ORDER BY version DESC LIMIT 50').all(scope).map((row) => { const previous = store.snapshot(scope,row.version-1), changes = previous && resourceChanges(previous,store.snapshot(scope,row.version)); return {...row, summary: changes ? `新增${changes.filter((item) => item.action === 'added').length}项 · 更新${changes.filter((item) => item.action === 'updated').length}项 · 下架${changes.filter((item) => item.action === 'removed').length}项` : '历史不足，已应用资源目录'}; }); },
    legacySources: () => store.db.prepare("SELECT key, value_json AS configJson FROM resource_client_settings WHERE key LIKE 'legacy_source_config:%'").all(),
    cacheStatus: () => ({ root, bytes: store.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM resource_client_assets').get().bytes }),
    async clearCache({ resourceId, confirmed }) {
      if (!confirmed || closed || migrationJob || syncJob || assets.size) throw new Error('清理本地缓存须确认并等待任务结束');
      await refreshIdentity();
      if (closed || migrationJob || syncJob || assets.size) throw new Error('缓存任务已开始，请结束后重试清理');
      const item = resourceId ? currentSnapshot().find((value) => value.resourceId === resourceId) : null;
      if (resourceId && !item) throw new Error('资源不在当前可见目录');
      const ids = item ? new Set(item.assets.map((asset) => asset.assetId)) : null; let releasedBytes = 0;
      for (const asset of store.db.prepare('SELECT * FROM resource_client_assets').all()) {
        if (ids && !ids.has(asset.asset_id)) continue;
        const files = [asset.file_path, asset.preview_path].filter(Boolean);
        for (const file of files) if (fs.existsSync(file)) { const target = fs.realpathSync(file); if (path.dirname(target) !== fs.realpathSync(root)) throw new Error('缓存路径归属不符，停止清理'); releasedBytes += fs.statSync(target).size; fs.unlinkSync(target); }
        store.db.prepare('DELETE FROM resource_client_assets WHERE asset_id=?').run(asset.asset_id);
      }
      if (!resourceId) for (const name of fs.readdirSync(root).filter((name) => /^[a-f0-9]{64}(?:\.part|\.png)?$/.test(name))) {
        const file = path.join(root, name), target = fs.realpathSync(file);
        if (path.dirname(target) !== fs.realpathSync(root) || fs.lstatSync(file).isSymbolicLink()) throw new Error('暂存路径归属不符，停止清理');
        releasedBytes += fs.statSync(target).size; fs.unlinkSync(target);
      }
      return { releasedBytes, root, retainedOldFiles: true };
    },
    async configureCache({ parent }) {
      if (closed || migrationJob || syncJob || assets.size) throw new Error('请先等待资源同步、下载和迁移结束');
      migrationJob = (async () => {
      const target = path.join(fs.realpathSync(parent), `Jato-Resource-Cache-${crypto.randomUUID()}`); fs.mkdirSync(target);
      const copies = [];
      for (const asset of store.db.prepare('SELECT * FROM resource_client_assets').all()) {
        const filePath = path.join(target, asset.asset_id); await fs.promises.copyFile(asset.file_path, filePath);
        if (digest(await fs.promises.readFile(filePath)) !== asset.hash) throw new Error('缓存迁移校验失败，原路径保留');
        const previewPath = asset.preview_path ? `${filePath}.png` : null;
        if (previewPath) { await fs.promises.copyFile(asset.preview_path, previewPath); await sharp(previewPath).metadata(); }
        copies.push({ ...asset, filePath, previewPath });
      }
      if (closed) throw new Error('资源服务已关闭，原缓存路径保留');
      store.db.transaction(() => { for (const value of copies) store.saveAsset({ assetId: value.asset_id, hash: value.hash, bytes: value.bytes, mime: value.mime, filePath: value.filePath, previewPath: value.previewPath }); saveSetting('cache_root', target); })();
      root = target; return { root, retainedOldFiles: true };
      })();
      try { return await migrationJob; } finally { migrationJob = null; }
    },
    async close() { closed = true; lifetime.abort(); await Promise.allSettled([syncJob, migrationJob, ...assets.values()].filter(Boolean)); },
    repositoryRequest: async (input) => { const { response } = await request('/repository-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); return (await response.json()).data; },
    repositoryStatus: async (id) => { const { response } = await request(`/repository-requests/${encodeURIComponent(id)}`); return (await response.json()).data; },
  };
}
module.exports = { createResourceClientService, resourceChanges };
