const crypto = require('node:crypto');
const { serializeLicensePayload } = require('./signingService.cjs');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const hash = (value) => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : serializeLicensePayload(value)).digest('hex');

function businessContent(item) {
  const { resourceId, sourceId, upstreamId, center, kind, title, prompt, description, author, tags,
    category, aspectRatio, pageCount, assets, capability, status, license, translatedTitle, translatedPrompt } = item;
  return { resourceId, sourceId, upstreamId, center, kind, title: title || '', prompt: prompt || '',
    description: description || '', author: author || '', tags: [...(tags || [])].sort(), category: category || '',
    aspectRatio: aspectRatio || null, pageCount: pageCount ?? null,
    assets: (assets || []).map(({ assetId, hash: digest, role, page, generatorVersion }) => ({ assetId, hash: digest, role, page, generatorVersion })),
    capability: capability || 'pending', status: status || 'pending', license: license || '',
    translatedTitle: translatedTitle || '', translatedPrompt: translatedPrompt || '' };
}

function changesBetween(before, after) {
  const a = new Map(before.map((item) => [item.resourceId, item]));
  const b = new Map(after.map((item) => [item.resourceId, item]));
  const changes = [];
  for (const [id, item] of b) {
    const previous = a.get(id);
    if (!previous || hash(businessContent(previous)) !== hash(businessContent(item))) {
      changes.push({ resourceId: id, center: item.center, kind: item.kind, action: previous ? 'updated' : 'added',
        title: item.title, status: item.status, capability: item.capability, assets: item.assets || [], tags: item.tags || [] });
    }
  }
  for (const [id, item] of a) if (!b.has(id)) changes.push({ resourceId: id, center: item.center, kind: item.kind, action: 'removed', title: item.title });
  return changes.sort((a, b) => a.resourceId.localeCompare(b.resourceId));
}

function createResourceStore({ database, sources = [], now = Date.now }) {
  for (const source of sources) database.prepare('INSERT INTO resource_sources(source_id, config_json) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET config_json = excluded.config_json').run(source.sourceId, JSON.stringify(source));
  database.prepare('UPDATE resource_sources SET running = 0 WHERE running = 1').run();
  const getSource = (id) => {
    const row = database.prepare('SELECT * FROM resource_sources WHERE source_id = ?').get(id);
    return row ? { ...JSON.parse(row.config_json), enabled: Boolean(row.enabled), anchorAt: row.anchor_at,
      nextDueAt: row.next_due_at, checkedAt: row.checked_at, successAt: row.success_at,
      etag: row.etag, error: row.error, running: Boolean(row.running) } : null;
  };
  const listSources = () => database.prepare('SELECT source_id FROM resource_sources ORDER BY source_id').all().map((row) => getSource(row.source_id));
  function setEnabled(id, enabled) {
    if (!getSource(id)) throw new Error('资源来源不存在');
    database.prepare(`UPDATE resource_sources SET enabled = ?, anchor_at = COALESCE(anchor_at, ?),
      next_due_at = COALESCE(next_due_at, ?) WHERE source_id = ?`).run(Number(Boolean(enabled)), now(), now(), id);
    return getSource(id);
  }
  function claim(id, scheduled) {
    const at = now();
    const source = getSource(id);
    if (!source?.enabled || source.running || (scheduled && source.nextDueAt > at)) return false;
    // 自动观察只消费一个到期槽；手动操作不更新持久化周锚点。
    const nextDue = scheduled ? source.anchorAt + (Math.floor(Math.max(0, at - source.anchorAt) / WEEK_MS) + 1) * WEEK_MS : source.nextDueAt;
    return Boolean(database.prepare('UPDATE resource_sources SET running = 1, next_due_at = ? WHERE source_id = ? AND running = 0').run(nextDue, id).changes);
  }
  function finish(id, { error = null, etag = null } = {}) {
    database.prepare(`UPDATE resource_sources SET running = 0, checked_at = ?, error = ?,
      success_at = CASE WHEN ? IS NULL THEN ? ELSE success_at END,
      etag = COALESCE(?, etag) WHERE source_id = ?`).run(now(), error, error, now(), etag, id);
  }
  function audit(id, status, detail = {}) {
    database.prepare('INSERT INTO resource_audit(source_id, occurred_at, status, detail_json) VALUES (?, ?, ?, ?)').run(id, now(), status, JSON.stringify(detail));
  }
  function snapshot(version) {
    const row = version === undefined ? database.prepare('SELECT * FROM resource_releases ORDER BY version DESC LIMIT 1').get()
      : database.prepare('SELECT * FROM resource_releases WHERE version = ?').get(Number(version));
    return row ? { version: row.version, createdAt: row.created_at, items: JSON.parse(row.snapshot_json), changes: JSON.parse(row.changes_json) }
      : { version: 0, createdAt: null, items: [], changes: [] };
  }
  function publishSource(id, items) {
    return database.transaction(() => {
      const previous = snapshot();
      const own = previous.items.filter((item) => item.sourceId === id);
      if (!items.length || (own.length > 20 && items.length < own.length / 2)) throw new Error('来源异常空清单或骤减，保留旧快照');
      if (new Set(items.map((item) => item.resourceId)).size !== items.length) throw new Error('来源资源ID重复');
      const next = [...previous.items.filter((item) => item.sourceId !== id), ...items].sort((a, b) => a.resourceId.localeCompare(b.resourceId));
      for (const item of items) for (const asset of item.assets || []) if (!database.prepare('SELECT asset_id FROM resource_assets WHERE asset_id = ?').get(asset.assetId)) throw new Error('发布引用文件尚未就绪');
      const changes = changesBetween(previous.items, next);
      if (!changes.length) return previous.version;
      const result = database.prepare('INSERT INTO resource_releases(created_at, snapshot_json, changes_json) VALUES (?, ?, ?)').run(now(), JSON.stringify(next), JSON.stringify(changes));
      audit(id, 'PUBLISHED', { version: Number(result.lastInsertRowid), count: changes.length });
      return Number(result.lastInsertRowid);
    })();
  }
  function saveAsset(asset) {
    database.prepare(`INSERT OR IGNORE INTO resource_assets(asset_id, hash, bytes, mime, relative_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(asset.assetId, asset.hash, asset.bytes, asset.mime, asset.relativePath, now());
  }
  return { database, getSource, listSources, setEnabled, claim, finish, audit, snapshot, publishSource, saveAsset,
    getAsset: (id) => database.prepare('SELECT * FROM resource_assets WHERE asset_id = ?').get(id),
    history: () => database.prepare('SELECT version, created_at AS createdAt, changes_json AS changesJson FROM resource_releases ORDER BY version DESC LIMIT 50').all(),
    audits: () => database.prepare('SELECT source_id AS sourceId, occurred_at AS occurredAt, status, detail_json AS detailJson FROM resource_audit ORDER BY id DESC LIMIT 100').all(),
  };
}

module.exports = { WEEK_MS, hash, businessContent, changesBetween, createResourceStore };
