const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const presets = require('../resources/image-studio-sources.json');
const starterPrompts = require('../resources/image-studio-starter.json');

const registryBase = 'https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/';
const defaultSources = presets.sources.map((source) => ({ ...source, url: `${registryBase}${source.id}.json` }));

function publicAddress(address) {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return net.isIP(ip) === 6 && !(/^(::|::1$|fc|fd|fe[89ab])/.test(ip));
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('来源地址必须是公开 HTTPS JSON 地址。');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) throw new Error('来源地址不能指向本地或内网。');
  return url;
}

async function readSourceJson(rawUrl, fetcher = fetch, urlValidator = assertPublicUrl, etag = '') {
  let url = rawUrl;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    await urlValidator(url);
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: etag ? { 'If-None-Match': etag } : {} });
    if (response.status === 304) return { notModified: true, etag };
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('来源重定向缺少地址。');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error(`来源请求失败（HTTP ${response.status}）。`);
    if (Number(response.headers.get('content-length') || 0) > 12_000_000) throw new Error('来源 JSON 超过 12 MB。');
    const parts = [];
    let bytes = 0;
    for await (const part of response.body) {
      bytes += part.length;
      if (bytes > 12_000_000) throw new Error('来源 JSON 超过 12 MB。');
      parts.push(part);
    }
    const raw = Buffer.concat(parts).toString('utf8');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('来源不是有效 JSON。'); }
    if (!Array.isArray(data) || !data.length) throw new Error('来源 JSON 不含条目，旧快照未改变。');
    return { items: data, etag: response.headers.get('etag') || '' };
  }
  throw new Error('来源重定向过多。');
}

