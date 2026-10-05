const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createDatabaseService } = require('./databaseService.cjs');
const { createResourceStore, changesBetween, WEEK_MS, hash } = require('./resourceStore.cjs');
const { createResourceSyncService } = require('./resourceSyncService.cjs');
const { createResourceDownloadService, validateUrl, inspectPptx } = require('./resourceDownloadService.cjs');
const { createSigningService } = require('./signingService.cjs');
const { createAuthorizationService } = require('./authorizationService.cjs');
const { createResourceHttpRouter } = require('./resourceHttpRouter.cjs');
const { createHttpRouter } = require('./httpRouter.cjs');
const source = { sourceId: 's', name: '测试来源' };
const item = (id, title = id) => ({ resourceId: `s:${id}`, sourceId: 's', upstreamId: id, title, center: 'prompts', kind: 'prompt', prompt: '测试中文正文', status: 'ready', assets: [] });
test('已批准七源的实际图片域名按来源限定，未知地址仍拒绝', async () => {
  const { DEFAULT_SOURCES } = require('./resourceSourceAdapters.cjs');
  for (const [id, host] of [['banana-prompt-quicker', 'cdn.jsdelivr.net'], ['awesome-gpt-image', 'pbs.twimg.com'], ['awesome-gpt4o-image-prompts', 'cdn.imgedify.com'], ['youmind-gpt-image-2', 'cms-assets.youmind.com'], ['youmind-nano-banana-pro', 'cms-assets.youmind.com']]) assert(DEFAULT_SOURCES.find((entry) => entry.sourceId === id).hosts.includes(host));
  assert(!DEFAULT_SOURCES.find((entry) => entry.sourceId === 'davidwu-gpt-image2-prompts').hosts.includes('cdn.jsdelivr.net'));
  await assert.rejects(validateUrl('https://unknown.example/image.png', DEFAULT_SOURCES[0].hosts), /来源范围/);
});
test('已登记来源更新图片域名时保留启用、周锚点和成功快照', (t) => {
  const { DEFAULT_SOURCES } = require('./resourceSourceAdapters.cjs'), current = DEFAULT_SOURCES[0];
  const database = createDatabaseService({ databasePath: ':memory:' }); t.after(() => database.close());
  const old = createResourceStore({ database: database.database, sources: [{ ...current, hosts: ['api.github.com'] }], now: () => 10000 });
  old.setEnabled(current.sourceId, true); old.publishSource(current.sourceId, [item('保留')]);
  const before = old.getSource(current.sourceId), next = createResourceStore({ database: database.database, sources: DEFAULT_SOURCES });
  assert(next.getSource(current.sourceId).hosts.includes('cdn.jsdelivr.net')); assert.equal(next.getSource(current.sourceId).enabled, true); assert.equal(next.getSource(current.sourceId).anchorAt, before.anchorAt); assert.equal(next.getSource(current.sourceId).nextDueAt, before.nextDueAt); assert.equal(next.snapshot().items.length, 1);
});
function fixture(t, clock) {
  const database = createDatabaseService({ databasePath: ':memory:' });
  t.after(() => database.close());
  return createResourceStore({ database: database.database, sources: [source], now: clock });
}
test('停止定时器后不继续补查后续来源', async (t) => {
  const store = fixture(t, Date.now); store.setEnabled('s', true);
  store.database.prepare('INSERT INTO resource_sources(source_id,config_json,enabled) VALUES (?,?,1)').run('s2', JSON.stringify({ sourceId: 's2' }));
  let entered, calls = [];
  const started = new Promise((resolve) => { entered = resolve; });
  const service = createResourceSyncService({ store, adapters: { entries: async (source, signal) => { calls.push(source.sourceId); entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('停止夹具')), { once: true })); }, prepare: async () => item('a') } });
  const pending = service.runDue(); await started; await service.stop(); await pending; assert.deepEqual(calls, ['s']);
});

