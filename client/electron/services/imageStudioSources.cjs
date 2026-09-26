const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const presets = require('../resources/image-studio-sources.json');

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

async function readSourceJson(rawUrl, fetcher = fetch, urlValidator = assertPublicUrl) {
  let url = rawUrl;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    await urlValidator(url);
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
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
    return data;
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

function createImageStudioSources({ db, fetcher = fetch, urlValidator = assertPublicUrl }) {
  const inflight = new Map();
  const at = () => new Date().toISOString();
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

  const get = (sourceId) => db.prepare('SELECT * FROM image_studio_sources WHERE source_id = ?').get(sourceId);
  function listSources({ includeDeleted = false } = {}) {
    return db.prepare(`SELECT source_id AS sourceId, name, url, homepage, fallback_url AS fallbackUrl,
      built_in AS builtIn, enabled, deleted_at AS deletedAt, config_revision AS configRevision,
      item_count AS itemCount, content_hash AS contentHash, content_version AS contentVersion,
      last_success_at AS lastSuccessAt, last_error AS lastError
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
    if (parsed.protocol !== 'https:') throw new Error('来源地址必须使用 HTTPS。');
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
    return db.prepare(`SELECT i.item_id AS itemId, i.source_id AS sourceId, i.title_zh AS title,
      i.prompt_zh AS prompt, i.description, i.tags_json AS tagsJson, i.author,
      i.source_url AS sourceUrl, i.cover_url AS coverUrl
      FROM image_studio_reference_items i JOIN image_studio_sources s ON s.source_id = i.source_id
      WHERE ${clauses.join(' AND ')} ORDER BY i.item_id LIMIT ? OFFSET ?`)
      .all(...args, Math.min(100, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0))
      .map((row) => ({ ...row, tags: JSON.parse(row.tagsJson) }));
  }

  async function load(sourceId, { checkOnly = false, confirmedReplace = false } = {}) {
    const source = get(sourceId);
    if (!source || source.deleted_at) throw new Error('来源不存在或已删除。');
    let payload;
    try { payload = await readSourceJson(source.url, fetcher, urlValidator); }
    catch (error) {
      if (!source.fallback_url) throw error;
      payload = await readSourceJson(source.fallback_url, fetcher, urlValidator);
    }
    const normalized = normalizeItems(sourceId, payload);
    const hash = crypto.createHash('sha256').update(JSON.stringify(normalized.map(({ hash: _hash, ...item }) => item))).digest('hex');
    const current = get(sourceId);
    if (!current || current.deleted_at || current.config_revision !== source.config_revision || current.url !== source.url) {
      throw new Error('来源设置已变化，旧请求结果已丢弃。');
    }
    if (checkOnly) return { count: normalized.length, hash, revision: source.config_revision };
    if (source.item_count && normalized.length < Math.ceil(source.item_count / 2)) throw new Error('新数据条目异常骤减，旧快照未改变。');
    if (source.content_hash && source.content_hash !== hash && !confirmedReplace) {
      throw new Error('来源版本无可比较顺序，请明确确认替换旧快照。');
    }
    if (source.content_hash === hash) return { count: source.item_count, unchanged: true };
    db.exec('BEGIN');
    try {
      const latest = get(sourceId);
      if (!latest || latest.deleted_at || latest.config_revision !== source.config_revision) throw new Error('来源设置已变化，旧请求结果已丢弃。');
      db.prepare('DELETE FROM image_studio_reference_items WHERE source_id = ?').run(sourceId);
      const insert = db.prepare(`INSERT INTO image_studio_reference_items
        (item_id, source_id, title_zh, title_original, prompt_zh, prompt_original,
         description, tags_json, author, source_url, cover_url, content_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of normalized) insert.run(item.itemId, sourceId, item.title, item.title,
        item.prompt, item.prompt, item.description, JSON.stringify(item.tags), item.author,
        item.sourceUrl, item.coverUrl, item.hash, at());
      db.prepare(`UPDATE image_studio_sources SET content_hash = ?, item_count = ?, last_success_at = ?,
        last_error = NULL, updated_at = ? WHERE source_id = ?`).run(hash, normalized.length, at(), at(), sourceId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { count: normalized.length, untranslated: normalized.filter((item) => !item.hasChinese).length };
  }

  function refreshSource(sourceId, options) {
    if (inflight.has(sourceId)) return inflight.get(sourceId);
    const pending = load(sourceId, options).finally(() => inflight.delete(sourceId));
    inflight.set(sourceId, pending);
    return pending;
  }

  async function checkSourceUrl(url) {
    const items = await readSourceJson(url, fetcher, urlValidator);
    return { count: normalizeItems('candidate', items).length };
  }

  return { listSources, saveSource, deleteSource, restoreSource, listItems,
    checkSource: (sourceId) => load(sourceId, { checkOnly: true }), checkSourceUrl, refreshSource };
}

module.exports = { createImageStudioSources, publicAddress, normalizeItems, readSourceJson };