function normalizeItems(sourceId, items) {
  const seen = new Set();
  return items.map((item, index) => {
    const originalId = String(item?.id || index);
    const itemId = `${sourceId}:${originalId}`;
    const prompt = String(item?.prompt || '').trim();
    const title = String(item?.title || '').trim();
    if (!prompt || !title || seen.has(itemId)) throw new Error('来源 JSON 有空条目或重复 ID，旧快照未改变。');
    seen.add(itemId);
    const hasChinese = /[\u3400-\u9fff]/.test(prompt);
    const normalized = {
      itemId, title, prompt, description: String(item.description || ''),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      author: String(item.author || ''), sourceUrl: String(item.sourceUrl || ''),
      coverUrl: String(item.coverUrl || ''), hasChinese,
    };
    return { ...normalized, hash: crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
  });
}

function createImageStudioSources({ db, fetcher = fetch, urlValidator = assertPublicUrl, clock = () => new Date(), translateBatch }) {
  const inflight = new Map();
  const at = () => clock().toISOString();
  for (const preset of defaultSources) {
    db.prepare(`INSERT OR IGNORE INTO image_studio_sources
      (source_id, name, url, homepage, built_in, updated_at) VALUES (?, ?, ?, ?, 1, ?)`)
      .run(preset.id, preset.name, preset.url, preset.homepage, at());
    const row = db.prepare('SELECT overrides_json FROM image_studio_sources WHERE source_id = ?').get(preset.id);
    const overrides = JSON.parse(row.overrides_json || '{}');
    for (const [column, value] of [['name', preset.name], ['url', preset.url], ['homepage', preset.homepage]]) {
      if (!overrides[column]) db.prepare(`UPDATE image_studio_sources SET ${column} = ? WHERE source_id = ?`).run(value, preset.id);
    }
  }
  const starterId = 'openjatobid-starter';
  const starterHash = crypto.createHash('sha256').update(JSON.stringify(starterPrompts)).digest('hex');
  db.prepare(`INSERT OR IGNORE INTO image_studio_sources
    (source_id, name, url, homepage, built_in, item_count, content_hash, content_applied_at, updated_at)
    VALUES (?, '创作起步', 'local:image-studio-starter', '', 0, ?, ?, ?, ?)`).run(starterId,
      starterPrompts.length, starterHash, at(), at());
  const starter = db.prepare('SELECT url, deleted_at FROM image_studio_sources WHERE source_id = ?').get(starterId);
  if (starter && !starter.deleted_at && starter.url === 'local:image-studio-starter') {
    const insert = db.prepare(`INSERT OR IGNORE INTO image_studio_reference_items
      (item_id, source_id, title_zh, title_original, prompt_zh, prompt_original,
       author, content_hash, updated_at, translation_status)
      VALUES (?, ?, ?, ?, ?, ?, 'OpenJatoBID', ?, ?, 'ready')`);
    for (const item of starterPrompts) insert.run(`${starterId}:${item.id}`, starterId,
      item.title, item.title, item.prompt, item.prompt,
      crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'), at());
  }

  const get = (sourceId) => db.prepare('SELECT * FROM image_studio_sources WHERE source_id = ?').get(sourceId);
  function listSources({ includeDeleted = false } = {}) {
    return db.prepare(`SELECT source_id AS sourceId, name, url, homepage, fallback_url AS fallbackUrl,
      built_in AS builtIn, enabled, deleted_at AS deletedAt, config_revision AS configRevision,
      item_count AS itemCount, content_hash AS contentHash, content_version AS contentVersion,
      last_success_at AS lastSuccessAt, last_attempt_at AS lastAttemptAt,
      content_applied_at AS contentAppliedAt, next_retry_at AS nextRetryAt,
      consecutive_failures AS consecutiveFailures, last_error AS lastError
      FROM image_studio_sources ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY built_in DESC, name`).all()
      .map((row) => ({ ...row, builtIn: Boolean(row.builtIn), enabled: Boolean(row.enabled) }));
  }

  function saveSource(input = {}) {
    const sourceId = String(input.sourceId || `custom-${crypto.randomUUID()}`);
    const current = get(sourceId);
    if (current?.deleted_at) throw new Error('已删除来源须先明确恢复。');
    const name = String(input.name ?? current?.name ?? '').trim();
    const url = String(input.url ?? current?.url ?? '').trim();
    if (!name || name.length > 80 || !url) throw new Error('来源名称须为 1–80 字且地址不能为空。');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(sourceId === starterId && url === 'local:image-studio-starter')) {
      throw new Error('来源地址必须使用 HTTPS。');
    }
    const homepage = String(input.homepage ?? current?.homepage ?? '').trim();
    const fallbackUrl = String(input.fallbackUrl ?? current?.fallback_url ?? '').trim();
    if (fallbackUrl && new URL(fallbackUrl).protocol !== 'https:') throw new Error('备用地址必须使用 HTTPS。');
    const enabled = input.enabled === undefined ? (current?.enabled ?? 1) : Number(Boolean(input.enabled));
    const overrides = current ? JSON.parse(current.overrides_json || '{}') : {};
    if (current?.built_in) {
      for (const field of ['name', 'url', 'homepage', 'fallbackUrl', 'enabled']) {
        if (input[field] !== undefined) overrides[field === 'fallbackUrl' ? 'fallback_url' : field] = true;
      }
    }
    db.prepare(`INSERT INTO image_studio_sources
      (source_id, name, url, homepage, fallback_url, built_in, enabled, overrides_json, config_revision, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
      ON CONFLICT(source_id) DO UPDATE SET name = excluded.name, url = excluded.url,
      homepage = excluded.homepage, fallback_url = excluded.fallback_url, enabled = excluded.enabled,
      last_success_at = CASE WHEN url != excluded.url OR fallback_url != excluded.fallback_url THEN NULL ELSE last_success_at END,
      content_version = CASE WHEN url != excluded.url OR fallback_url != excluded.fallback_url THEN NULL ELSE content_version END,
      next_retry_at = CASE WHEN url != excluded.url OR fallback_url != excluded.fallback_url THEN NULL ELSE next_retry_at END,
      consecutive_failures = CASE WHEN url != excluded.url OR fallback_url != excluded.fallback_url THEN 0 ELSE consecutive_failures END,
      last_error = CASE WHEN url != excluded.url OR fallback_url != excluded.fallback_url THEN NULL ELSE last_error END,
      overrides_json = excluded.overrides_json, config_revision = config_revision + 1, updated_at = excluded.updated_at`)
      .run(sourceId, name, url, homepage, fallbackUrl, enabled, JSON.stringify(overrides), at());
    return listSources().find((item) => item.sourceId === sourceId);
  }

  function deleteSource(sourceId) {
    if (!get(sourceId)) throw new Error('来源不存在。');
    db.prepare('UPDATE image_studio_sources SET deleted_at = ?, config_revision = config_revision + 1 WHERE source_id = ?')
      .run(at(), sourceId);
    return listSources();
  }

  function restoreSource(sourceId) {
    const row = get(sourceId);
    if (!row?.built_in || !row.deleted_at) throw new Error('只能恢复已删除的内置来源。');
    db.prepare('UPDATE image_studio_sources SET deleted_at = NULL, config_revision = config_revision + 1 WHERE source_id = ?')
      .run(sourceId);
    return listSources();
  }

  function listItems({ sourceId = '', query = '', limit = 50, offset = 0 } = {}) {
    const clauses = ['s.enabled = 1', 's.deleted_at IS NULL'];
    const args = [];
    if (sourceId) { clauses.push('i.source_id = ?'); args.push(sourceId); }
    if (query) { clauses.push('(i.title_zh LIKE ? OR i.prompt_zh LIKE ?)'); args.push(`%${query}%`, `%${query}%`); }
    const where = clauses.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS total FROM image_studio_reference_items i
      JOIN image_studio_sources s ON s.source_id = i.source_id WHERE ${where}`).get(...args).total;
    const items = db.prepare(`SELECT i.item_id AS itemId, i.source_id AS sourceId, i.title_zh AS title,
      i.prompt_zh AS prompt, i.description, i.tags_json AS tagsJson, i.author,
      i.source_url AS sourceUrl, i.cover_url AS coverUrl, i.translation_status AS translationStatus,
      p.prompt_id AS myPromptId, COALESCE(p.is_favorite, 0) AS isFavorite
      FROM image_studio_reference_items i JOIN image_studio_sources s ON s.source_id = i.source_id
      LEFT JOIN image_studio_reference_favorites f ON f.source_id = i.source_id AND f.item_id = i.item_id
      LEFT JOIN prompt_items p ON p.prompt_id = f.prompt_id AND p.deleted_at IS NULL
      WHERE ${where} ORDER BY i.item_id LIMIT ? OFFSET ?`)
      .all(...args, Math.min(100, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0))
      .map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite), myPromptId: row.myPromptId || null,
        tags: JSON.parse(row.tagsJson) }));
    return { items, total };
  }

  async function load(sourceId, { checkOnly = false, confirmedReplace = false } = {}) {
    const source = get(sourceId);
    if (!source || source.deleted_at) throw new Error('来源不存在或已删除。');
    if (source.url === 'local:image-studio-starter') return { count: source.item_count, unchanged: true, local: true };
    if (!checkOnly) db.prepare('UPDATE image_studio_sources SET last_attempt_at = ? WHERE source_id = ?').run(at(), sourceId);
    let payload;
    let fallback = false;
    try { payload = await readSourceJson(source.url, fetcher, urlValidator, source.content_version || ''); }
    catch (error) {
      if (!source.fallback_url) throw error;
      payload = await readSourceJson(source.fallback_url, fetcher, urlValidator);
      fallback = true;
    }
    const current = get(sourceId);
    if (!current || current.deleted_at || current.config_revision !== source.config_revision || current.url !== source.url) {
      throw new Error('来源设置已变化，旧请求结果已丢弃。');
    }
    if (payload.notModified) {
      if (!source.content_hash) throw new Error('来源返回 304，但本地没有可复用内容。');
      if (!checkOnly) db.prepare(`UPDATE image_studio_sources SET last_success_at = ?, next_retry_at = NULL,
        consecutive_failures = 0, last_error = NULL WHERE source_id = ?`).run(at(), sourceId);
      return { count: source.item_count, hash: source.content_hash, unchanged: true };
    }
    const normalized = normalizeItems(sourceId, payload.items);
    const hash = crypto.createHash('sha256').update(JSON.stringify(normalized.map(({ hash: _hash, ...item }) => item))).digest('hex');
    if (checkOnly) return { count: normalized.length, hash, revision: source.config_revision };
    if (source.item_count && normalized.length < Math.ceil(source.item_count / 2)) throw new Error('新数据条目异常骤减，旧快照未改变。');
    if (fallback && source.content_hash && source.content_hash !== hash && !confirmedReplace) {
      throw new Error('备用版本待核对，旧快照未改变。');
    }
    if (source.content_hash === hash) {
      db.prepare(`UPDATE image_studio_sources SET last_success_at = ?, content_version = ?, next_retry_at = NULL,
        consecutive_failures = 0, last_error = NULL WHERE source_id = ?`).run(at(), payload.etag, sourceId);
      return { count: source.item_count, unchanged: true };
    }
    db.exec('BEGIN');
    try {
      const latest = get(sourceId);
      if (!latest || latest.deleted_at || latest.config_revision !== source.config_revision) throw new Error('来源设置已变化，旧请求结果已丢弃。');
      const existing = new Map(db.prepare('SELECT item_id, content_hash FROM image_studio_reference_items WHERE source_id = ?')
        .all(sourceId).map((item) => [item.item_id, item.content_hash]));
      const insert = db.prepare(`INSERT INTO image_studio_reference_items
        (item_id, source_id, title_zh, title_original, prompt_zh, prompt_original,
         description, tags_json, author, source_url, cover_url, content_hash, updated_at, translation_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET title_zh = excluded.title_zh, title_original = excluded.title_original,
        prompt_zh = excluded.prompt_zh, prompt_original = excluded.prompt_original,
        description = excluded.description, tags_json = excluded.tags_json, author = excluded.author,
        source_url = excluded.source_url, cover_url = excluded.cover_url, content_hash = excluded.content_hash,
        updated_at = excluded.updated_at, translation_status = excluded.translation_status`);
      for (const item of normalized) {
        if (existing.get(item.itemId) === item.hash) continue;
        insert.run(item.itemId, sourceId, item.title, item.title,
          item.prompt, item.prompt, item.description, JSON.stringify(item.tags), item.author,
          item.sourceUrl, item.coverUrl, item.hash, at(), item.hasChinese ? 'ready' : 'pending');
      }
      const currentIds = new Set(normalized.map((item) => item.itemId));
      for (const itemId of existing.keys()) {
        if (!currentIds.has(itemId)) db.prepare('DELETE FROM image_studio_reference_items WHERE item_id = ?').run(itemId);
      }
      db.prepare(`UPDATE image_studio_sources SET content_hash = ?, content_version = ?, item_count = ?, last_success_at = ?,
        content_applied_at = ?, next_retry_at = NULL, consecutive_failures = 0,
        last_error = NULL, updated_at = ? WHERE source_id = ?`).run(hash, payload.etag, normalized.length, at(), at(), at(), sourceId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { count: normalized.length, untranslated: normalized.filter((item) => !item.hasChinese).length };
  }

  function refreshSource(sourceId, options) {
    if (inflight.has(sourceId)) return inflight.get(sourceId);
    const revision = get(sourceId)?.config_revision;
    const pending = load(sourceId, options).catch((error) => {
      const source = get(sourceId);
      if (source && !source.deleted_at && source.config_revision === revision) {
        const failures = (source.consecutive_failures || 0) + 1;
        const hours = [1, 6, 24][Math.min(failures - 1, 2)];
        db.prepare(`UPDATE image_studio_sources SET consecutive_failures = ?, next_retry_at = ?, last_error = ?
          WHERE source_id = ?`).run(failures, new Date(clock().getTime() + hours * 3600000).toISOString(), String(error.message), sourceId);
      }
      throw error;
    }).finally(() => inflight.delete(sourceId));
    inflight.set(sourceId, pending);
    return pending;
  }

  async function translatePending(sourceId) {
    if (!translateBatch) return 0;
    const rows = db.prepare(`SELECT item_id AS itemId, title_original AS title, prompt_original AS prompt,
      content_hash AS hash FROM image_studio_reference_items WHERE source_id = ? AND translation_status = 'pending' LIMIT 8`).all(sourceId);
    if (!rows.length) return 0;
    const translated = await translateBatch(rows);
    const save = db.prepare(`UPDATE image_studio_reference_items SET title_zh = ?, prompt_zh = ?,
      translation_status = 'ready' WHERE item_id = ? AND content_hash = ?`);
    for (const item of translated) {
      if (item.title && item.prompt) save.run(item.title, item.prompt, item.itemId, rows.find((row) => row.itemId === item.itemId)?.hash);
    }
    return translated.length;
  }

  async function runDue() {
    const now = clock().getTime();
    const updatedSourceIds = [];
    const due = listSources().filter((source) => source.builtIn && source.enabled &&
      (!source.lastSuccessAt || now - Date.parse(source.lastSuccessAt) >= 7 * 86400000) &&
      (!source.nextRetryAt || now >= Date.parse(source.nextRetryAt)));
    for (const source of due) {
      try { if (!(await refreshSource(source.sourceId)).unchanged) updatedSourceIds.push(source.sourceId); }
      catch { /* Per-source status is persisted. */ }
    }
    const pending = db.prepare(`SELECT i.source_id AS sourceId FROM image_studio_reference_items i
      JOIN image_studio_sources s ON s.source_id = i.source_id
      WHERE i.translation_status = 'pending' AND s.built_in = 1 AND s.enabled = 1 AND s.deleted_at IS NULL
      GROUP BY i.source_id ORDER BY MIN(i.updated_at) LIMIT 1`).get();
    if (pending) try { if (await translatePending(pending.sourceId)) updatedSourceIds.push(pending.sourceId); }
    catch { /* Keep originals for the next pass. */ }
    return { checked: due.length > 0 || Boolean(pending), updatedSourceIds };
  }

  async function checkSourceUrl(url) {
    const payload = await readSourceJson(url, fetcher, urlValidator);
    return { count: normalizeItems('candidate', payload.items).length };
  }

  return { listSources, saveSource, deleteSource, restoreSource, listItems, runDue, translatePending,
    checkSource: (sourceId) => load(sourceId, { checkOnly: true }), checkSourceUrl, refreshSource };
}

module.exports = { createImageStudioSources, publicAddress, normalizeItems, readSourceJson, assertPublicUrl };