test('资源暂存清理真实释放字节，迁移失败保留旧镜像、授权库和设置', async (t) => {
  const store = fixture(t, Date.now), root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-resource-clean-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { createResourceCenterService } = require('./resourceCenterService.cjs');
  const center = createResourceCenterService({ database: store.database, signingService: createSigningService({ database: store.database }), defaultRoot: root }); t.after(() => center.stop()); await center.start();
  const bytes = Buffer.from('保留的真实镜像'), digest = hash(bytes); fs.writeFileSync(path.join(root, digest), bytes); store.saveAsset({ assetId: digest, hash: digest, bytes: bytes.length, relativePath: digest, mime: 'application/octet-stream' });
  const part = path.join(root, `${'a'.repeat(64)}.part`); fs.writeFileSync(part, '临时片段'); const preview = path.join(root, '.preview-candidates', require('node:crypto').randomUUID()); fs.mkdirSync(preview, { recursive: true }); fs.writeFileSync(path.join(preview, 'preview.png'), '候选预览');
  const size = fs.statSync(part).size + fs.statSync(path.join(preview, 'preview.png')).size; assert.equal((await center.cleanup({ confirmed: true })).releasedBytes, size); assert(fs.existsSync(path.join(root, digest))); assert(store.database.open);
  const next = path.join(root, '新位置'), copy = fs.promises.copyFile; fs.promises.copyFile = async () => { throw new Error('合成权限不足'); };
  try { await assert.rejects(center.configure({ root: next }), /权限不足/); assert.equal(center.status().settings.root, root); assert(fs.existsSync(path.join(root, digest))); } finally { fs.promises.copyFile = copy; }
});

test('固定周锚点：首次立即、手动不移、跨多周仅补一次、重启保留', async (t) => {
  let at = 10000, calls = 0;
  const store = fixture(t, () => at);
  const adapters = { entries: async () => { calls += 1; return { commit: 'test', entries: [{ id: 'a' }] }; }, prepare: async () => item('a') };
  const service = createResourceSyncService({ store, adapters, now: () => at });
  await service.enable('s', true);
  assert.equal(calls, 1); assert.equal(store.getSource('s').nextDueAt, 10000 + WEEK_MS);
  at += 1000; await service.check('s'); assert.equal(store.getSource('s').anchorAt, 10000); assert.equal(store.getSource('s').nextDueAt, 10000 + WEEK_MS);
  at = 10000 + WEEK_MS * 4 + 123; await service.runDue(); assert.equal(calls, 3); assert.equal(store.getSource('s').nextDueAt, 10000 + WEEK_MS * 5);
  await service.runDue(); assert.equal(calls, 3);
  const restarted = createResourceStore({ database: store.database, sources: [source], now: () => at });
  assert.equal(restarted.getSource('s').nextDueAt, 10000 + WEEK_MS * 5);
  at = 10; await service.runDue(); assert.equal(calls, 3);
});

test('业务差异：多批最终状态、排序和URL不计变化；新建后下架不虚报', (t) => {
  const store = fixture(t, Date.now);
  store.publishSource('s', [item('a'), item('b')]);
  assert.equal(store.publishSource('s', [{ ...item('b'), sourceUrl: '不同线路' }, item('a')]), 1);
  store.publishSource('s', [item('a', '更新标题'), item('b'), item('c')]);
  store.publishSource('s', [item('a', '再更新'), item('b')]);
  const changes = changesBetween(store.snapshot(1).items, store.snapshot().items);
  assert.equal(changes.length, 1); assert.equal(changes[0].resourceId, 's:a'); assert.equal(changes[0].action, 'updated');
  assert.throws(() => store.publishSource('s', []), /异常空清单/); assert.equal(store.snapshot().version, 3);
  assert.throws(() => store.publishSource('s', [{ ...item('x'), assets: [{ assetId: '不存在' }] }]), /尚未就绪/);
});

