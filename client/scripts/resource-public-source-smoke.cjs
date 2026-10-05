// 实际启用来源的索引与首个关联图探针；只取公开资源，不读取生产代理或凭据。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const base = path.resolve(__dirname, '../.tmp/ppt184-resource-center/public-source'); fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, '实际提示词-')), results = [], network = [];
const management = (name) => require(path.resolve(__dirname, '../../management/electron/services', name));
let database;
async function main() {
  database = new (require('../../management/node_modules/better-sqlite3'))(path.join(root, '独立管理.sqlite')); management('migrations.cjs').migrateDatabase(database);
  const { DEFAULT_SOURCES, createResourceSourceAdapters } = management('resourceSourceAdapters.cjs');
  const store = management('resourceStore.cjs').createResourceStore({ database, sources: DEFAULT_SOURCES });
  const downloader = management('resourceDownloadService.cjs').createResourceDownloadService({ root: path.join(root, '镜像'), store,
    fetchImpl: async (url, options) => { const response = await fetch(url, options); network.push({ url: String(url), status: response.status }); return response; },
    validateImage: async (buffer) => { const metadata = await require('sharp')(buffer).metadata(); assert(metadata.width && metadata.height); return { width: metadata.width, height: metadata.height }; } });
  const adapter = createResourceSourceAdapters({ downloader, store }), source = DEFAULT_SOURCES.find((item) => item.type === 'prompts');
  const index = await adapter.entries(source, AbortSignal.timeout(60000));
  results.push({ name: '管理端实际七源中的提示词固定提交索引', status: 'PASS', sourceId: source.sourceId, commit: index.commit, entries: index.entries.length });
  const entry = index.entries.find((item) => item.coverUrl); if (!entry) throw new Error('实际来源没有可取的关联图片，不能验证真实提示词缩略图');
  const prepared = await adapter.prepare(source, entry, index.commit, AbortSignal.timeout(60000)); assert(prepared.assets.some((asset) => asset.role === 'cover'), prepared.previewError);
  results.push({ name: '实际提示词关联图经管理下载器取得并解码，不使用示例图', status: 'PASS', resource: prepared });
}
main().catch((error) => { console.error(error.stack); results.push({ name: '实际提示词公共来源', status: /HTTP [45]|fetch failed|timeout|ENOTFOUND/i.test(error.message) ? 'BLOCKED' : 'FAIL', error: error.stack }); process.exitCode = 1; }).finally(() => { database?.close(); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实管理端公共来源与图片下载；不代表客户端UI或全库验收', results }, null, 2), 'utf8'); fs.writeFileSync(path.join(root, 'network.json'), JSON.stringify(network, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); });
