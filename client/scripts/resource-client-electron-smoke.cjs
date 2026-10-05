const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { app } = require('electron');
const rootBase = path.resolve(__dirname, '../.tmp/ppt184-resource-center/resource-client'); fs.mkdirSync(rootBase, { recursive: true });
const root = fs.mkdtempSync(path.join(rootBase, '隔离-')); app.setPath('userData', path.join(root, '客户端数据')); app.disableHardwareAcceleration();
const results = []; let sqlite, managementDb, server, client;
const management = (name) => require(path.resolve(__dirname, '../../management/electron/services', name));
async function check(name, callback) { try { await callback(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
async function main() {
  await app.whenReady(); sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  managementDb = new (require('better-sqlite3'))(path.join(root, '管理端夹具.sqlite')); management('migrations.cjs').migrateDatabase(managementDb);
  const signing = management('signingService.cjs').createSigningService({ database: managementDb });
  const authorization = management('authorizationService.cjs').createAuthorizationService({ database: managementDb, signingService: signing });
  const authorize = (suffix) => { const input = { name: `隔离员工${suffix}`, phone: suffix === '甲' ? '13800000000' : '13900000000', deviceFingerprint: `fixture-${suffix}`, clientId: `fixture-${suffix}`, platform: 'win32', arch: 'x64' }; const application = authorization.submitApplication(input); authorization.approveApplication(application.id); return { input, license: authorization.login(input).license }; };
  const first = authorize('甲'), second = authorize('乙'); let identity = first;
  const assetRoot = path.join(root, '管理资源'); fs.mkdirSync(assetRoot);
  const publicStore = management('resourceStore.cjs').createResourceStore({ database: managementDb, sources: [{ sourceId: 's', name: '合成来源', type: 'prompts' }] });
  const bytes = await require('sharp')({ create: { width: 100, height: 75, channels: 3, background: '#336699' } }).png().toBuffer(), hash = require('../electron/services/resourceCacheStore.cjs').digest(bytes);
  fs.writeFileSync(path.join(assetRoot, hash), bytes); publicStore.saveAsset({ assetId: hash, hash, bytes: bytes.length, mime: 'image/png', relativePath: hash });
  const item = (index, title = `条目${index}`) => ({ resourceId: `s:${index}`, sourceId: 's', upstreamId: String(index), center: 'prompts', kind: 'prompt', title, prompt: 'Original prompt', translatedTitle: '已翻译标题', translatedPrompt: '已翻译提示词', status: 'ready', capability: 'unverified', assets: [{ assetId: hash, hash, bytes: bytes.length, mime: 'image/png', role: 'cover', page: 0, generatorVersion: 'fixture-1' }] });
  let items = Array.from({ length: 105 }, (_, index) => item(index)); publicStore.publishSource('s', items);
  server = http.createServer(management('httpRouter.cjs').createHttpRouter({ getServiceInfo: () => ({}), resourceRouter: management('resourceHttpRouter.cjs').createResourceHttpRouter({ store: publicStore, signingService: signing, assetRoot }) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  let tamper = false, offline = false, networkCount = 0;
  const fetchImpl = async (url, options) => {
    assert(String(url).startsWith(`${base}/api/resource/`), '员工资源不准外连'); networkCount += 1;
    if (offline) throw new Error('合成管理端离线'); const response = await fetch(url, options);
    if (tamper && String(url).includes('/catalog')) { const body = await response.json(); body.data.payload.items[0].title = '签名外篡改'; return new Response(JSON.stringify(body), { status: 200 }); }
    return response;
  };
  let store;
  const openClient = () => { store = require('../electron/services/resourceCacheStore.cjs').createResourceCacheStore({ db: sqlite.db }); return require('../electron/services/resourceClientService.cjs').createResourceClientService({ app, store, fetchImpl, licenseService: { getResourceIdentity: async () => ({ serverAddress: base, publicKey: signing.getPublicKey(), license: identity.license, employeeId: identity.license.payload.employeeId, ...identity.input }) } }); };
  client = openClient();
  await check('管理授权服务实际签发/资源HTTP/签名分页105条；首次同步不虚报全部新增', async () => {
    await client.sync(); const value = await client.list({ center: 'prompts', limit: 100 }); assert.equal(value.total, 105); assert.equal((await client.getDigest()).autoEligible, false);
  });
  await check('应用与展示独立；跨批最终状态去重；重启保留未展示，展示后不重复', async () => {
    items = items.map((value, index) => index === 0 ? item(0, '第一次修改') : value); publicStore.publishSource('s', items);
    items = items.map((value, index) => index === 0 ? item(0, '最终修改') : value); publicStore.publishSource('s', items); await client.sync();
    const digest = await client.getDigest(); assert.equal(digest.changes.length, 1); assert.equal(digest.changes[0].title, '最终修改'); assert.equal(digest.autoEligible, true);
    await client.close(); sqlite.close(); sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app); client = openClient();
    assert.equal((await client.getDigest()).autoEligible, true); assert.equal((await client.getDigest()).changes[0].title, '最终修改');
    await client.markShown({ scope: digest.scope, version: digest.version }); assert.equal((await client.getDigest()).autoEligible, false);
    assert.equal(sqlite.db.prepare('SELECT shown_version, applied_version FROM resource_client_streams').get().shown_version, digest.version);
    await client.close(); sqlite.close(); sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app); client = openClient(); assert.equal((await client.getDigest()).autoEligible, false);
  });
  await check('真正图片字节/缓存离线读取；员工无公网兜底', async () => {
    const before = networkCount, firstImage = await client.loadAsset({ resourceId: 's:0', assetId: hash }); assert.equal(require('../electron/services/resourceCacheStore.cjs').digest(fs.readFileSync(firstImage.filePath)), hash);
    offline = true; const cached = await client.loadAsset({ resourceId: 's:0', assetId: hash }); assert.equal(cached.filePath, firstImage.filePath); assert(networkCount > before); const cachedCount = networkCount; await client.loadAsset({ resourceId: 's:0', assetId: hash }); assert.equal(networkCount, cachedCount); offline = false;
  });
  await check('签名篡改失败保留旧目录和应用游标', async () => {
    const cursor = (await client.getDigest()).version; tamper = true; await assert.rejects(client.sync(), /签名或内容/); tamper = false; assert.equal((await client.getDigest()).version, cursor); assert.equal((await client.getItem('s:0')).title, '最终修改');
  });
  await check('缓存读取期间切换真实员工身份，旧结果丢弃且新身份无旧目录', async () => {
    const original = fs.promises.readFile; let changed = false;
    fs.promises.readFile = async (...args) => { const data = await original(...args); if (!changed && String(args[0]).endsWith(hash)) { identity = second; changed = true; } return data; };
    try { await assert.rejects(client.loadAsset({ resourceId: 's:0', assetId: hash }), /身份已改变/); assert.equal((await client.list()).total, 0); } finally { fs.promises.readFile = original; }
    identity = first; assert.equal((await client.list()).total, 105);
  });
  await check('缓存迁移复制/hash后切换；迁移失败保留已配置根，失联不重建', async () => {
    const parent = path.join(root, '非系统盘缓存父目录'); fs.mkdirSync(parent); const old = client.cacheStatus().root;
    const moved = await client.configureCache({ parent }); assert.notEqual(moved.root, old); assert(fs.existsSync(old));
    const original = fs.promises.copyFile; fs.promises.copyFile = async () => { throw new Error('合成权限不足'); };
    try { await assert.rejects(client.configureCache({ parent }), /权限不足/); assert.equal(client.cacheStatus().root, moved.root); } finally { fs.promises.copyFile = original; }
    await client.close(); fs.renameSync(moved.root, `${moved.root}-失联`);
    client = require('../electron/services/resourceClientService.cjs').createResourceClientService({ app, store, fetchImpl, licenseService: { getResourceIdentity: async () => ({ serverAddress: base, publicKey: signing.getPublicKey(), license: first.license, employeeId: first.license.payload.employeeId, ...first.input }) } });
    assert.equal(fs.existsSync(moved.root), false); await assert.rejects(client.loadAsset({ resourceId: 's:0', assetId: hash, retry: true }), /ENOENT/); assert.equal(fs.existsSync(moved.root), false); fs.renameSync(`${moved.root}-失联`, moved.root);
  });
  await check('缓存清理包含当前目录的严格归属孤儿和续传文件，保留项目/旧目录/快照', async () => {
    const current = client.cacheStatus().root, orphan = path.join(current, `${'a'.repeat(64)}.part`), cover = path.join(current, `${'b'.repeat(64)}.png`), unowned = path.join(current, '用户外部资料.txt');
    fs.writeFileSync(orphan, '续传片段'); fs.writeFileSync(cover, '旧封面'); fs.writeFileSync(unowned, '不属于资源缓存');
    const version = (await client.list({})).version, before = fs.statSync(orphan).size + fs.statSync(cover).size;
    const result = await client.clearCache({ confirmed: true }); assert(result.releasedBytes >= before); assert(!fs.existsSync(orphan) && !fs.existsSync(cover)); assert(fs.existsSync(unowned)); assert.equal((await client.list({})).version, version);
  });
  await check('七源迁移幂等归档原线路；收藏/译文/个人改写/启停/tombstone保持', async () => {
    const prompts = require('../electron/services/promptLibraryStore.cjs').createPromptLibraryStore({ db: sqlite.db });
    const group = prompts.createGroup({ groupName: '隔离私人分组' });
    const saved = prompts.createPrompt({ groupId: group.groupId, title: '个人原稿', contentMarkdown: '私人改写只在本地', isFavorite: true });
    sqlite.db.prepare('INSERT INTO image_studio_reference_favorites VALUES (?, ?, ?, ?)').run('s', 's:0', saved.promptId, new Date().toISOString());
    sqlite.db.prepare("UPDATE image_studio_reference_items SET prompt_zh='用户校对译文' WHERE item_id='s:0'").run();
    const personalBefore = sqlite.db.prepare('SELECT * FROM prompt_items WHERE prompt_id=?').get(saved.promptId);
    const defaults = require('../electron/resources/image-studio-sources.json').sources;
    const prior = defaults.map((source, index) => {
      const enabled = index % 2, deleted = index === 0 ? '已删除' : null, itemId = source.id + ':historical-item';
      sqlite.db.prepare("INSERT OR REPLACE INTO image_studio_sources(source_id,name,url,fallback_url,built_in,enabled,deleted_at,overrides_json,updated_at) VALUES (?,?,'https://原线路.invalid/index.json','https://备用.invalid/index.json',1,?,?,'{}',?)").run(source.id, source.name, enabled, deleted, new Date().toISOString());
      sqlite.db.prepare('INSERT INTO image_studio_reference_items(item_id,source_id,title_zh,title_original,prompt_zh,prompt_original,source_url,cover_url,content_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(itemId, source.id, '用户校对'+source.id, '旧标题', '用户译文'+source.id, '旧原文', 'https://原线路.invalid/item', 'https://原线路.invalid/cover.png', 'history-'+source.id, new Date().toISOString());
      const personal = prompts.createPrompt({ groupId: group.groupId, title: '个人-'+source.id, contentMarkdown: '用户改写-'+source.id, isFavorite: true }); sqlite.db.prepare('INSERT INTO image_studio_reference_favorites VALUES (?,?,?,?)').run(source.id, itemId, personal.promptId, new Date().toISOString());
      return { source, enabled, deleted, itemId, item: sqlite.db.prepare('SELECT * FROM image_studio_reference_items WHERE item_id=?').get(itemId), personal: sqlite.db.prepare('SELECT * FROM prompt_items WHERE prompt_id=?').get(personal.promptId) };
    }); assert.equal(prior.length, 7);
    const factory = require('../electron/services/imageStudioSources.cjs').createImageStudioSources;
    factory({ db: sqlite.db, resourceClient: client, fetcher: async () => { throw new Error('禁止旧公网请求'); } }); factory({ db: sqlite.db, resourceClient: client });
    for (const old of prior) {
      const archived = client.legacySources().find((item) => item.key.endsWith(old.source.id)); assert.equal(JSON.parse(archived.configJson).url, 'https://原线路.invalid/index.json');
      const retained = sqlite.db.prepare('SELECT enabled,deleted_at,fallback_url FROM image_studio_sources WHERE source_id=?').get(old.source.id); assert.equal(retained.enabled, old.enabled); assert.equal(retained.deleted_at, old.deleted); assert.equal(retained.fallback_url, '');
      assert.deepEqual(sqlite.db.prepare('SELECT * FROM image_studio_reference_items WHERE item_id=?').get(old.itemId), old.item); assert.deepEqual(sqlite.db.prepare('SELECT * FROM prompt_items WHERE prompt_id=?').get(old.personal.prompt_id), old.personal); assert.equal(sqlite.db.prepare('SELECT prompt_id FROM image_studio_reference_favorites WHERE source_id=? AND item_id=?').get(old.source.id, old.itemId).prompt_id, old.personal.prompt_id);
    } fs.writeFileSync(path.join(root, '七源旧数据保护.json'), JSON.stringify(prior, null, 2), 'utf8');
    assert.equal(sqlite.db.prepare('SELECT prompt_zh FROM image_studio_reference_items WHERE item_id=?').get('s:0').prompt_zh, '用户校对译文');
    assert.deepEqual(sqlite.db.prepare('SELECT * FROM prompt_items WHERE prompt_id=?').get(saved.promptId), personalBefore);
    assert.equal(sqlite.db.prepare('SELECT prompt_id FROM image_studio_reference_favorites WHERE source_id=? AND item_id=?').get('s', 's:0').prompt_id, saved.promptId);
  });
}
main().catch((error) => { console.error(error.stack); if (!results.some((item) => item.status === 'FAIL')) results.push({ status: 'FAIL', error: error.stack }); }).finally(async () => { await client?.close(); if (server) await new Promise((resolve) => server.close(resolve)); managementDb?.close(); sqlite?.close(); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实Electron/SQLite/管理授权签名/资源HTTP/客户端；合成上游，非两应用完整UI验收', results }, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); app.exit(results.some((item) => item.status === 'FAIL') ? 1 : 0); });