test('独立项发布；失败项保留旧成功资源；并发检查合并', async (t) => {
  const store = fixture(t, Date.now); store.setEnabled('s', true); store.publishSource('s', [item('a'), item('b')]);
  let calls = 0;
  const adapters = { entries: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { entries: [{ id: 'a' }, { id: 'b' }], commit: 'test' }; },
    prepare: async (_source, entry) => { if (entry.id === 'a') throw new Error('模拟供应商失败'); return item('b', '已变更'); } };
  const service = createResourceSyncService({ store, adapters });
  await Promise.all([service.check('s'), service.check('s')]);
  assert.equal(calls, 1); assert.equal(store.snapshot().items.find((i) => i.upstreamId === 'a').title, 'a');
  assert.equal(store.snapshot().items.find((i) => i.upstreamId === 'b').title, '已变更');
  assert.match(store.getSource('s').error, /1项未完成/); assert.equal(store.snapshot().changes.length, 1);
});

test('实际文件下载hash、类型、上限和逐跳主机校验；半文件不发布', async (t) => {
  const store = fixture(t, Date.now);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-resource-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  const visited = [];
  let redirects = false;
  const downloader = createResourceDownloadService({ root, store, validateImage: () => ({ width: 1, height: 1 }), urlValidator: async (url, hosts) => { visited.push(url); if (!hosts.includes(new URL(url).hostname)) throw new Error('拒绝目标主机'); },
    fetchImpl: async (url) => redirects && url === 'https://allowed.test/a' ? new Response(null, { status: 302, headers: { location: 'https://blocked.test/b' } })
      : new Response(png, { headers: { 'content-length': String(png.length) } }) });
  const result = await downloader.download('https://allowed.test/a', { hosts: ['allowed.test'], mime: 'image/png' });
  assert.equal(result.hash, hash(png)); assert.deepEqual(fs.readFileSync(path.join(root, result.relativePath)), png);
  await assert.rejects(downloader.download('https://allowed.test/a', { hosts: ['allowed.test'], expectedHash: '0'.repeat(64) }), /hash校验/);
  redirects = true;
  await assert.rejects(downloader.download('https://allowed.test/a', { hosts: ['allowed.test'] }), /拒绝目标主机/);
  assert.equal(fs.readdirSync(root).some((file) => file.endsWith('.part')), false);
  assert.equal(visited.at(-1), 'https://blocked.test/b');
  await assert.rejects(validateUrl('https://localhost/a', ['localhost']), /本机或内网/);
  assert.throws(() => inspectPptx(Buffer.from('不是ZIP')), /ZIP目录/);
});

