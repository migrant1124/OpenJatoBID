const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { app } = require('electron');
const sharp = require('sharp');
const evidenceRoot = path.resolve(__dirname, '../.tmp/ppt184-resource-center/business-electron');
fs.mkdirSync(evidenceRoot, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidenceRoot, '隔离数据-')));
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 120000);
const results = [];
async function check(name, action) { try { await action(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
const deferred = () => { let resolve; const promise = new Promise((value) => { resolve = value; }); return { promise, resolve }; };
async function main() {
  await app.whenReady();
  const sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  const { createPptProjectStore } = require('../electron/services/pptProjectStore.cjs');
  const { createPptService } = require('../electron/services/pptService.cjs');
  const { hash } = require('../electron/services/pptTemplateService.cjs');
  const store = createPptProjectStore({ db: sqlite.db });
  // 本层只验证真实 Electron/SQLite/文件事务；不以模拟运行器冒认 SDK、模板或模型验收。
  const service = createPptService({ app, store, runtime: { status: () => ({ complete: false, message: '业务隔离夹具' }), close: async () => {} },
    resources: {}, skills: {}, agentService: {}, configStore: { load: () => ({}) }, dialog: {}, shell: { trashItem: async () => { throw new Error('本夹具禁止真实回收站操作'); } } });
  const parent = fs.mkdtempSync(path.join(evidenceRoot, '项目父目录-'));
  const value = service.create({ parent, title: '合成业务回归', requirements: { aspectRatio: '4:3' } });
  const slideId = crypto.randomUUID(), sourcePath = 'svg_output/slide01.svg';
  const initial = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720"><rect width="960" height="720" fill="white"/><text id="title" x="80" y="100" font-size="32">合成旧标题</text></svg>';
  fs.writeFileSync(path.join(value.root, sourcePath), initial, 'utf8');
  store.replacePages(value.projectId, [{ slideId, sourcePath, hash: hash(initial), kind: 'generate' }]);
  await sharp(Buffer.from(initial)).png().toFile(path.join(value.root, `svg_final/${slideId}.png`));
  const waitJob = async (jobId) => { for (let i = 0; i < 500; i++) { const job = store.jobs(value.projectId).find((job) => job.jobId === jobId); if (job && job.status !== 'running') return job; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('后台任务没有结算'); };
  await check('真实 Electron SQLite v41、中文路径及稳定页面 ID', () => { assert.equal(sqlite.schemaVersion, 41); assert.equal(service.get(value.projectId).pages[0].slideId, slideId); });
  await check('直接编辑取消在预览之后仍不提交；运行期间写锁', async () => {
    const reached = deferred(), release = deferred(), original = sharp.prototype.toFile;
    sharp.prototype.toFile = async function (...args) { const result = await original.apply(this, args); reached.resolve(); await release.promise; return result; };
    try {
      const result = service.edit({ projectId: value.projectId, revision: 0, slideId, elementId: 'title', text: '不得保存的候选' });
      await reached.promise;
      assert.throws(() => service.rename({ projectId: value.projectId, revision: 0, title: '不允许并写' }), /只读/);
      service.cancel(value.projectId); release.resolve();
      assert.equal((await waitJob(result.jobId)).status, 'cancelled');
      assert.equal(service.get(value.projectId).revision, 0);
      assert.equal(fs.readFileSync(path.join(value.root, sourcePath), 'utf8'), initial);
    } finally { sharp.prototype.toFile = original; release.resolve(); }
  });
  await check('成功编辑产生历史；恢复旧版移除新版独有顶层文件', async () => {
    const edit = service.edit({ projectId: value.projectId, revision: 0, slideId, elementId: 'title', text: '新标题' });
    assert.equal((await waitJob(edit.jobId)).status, 'completed');
    fs.writeFileSync(path.join(value.root, 'spec_lock.md'), '仅新修订拥有', 'utf8');
    const restore = service.restore({ projectId: value.projectId, revision: 1, historyRevision: 0 });
    assert.equal((await waitJob(restore.jobId)).status, 'completed');
    assert.equal(fs.existsSync(path.join(value.root, 'spec_lock.md')), false);
    assert.equal(fs.readFileSync(path.join(value.root, sourcePath), 'utf8'), initial);
    assert.equal(service.get(value.projectId).pages[0].slideId, slideId);
  });
  await check('当前页面被修改后仍可从有效历史恢复', async () => {
    fs.writeFileSync(path.join(value.root, sourcePath), '外部损坏的合成夹具', 'utf8');
    const restore = service.restore({ projectId: value.projectId, revision: 2, historyRevision: 0 });
    assert.equal((await waitJob(restore.jobId)).status, 'completed');
    assert.equal(fs.readFileSync(path.join(value.root, sourcePath), 'utf8'), initial);
  });
  await check('提交目录翻转中断时 journal 恢复原版', () => {
    const candidate = path.join(value.root, 'candidates', crypto.randomUUID()), history = path.join(value.root, 'history', crypto.randomUUID());
    fs.mkdirSync(candidate); fs.mkdirSync(history);
    fs.renameSync(path.join(value.root, 'svg_output'), path.join(history, 'svg_output'));
    fs.mkdirSync(path.join(value.root, 'svg_output')); fs.writeFileSync(path.join(value.root, sourcePath), '中断的新版', 'utf8');
    sqlite.db.prepare('INSERT INTO ppt_commit_journal VALUES (?, ?, ?, ?, ?)').run(value.projectId, 3, candidate, history, JSON.stringify([{ name: 'svg_output', existed: true }]));
    store.recoverCommits();
    assert.equal(fs.readFileSync(path.join(value.root, sourcePath), 'utf8'), initial);
    assert.equal(sqlite.db.prepare('SELECT COUNT(*) AS n FROM ppt_commit_journal').get().n, 0);
  });
  await check('异步项目迁移持有写锁；取消保留原索引', async () => {
    const reached = deferred(), release = deferred(), original = fs.promises.cp;
    fs.promises.cp = async (...args) => { reached.resolve(); await release.promise; return original(...args); };
    try {
      const target = fs.mkdtempSync(path.join(evidenceRoot, '迁移目标-'));
      const migration = service.relocate({ projectId: value.projectId, revision: 3, parent: target, confirmed: true });
      const rejected = assert.rejects(migration, /取消/);
      await reached.promise;
      assert.throws(() => service.edit({ projectId: value.projectId, revision: 3, slideId, elementId: 'title', text: '并写' }), /只读/);
      service.cancel(value.projectId); release.resolve(); await rejected;
      assert.equal(service.get(value.projectId).root, value.root);
      assert.equal(service.get(value.projectId).revision, 3);
    } finally { fs.promises.cp = original; release.resolve(); }
  });
  await check('成功迁移 hash、历史路径及失联盘保护', async () => {
    const target = fs.mkdtempSync(path.join(evidenceRoot, '成功迁移-'));
    const moved = await service.relocate({ projectId: value.projectId, revision: 3, parent: target, confirmed: true });
    assert.equal(hash(fs.readFileSync(path.join(moved.root, sourcePath))), hash(initial));
    assert.ok(fs.existsSync(value.root));
    for (const row of sqlite.db.prepare('SELECT folder FROM ppt_history WHERE project_id = ?').all(value.projectId)) assert.ok(row.folder.startsWith(moved.root));
    fs.renameSync(moved.root, `${moved.root}-暂失联`);
    assert.throws(() => service.rename({ projectId: value.projectId, revision: 4, title: '不能写' }), /失联/);
    assert.equal(fs.existsSync(moved.root), false);
    fs.renameSync(`${moved.root}-暂失联`, moved.root);
  });
  await service.close(); sqlite.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(evidenceRoot, 'evidence.json'), JSON.stringify({ layer: '真实 Electron/SQLite/文件业务；运行器模拟，未调用模型', versions: process.versions, results }, null, 2), 'utf8');
  console.log(JSON.stringify(results)); clearTimeout(deadline); app.exit(process.exitCode || 0);
});
