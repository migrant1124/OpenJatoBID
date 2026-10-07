// 隔离验证资源网络链路；不加载管理端入口，不访问正式数据库。
const { app, net, session, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createDatabaseService } = require('../electron/services/databaseService.cjs');
const { createResourceStore } = require('../electron/services/resourceStore.cjs');
const { createResourceDownloadService, createElectronResourceFetch, validateUrl } = require('../electron/services/resourceDownloadService.cjs');
const { DEFAULT_SOURCES, createResourceSourceAdapters } = require('../electron/services/resourceSourceAdapters.cjs');
const { createResourceSyncService } = require('../electron/services/resourceSyncService.cjs');
const { createResourceImageDecoder } = require('../electron/services/resourcePreviewService.cjs');
const base = path.resolve(process.argv[2] || path.join(__dirname, '../../.tmp/resource-sync-fix-20261006'));
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'electron-'));
app.setName('Jato资源隔离回归');
app.setPath('userData', path.join(root, 'userData'));
app.setPath('sessionData', path.join(root, 'sessionData'));
const report = { root, versions: process.versions, checks: [], sources: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
const deadline = setTimeout(() => { report.error = '隔离验证超过8分钟'; save(); app.exit(2); }, 480000);
app.whenReady().then(async () => {
  const database = createDatabaseService({ databasePath: path.join(root, 'test.sqlite3') });
  const store = createResourceStore({ database: database.database, sources: [...DEFAULT_SOURCES, { sourceId: 'local', hosts: ['127.0.0.1'], type: 'prompts' }] });
  const resourceSession = session.fromPartition('resource-isolated-test', { cache: false });
  await resourceSession.setProxy({ mode: 'system' });
  const fetchImpl = createElectronResourceFetch({ net, session: resourceSession });
  const image = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG();
  let transferred = 0, blockedRequests = 0, proxyRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('http://resource-proxy-check.invalid/')) { proxyRequests++; res.end('专用代理已使用'); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: '/image' }); res.end(); }
    else if (req.url === '/escape') { res.writeHead(302, { location: `http://localhost:${server.address().port}/blocked` }); res.end(); }
    else if (req.url === '/blocked') { blockedRequests++; res.end('不应访问'); }
    else if (req.url === '/resume') {
      const start = Number(req.headers.range?.match(/^bytes=(\d+)-$/)?.[1]);
      assert.equal(req.headers['if-range'], 'stable'); assert.equal(start, 16);
      res.writeHead(206, { 'content-range': `bytes ${start}-${image.length - 1}/${image.length}`, 'content-length': image.length - start, etag: 'stable' }); res.end(image.subarray(start));
    } else if (req.url === '/image') {
      if (req.headers['if-none-match'] === 'stable') { res.writeHead(304); res.end(); }
      else { transferred += image.length; res.writeHead(200, { 'content-type': 'image/png', 'content-length': image.length, etag: 'stable' }); res.end(image); }
    } else if (req.url === '/slow') {
      const timer = setTimeout(() => res.end('延迟响应'), 2000); req.on('close', () => clearTimeout(timer));
    } else if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'image/png' }); res.write(image.subarray(0, 16));
      const timer = setTimeout(() => res.end(image.subarray(16)), 2000); res.on('close', () => clearTimeout(timer));
    } else { res.writeHead(404); res.end('缺失原图'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const validateImage = createResourceImageDecoder({ BrowserWindow, nativeImage, session });
  const local = createResourceDownloadService({ root: path.join(root, 'assets'), store, fetchImpl, validateImage,
    urlValidator: async (url) => { if (new URL(url).origin !== origin) throw new Error('隔离重定向目标越界'); } });
  const check = async (name, action) => { await action(); report.checks.push({ name, status: 'PASS' }); save(); };
  try {
    await check('真实Electron原session.fetch手动重定向复现取消', () => assert.rejects(resourceSession.fetch(`${origin}/redirect`, { redirect: 'manual' }), /Redirect was cancelled/));
    let first;
    await check('适配器逐跳302下载真实PNG并写隔离SQLite', async () => {
      first = await local.download(`${origin}/redirect`, { hosts: ['127.0.0.1'], mime: 'image/png' }); assert.equal(first.width, 1); assert.equal(first.height, 1);
      assert.deepEqual(fs.readFileSync(path.join(local.root, first.relativePath)), image);
    });
    await check('重定向后的ETag304复用实际文件且不重传', async () => {
      const cached = await local.download(`${origin}/redirect`, { hosts: ['127.0.0.1'], mime: 'image/png' }); assert.equal(cached.hash, first.hash); assert.equal(transferred, image.length);
    });
    await check('真实Electron Range206续传保留请求头并校验完整hash', async () => {
      const url = `${origin}/resume`, key = crypto.createHash('sha256').update(url).digest('hex');
      fs.writeFileSync(path.join(local.root, `${key}.part`), image.subarray(0, 16));
      fs.writeFileSync(path.join(local.root, `${key}.part.json`), JSON.stringify({ etag: 'stable' }), 'utf8');
      const resumed = await local.download(url, { hosts: ['127.0.0.1'], mime: 'image/png' }); assert.equal(resumed.hash, first.hash);
    });
    await check('越界重定向在请求前拒绝', async () => { await assert.rejects(local.download(`${origin}/escape`, { hosts: ['127.0.0.1'] }), /目标越界/); assert.equal(blockedRequests, 0); });
    await check('生产验证器拒绝内网和非HTTPS', async () => {
      await assert.rejects(validateUrl('https://127.0.0.1/image', ['127.0.0.1']), /本机或内网/);
      await assert.rejects(validateUrl('http://github.com/image', ['github.com']), /来源范围/);
    });
    for (const endpoint of ['slow', 'stream']) await check(`取消${endpoint === 'slow' ? '响应前' : '流式正文中'}请求不挂起或发布`, async () => {
      const count = store.database.prepare('SELECT COUNT(*) AS n FROM resource_assets').get().n;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100);
      try { await assert.rejects(local.download(`${origin}/${endpoint}`, { hosts: ['127.0.0.1'], mime: 'image/png', signal: controller.signal })); }
      finally { clearTimeout(timer); }
      assert.equal(store.database.prepare('SELECT COUNT(*) AS n FROM resource_assets').get().n, count);
    });
    await check('实际专用session固定代理继续生效', async () => {
      await resourceSession.setProxy({ mode: 'fixed_servers', proxyRules: origin, proxyBypassRules: '<local>' });
      assert.equal(await (await fetchImpl('http://resource-proxy-check.invalid/proxy')).text(), '专用代理已使用'); assert.equal(proxyRequests, 1);
      await resourceSession.setProxy({ mode: 'system' });
    });
    await check('404保存明确审计、保留完整旧条目和版本', async () => {
      const source = store.getSource('local'), adapters = createResourceSourceAdapters({ downloader: local, store });
      const entry = { id: 'original', title: '旧标题', prompt: '隔离正文', kind: 'prompt', coverUrl: `${origin}/image` };
      store.publishSource('local', [await adapters.prepare(source, entry, 'old')]); store.setEnabled('local', true);
      const before = store.snapshot(), sync = createResourceSyncService({ store, adapters: { entries: async () => ({ commit: 'new', entries: [{ ...entry, title: '未就绪新标题', coverUrl: `${origin}/missing` }] }), prepare: adapters.prepare } });
      try { const result = await sync.check('local'); assert.equal(result.failed, 1); assert.equal(result.reusedOld, 1); assert.deepEqual(store.snapshot(), before);
        const audit = JSON.parse(store.audits({ status: 'ITEM_FAILED' }).items[0].detailJson); assert.equal(audit.code, 'HTTP_404'); assert.equal(audit.retryable, false);
      } finally { await sync.stop(); }
    });
    if (process.argv[3]) {
      const fixture = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
      const downloader = createResourceDownloadService({ root: local.root, store, fetchImpl, validateImage });
      const actual = createResourceSourceAdapters({ downloader, store });
      for (const group of fixture) {
        store.setEnabled(group.sourceId, true); let processed = 0;
        const sync = createResourceSyncService({ store, adapters: { entries: async () => ({ commit: group.commit, entries: group.entries }),
          prepare: async (...args) => { try { return await actual.prepare(...args); } finally { console.log(`${group.sourceId} ${++processed}/${group.entries.length}`); } } } });
        try {
          const outcome = await sync.check(group.sourceId);
          const failures = store.audits({ sourceId: group.sourceId, status: 'ITEM_FAILED', limit: 100 }).items.map((row) => JSON.parse(row.detailJson));
          if (group.expectedRecoveredIds) assert(!outcome.failedIds.some((id) => group.expectedRecoveredIds.includes(id)), '诊断中的可修复项仍失败');
          report.sources.push({ sourceId: group.sourceId, scope: '诊断报告中的原失败条目，非整个来源', status: outcome.failed ? 'PARTIAL' : 'COMPLETED', ...outcome, failureAudit: failures }); save();
        } finally { await sync.stop(); }
      }
    }
    report.assetCount = store.database.prepare('SELECT COUNT(*) AS n FROM resource_assets').get().n;
    report.assetBytes = store.database.prepare('SELECT SUM(bytes) AS n FROM resource_assets').get().n;
    report.finishedAt = new Date().toISOString(); report.status = 'PASS'; save();
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); database.close(); }
  console.log(`证据：${path.join(root, 'result.json')}`); clearTimeout(deadline); app.exit(0);
}).catch((error) => { report.status = 'FAIL'; report.error = error.stack; save(); console.error(error); clearTimeout(deadline); app.exit(1); });