test('真实HTTP资源授权、签名目录、Range、未发布文件拒绝和即时撤销', async (t) => {
  const store = fixture(t, Date.now);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-resource-http-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const signing = createSigningService({ database: store.database });
  const auth = createAuthorizationService({ database: store.database, signingService: signing });
  const input = { name: '隔离测试员工', phone: '13800000000', deviceFingerprint: 'test-device', clientId: 'test-client', platform: 'win32', arch: 'x64' };
  const application = auth.submitApplication(input); auth.approveApplication(application.id);
  const license = auth.login(input).license;
  const bytes = Buffer.from('测试资源文件'); const digest = hash(bytes); fs.writeFileSync(path.join(root, digest), bytes);
  store.saveAsset({ assetId: digest, hash: digest, bytes: bytes.length, mime: 'application/octet-stream', relativePath: digest });
  store.publishSource('s', [{ ...item('a'), assets: [{ assetId: digest, hash: digest }] }]);
  const server = http.createServer(createHttpRouter({ getServiceInfo: () => ({}), resourceRouter: createResourceHttpRouter({ store, signingService: signing, assetRoot: root }) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/resource/v1`;
  assert.equal((await fetch(`${base}/catalog`)).status, 401);
  const result = await fetch(`${base}/session`, { method: 'POST', body: JSON.stringify({ license, deviceFingerprint: input.deviceFingerprint }) });
  assert.equal(result.status, 200); const session = (await result.json()).data; const headers = { authorization: `Bearer ${session.token}` };
  const catalog = (await (await fetch(`${base}/catalog`, { headers })).json()).data;
  assert.equal(catalog.envelope.payload.version, 1); assert.equal(catalog.payload.total, 1);
  const range = await fetch(`${base}/assets/${digest}?version=1`, { headers: { ...headers, range: 'bytes=2-4' } });
  assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(2, 5));
  assert.equal((await fetch(`${base}/assets/${'0'.repeat(64)}?version=1`, { headers })).status, 422);
  auth.revokeLicense(license.payload.licenseId);
  assert.equal((await fetch(`${base}/catalog`, { headers })).status, 401);
});

test('在途退出等待取消落库后再关库，资源网络故障不关闭授权服务', async (t) => {
  const store = fixture(t, Date.now); store.setEnabled('s', true);
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const service = createResourceSyncService({ store, adapters: { entries: async (_source, signal) => {
    entered(); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true }));
  } } });
  const job = service.check('s').catch(() => {}); await started;
  await service.stop(); await job;
  assert.equal(store.getSource('s').running, false); assert.equal(store.audits()[0].status, 'CANCELLED');
  const { createResourceCenterService } = require('./resourceCenterService.cjs');
  const signing = createSigningService({ database: store.database });
  const center = createResourceCenterService({ database: store.database, signingService: signing, defaultRoot: path.join(os.tmpdir(), 'jato-unavailable-test'),
    configureNetwork: async () => { throw new Error('隔离测试代理不可用'); } });
  await center.start(); assert.match(center.status().unavailable, /代理不可用/);
  assert.equal(store.database.open, true); assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM licenses').get().count, 0);
});

test('ETag无变化只传元数据；提示词换图失败保留完整旧条目并计部分失败', async (t) => {
  const store = fixture(t, Date.now);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-resource-etag-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let transferred = 0, requests = 0;
  const bytes = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  const downloader = createResourceDownloadService({ root, store, validateImage: () => ({ width: 1, height: 1 }), urlValidator: async () => {}, fetchImpl: async (_url, options) => {
    requests += 1; if (options.headers['If-None-Match'] === 'stable') return new Response(null, { status: 304 });
    transferred += bytes.length; return new Response(bytes, { headers: { etag: 'stable' } });
  } });
  const first = await downloader.download('https://test/a.png', { hosts: [], mime: 'image/png' });
  const second = await downloader.download('https://test/a.png', { hosts: [], mime: 'image/png' });
  assert.equal(requests, 2); assert.equal(transferred, bytes.length); assert.equal(first.hash, second.hash);
  const cover = { ...first, role: 'cover', page: 0, generatorVersion: 'source-1' };
  store.publishSource('s', [{ ...item('a'), assets: [cover] }]);
  const { createResourceSourceAdapters } = require('./resourceSourceAdapters.cjs');
  const adapters = createResourceSourceAdapters({ store, downloader: { download: async () => { throw new Error('CDN中断'); } } });
  const entry = { id: 'a', title: '新标题', prompt: '新版正文不能配旧图冒充就绪', kind: 'prompt', coverUrl: 'https://test/new.png' };
  await assert.rejects(adapters.prepare({ sourceId: 's', type: 'prompts', hosts: [] }, entry, 'new-revision'), /CDN中断/);
  store.setEnabled('s', true); const before = store.snapshot();
  const sync = createResourceSyncService({ store, adapters: { entries: async () => ({ commit: 'new-revision', entries: [entry] }), prepare: adapters.prepare } }); t.after(() => sync.stop());
  const result = await sync.check('s'); assert.equal(result.failures, 1); assert.deepEqual(store.snapshot(), before); assert.match(store.getSource('s').error, /1项未完成/); assert(store.audits().some((row) => row.status === 'PARTIAL'));
});
