const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');

const commit = 'c807242867c45d3f8f37319e3b11c24d2662bc01';
const root = path.join(__dirname, '../electron/resources/image-studio-knowledge');
const upstreamPath = path.join(root, 'upstream-c8072428.zip');
const archive = new AdmZip(upstreamPath);
const entries = archive.getEntries();
const find = (name) => {
  const entry = entries.find((item) => item.entryName.endsWith(`/${name}`));
  if (!entry) throw new Error(`上游归档缺少 ${name}`);
  return entry.getData();
};
const manifest = JSON.parse(find('references/manifest.json').toString('utf8'));
const license = find('LICENSE').toString('utf8');
if (!license.includes('MIT License')) throw new Error('上游许可证已变化。');
const byId = new Map();
let rawEntryCount = 0;
for (const category of manifest.categories) {
  if (!/^[a-z0-9-]+\.json$/.test(category.file)) throw new Error('分类文件名无效。');
  const rows = JSON.parse(find(`references/${category.file}`).toString('utf8'));
  if (!Array.isArray(rows) || rows.length !== category.count) throw new Error(`分类 ${category.file} 数量不匹配。`);
  rawEntryCount += rows.length;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || !String(row.content || '').trim()) throw new Error('上游条目缺少 ID 或正文。');
    const id = String(row.id);
    const prior = byId.get(id);
    if (prior) { prior.categories.push(category.slug); continue; }
    const prompt = String(row.content);
    byId.set(id, { id, title: String(row.title || ''), description: String(row.description || ''), prompt,
      categories: [category.slug], sourceMedia: Array.isArray(row.sourceMedia) ? row.sourceMedia.filter((url) => typeof url === 'string') : [],
      needReferenceImages: Boolean(row.needReferenceImages),
      variables: [...new Set([...prompt.matchAll(/\{argument name="([^"]+)"|\{\{([^}]+)\}\}/g)].map((match) => match[1] || match[2]))],
      card: [String(row.title || ''), String(row.description || ''), prompt.slice(0, 360)].filter(Boolean).join(' · '),
    });
  }
}
const data = zlib.gzipSync(Buffer.from([...byId.values()].map((row) => JSON.stringify(row)).join('\n'), 'utf8'), { level: 9 });
const dataPath = path.join(root, 'knowledge.jsonl.gz');
fs.writeFileSync(dataPath, data);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const packageManifest = {
  schemaVersion: 1, packageVersion: `youmind-${manifest.updatedAt.slice(0, 10)}-${commit.slice(0, 8)}`,
  upstreamCommit: commit, upstreamUrl: 'https://github.com/YouMind-OpenLab/ai-image-prompts-skill',
  sourceId: 'youmind-image-prompts', generatedAt: new Date().toISOString(), license: 'MIT',
  rawEntryCount, upstreamReportedTotal: manifest.totalPrompts,
  deduplicatedCount: byId.size, categoryCount: manifest.categories.length,
  files: {
    'knowledge.jsonl.gz': { size: data.length, sha256: sha256(data) },
    'upstream-c8072428.zip': { size: fs.statSync(upstreamPath).size, sha256: sha256(fs.readFileSync(upstreamPath)) },
  },
};
const manifestBytes = Buffer.from(JSON.stringify(packageManifest, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(root, 'manifest.json'), manifestBytes);
const signingKeyPath = process.env.IMAGE_STUDIO_KNOWLEDGE_PRIVATE_KEY_PATH
  || path.join(__dirname, '../../.tmp/image-studio-knowledge-private.pem');
const signature = crypto.sign(null, manifestBytes, fs.readFileSync(signingKeyPath));
const distributable = new AdmZip();
distributable.addFile('manifest.json', manifestBytes);
distributable.addFile('knowledge.jsonl.gz', data);
distributable.addFile('LICENSE', Buffer.from(license, 'utf8'));
distributable.addFile('signature.bin', signature);
distributable.writeZip(path.join(root, 'knowledge-package.zip'));
process.stdout.write(`${packageManifest.packageVersion}: ${rawEntryCount} 条原始分类记录，${byId.size} 条去重知识，${data.length} 字节压缩数据\n`);
