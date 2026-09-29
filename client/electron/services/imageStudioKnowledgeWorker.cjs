const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

const synonyms = {
  产品: 'product', 摄影: 'photography', 海报: 'poster', 插画: 'illustration',
  留白: 'minimalist negative space', 东方: 'eastern chinese', 轮廓光: 'rim lighting',
  电商: 'ecommerce product', 信息图: 'infographic', 人像: 'portrait',
};
const terms = (value) => {
  const text = String(value || '').toLowerCase();
  const expanded = `${text} ${Object.entries(synonyms).filter(([word]) => text.includes(word)).map(([, words]) => words).join(' ')}`;
  return [...new Set([...(expanded.match(/[a-z][a-z0-9]{2,}/g) || []),
    ...[...expanded.matchAll(/[\u3400-\u9fff]{2,}/g)].flatMap(([group]) =>
      [...group].slice(0, -1).map((_, index) => group.slice(index, index + 2)))])];
};

try {
  const root = workerData.root;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const data = fs.readFileSync(path.join(root, 'knowledge.jsonl.gz'));
  const checksum = crypto.createHash('sha256').update(data).digest('hex');
  if (data.length !== manifest.files['knowledge.jsonl.gz'].size || checksum !== manifest.files['knowledge.jsonl.gz'].sha256) {
    throw new Error('知识快照校验失败。');
  }
  const rows = zlib.gunzipSync(data).toString('utf8').split('\n').map((line) => JSON.parse(line));
  if (rows.length !== manifest.deduplicatedCount) throw new Error('知识快照条目数不匹配。');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE VIRTUAL TABLE knowledge USING fts5(terms)');
  const insert = db.prepare('INSERT INTO knowledge(rowid, terms) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let index = 0; index < rows.length; index += 1) {
    insert.run(index + 1, terms(rows[index].card).join(' '));
  }
  db.exec('COMMIT');
  parentPort.postMessage({ type: 'ready', version: manifest.packageVersion, count: rows.length });
  parentPort.on('message', ({ id, query }) => {
    try {
      const queryTerms = terms(query).slice(0, 12);
      if (!queryTerms.length) { parentPort.postMessage({ id, items: [] }); return; }
      const candidates = db.prepare(`SELECT rowid FROM knowledge WHERE knowledge MATCH ? ORDER BY bm25(knowledge) LIMIT 20`)
        .all(queryTerms.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR '));
      const negatives = [...String(query).matchAll(/(?:不要|避免|禁止|不含)([\u3400-\u9fffA-Za-z]{1,8})/g)].map((match) => match[1].toLowerCase());
      const items = candidates.map(({ rowid }) => rows[Number(rowid) - 1]).filter((item) =>
        !negatives.some((word) => item.card.toLowerCase().includes(word))).slice(0, 3)
        .map(({ id: itemId, title, card, prompt, description, categories, sourceMedia, needReferenceImages }) => ({
          itemId, title, card: card.slice(0, 450), prompt, description, categories, sourceMedia, needReferenceImages,
          sourceId: manifest.sourceId, version: manifest.packageVersion,
        }));
      parentPort.postMessage({ id, items });
    } catch (error) { parentPort.postMessage({ id, error: String(error.message || error) }); }
  });
} catch (error) { parentPort.postMessage({ type: 'error', error: String(error.message || error) }); }
