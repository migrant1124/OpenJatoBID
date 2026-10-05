const crypto = require('node:crypto');

function createResourceCacheSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS resource_client_streams (
    scope_id TEXT PRIMARY KEY, stream_id TEXT NOT NULL, applied_version INTEGER NOT NULL DEFAULT 0,
    shown_version INTEGER NOT NULL DEFAULT 0, initialized INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resource_client_snapshots (
    scope_id TEXT NOT NULL, version INTEGER NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(scope_id, version)
  );
  CREATE TABLE IF NOT EXISTS resource_client_assets (
    asset_id TEXT PRIMARY KEY, hash TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL,
    file_path TEXT NOT NULL, preview_path TEXT, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resource_client_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `);
}

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');

function createResourceCacheStore({ db }) {
  const stream = (scope) => db.prepare('SELECT * FROM resource_client_streams WHERE scope_id = ?').get(scope);
  function snapshot(scope, version) {
    const row = db.prepare('SELECT items_json FROM resource_client_snapshots WHERE scope_id = ? AND version = ?').get(scope, version);
    return row ? JSON.parse(row.items_json) : null;
  }
  function apply({ scope, streamId, version, items, sourceStates = [] }) {
    return db.transaction(() => {
      const current = stream(scope);
      if (current && version < current.applied_version) throw new Error('资源版本倒退，保留已有目录');
      const at = new Date().toISOString();
      db.prepare(`INSERT OR REPLACE INTO resource_client_snapshots(scope_id, version, items_json, created_at) VALUES (?, ?, ?, ?)`).run(scope, version, JSON.stringify(items), at);
      db.prepare(`INSERT INTO resource_client_streams(scope_id, stream_id, applied_version, shown_version, initialized, updated_at)
        VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(scope_id) DO UPDATE SET applied_version = excluded.applied_version, updated_at = excluded.updated_at`)
        .run(scope, streamId, version, current ? current.shown_version : version, at);
      const promptSources = sourceStates.filter((source) => source.type === 'prompts' || items.some((item) => item.sourceId === source.sourceId && item.center === 'prompts'));
      const upsert = db.prepare(`INSERT INTO image_studio_reference_items
        (item_id, source_id, title_zh, title_original, prompt_zh, prompt_original, description, tags_json, author, source_url, cover_url, content_hash, updated_at, translation_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          title_zh = CASE WHEN title_original = excluded.title_original THEN title_zh ELSE excluded.title_zh END,
          prompt_zh = CASE WHEN prompt_original = excluded.prompt_original THEN prompt_zh ELSE excluded.prompt_zh END,
          translation_status = CASE WHEN prompt_original = excluded.prompt_original THEN translation_status ELSE excluded.translation_status END,
          title_original = excluded.title_original, prompt_original = excluded.prompt_original,
          description = excluded.description, tags_json = excluded.tags_json, author = excluded.author,
          source_url = excluded.source_url, cover_url = excluded.cover_url, content_hash = excluded.content_hash, updated_at = excluded.updated_at`);
      for (const source of promptSources) {
        // 现有启停、tombstone和个人收藏不在公共目录应用中重置。
        db.prepare(`INSERT OR IGNORE INTO image_studio_sources(source_id, name, url, built_in, updated_at) VALUES (?, ?, ?, 1, ?)`)
          .run(source.sourceId, source.name, `managed:${source.sourceId}`, at);
        const own = items.filter((item) => item.sourceId === source.sourceId && item.center === 'prompts');
        const ids = new Set(own.map((item) => item.resourceId));
        for (const item of own) {
          const cover = item.assets?.find((asset) => asset.role === 'cover');
          const zh = /[\u3400-\u9fff]/.test(item.prompt);
          upsert.run(item.resourceId, item.sourceId, item.translatedTitle || item.title, item.title,
            item.translatedPrompt || item.prompt, item.prompt, item.description || '', JSON.stringify(item.tags || []), item.author || '',
            item.sourceUrl || '', cover ? `managed-asset:${cover.assetId}` : '', item.contentHash || digest(item.prompt), at, item.translatedPrompt || zh ? 'ready' : 'pending');
        }
        for (const row of db.prepare('SELECT item_id FROM image_studio_reference_items WHERE source_id = ?').all(source.sourceId)) {
          if (!ids.has(row.item_id)) db.prepare('DELETE FROM image_studio_reference_items WHERE item_id = ?').run(row.item_id);
        }
        db.prepare(`UPDATE image_studio_sources SET url = ?, fallback_url = '', item_count = ?, content_version = ?, content_hash = ?,
          content_applied_at = ?, last_success_at = ?, last_error = ? WHERE source_id = ?`)
          .run(`managed:${source.sourceId}`, own.length, String(version), digest(own), at, at, source.error || null, source.sourceId);
      }
      return { initialized: !current, version };
    })();
  }
  function shown(scope, version) {
    const current = stream(scope);
    if (!current || version > current.applied_version || !snapshot(scope, version)) throw new Error('尚未应用的目录不能标为已展示');
    db.prepare('UPDATE resource_client_streams SET shown_version = MAX(shown_version, ?) WHERE scope_id = ?').run(version, scope);
  }
  return { db, stream, snapshot, apply, shown,
    saveAsset: (asset) => db.prepare(`INSERT OR REPLACE INTO resource_client_assets(asset_id, hash, bytes, mime, file_path, preview_path, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(asset.assetId, asset.hash, asset.bytes, asset.mime, asset.filePath, asset.previewPath || null, new Date().toISOString()),
    asset: (id) => db.prepare('SELECT * FROM resource_client_assets WHERE asset_id = ?').get(id) };
}
module.exports = { createResourceCacheSchema, createResourceCacheStore, canonical, digest };
