const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { app } = require('electron'), AdmZip = require('adm-zip');
const evidenceRoot = path.resolve(__dirname, '../.tmp/ppt184-resource-center/skill-business'); fs.mkdirSync(evidenceRoot, { recursive: true });
const root = fs.mkdtempSync(path.join(evidenceRoot, '隔离-')); app.setPath('userData', path.join(root, '数据')); app.disableHardwareAcceleration();
const results = []; let sqlite;
async function check(name, callback) { try { await callback(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
async function main() {
  await app.whenReady(); sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  const runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({ app });
  const api = require('../electron/services/pptSkillService.cjs').createPptSkillService({ db: sqlite.db, root: path.join(root, '安装副本'), runtime, resources: {} });
  const original = path.join(root, '用户原件'); fs.mkdirSync(original);
  const body = '---\nname: local-ppt-test\ndescription: 合成PPT方法\nversion: 1\nlicense: MIT\n---\n\n# 方法\n只读取已确认资料。\n';
  fs.writeFileSync(path.join(original, 'SKILL.md'), body, 'utf8');
  await check('有效单文件/完整文件夹识别安装；实际Pi SDK读取元数据；hash幂等', async () => {
    for (const file of [path.join(original, 'SKILL.md'), original]) { const candidate = await api.identify({ path: file }); assert.equal(candidate.candidates[0].status, 'workflow_only'); assert.equal(candidate.candidates[0].license, 'MIT'); api.install({ candidateId: candidate.candidateId, hashes: candidate.candidates.map((item) => item.contentHash), confirmed: true }); }
    assert.equal(api.list().length, 1); assert.equal(fs.readFileSync(path.join(original, 'SKILL.md'), 'utf8'), body);
  });
  await check('普通Markdown必须真实整理确认；原文件不改', async () => {
    const file = path.join(root, '普通.md'); fs.writeFileSync(file, '# 中文方法', 'utf8');
    assert.equal((await api.identify({ path: file })).needsNormalization, true);
    const value = await api.identify({ path: file, normalize: { name: 'normalized-ppt', description: '个人方法', confirmed: true } });
    api.install({ candidateId: value.candidateId, hashes: value.candidates.map((item) => item.contentHash), confirmed: true }); assert.equal(fs.readFileSync(file, 'utf8'), '# 中文方法');
  });
  await check('多技能ZIP自动识别、一次选择一项；不执行脚本', async () => {
    const zip = new AdmZip(); zip.addFile('外层/one/SKILL.md', Buffer.from(body.replace('local-ppt-test', 'zip-ppt-one'))); zip.addFile('外层/two/SKILL.md', Buffer.from(body.replace('local-ppt-test', 'zip-ppt-two')));
    const file = path.join(root, '多技能.zip'); zip.writeZip(file); const value = await api.identify({ path: file }); assert.equal(value.candidates.length, 2);
    api.install({ candidateId: value.candidateId, hashes: [value.candidates[0].contentHash], confirmed: true }); assert(!api.list().some((item) => item.contentHash === value.candidates[1].contentHash));
  });
  await check('缺相对依赖与生命周期脚本在安装前阻止', async () => {
    fs.writeFileSync(path.join(original, 'SKILL.md'), `${body}\n[依赖](references/missing.md)`, 'utf8'); const value = await api.identify({ path: original }); assert(value.candidates[0].missing.includes('references/missing.md')); assert.throws(() => api.install({ candidateId: value.candidateId, hashes: value.candidates.map((item) => item.contentHash), confirmed: true }), /缺少/);
    api.discard({ candidateId: value.candidateId });
    fs.writeFileSync(path.join(original, 'package.json'), JSON.stringify({ scripts: { install: '恶意安装命令' } }), 'utf8'); await assert.rejects(api.identify({ path: original }), /生命周期/);
    assert.equal(fs.readdirSync(path.join(root, '安装副本', 'candidates')).length, 0);
  });
  await check('卸载只操作版本副本，用户原件和其他版本保留', async () => {
    const target = api.list().find((item) => item.name === 'local-ppt-test'); api.remove({ hashes: [target.contentHash], confirmed: true }); assert(!fs.existsSync(target.root)); assert(fs.existsSync(path.join(original, 'SKILL.md'))); assert.equal(api.list().length, 2);
  });
  await check('被引用版本默认保留、恢复启用；技能迁移复制/hash后切换、旧副本保留、失联不分叉', async () => {
    const target = api.list()[0], projects = require('../electron/services/pptProjectStore.cjs').createPptProjectStore({ db: sqlite.db }), project = projects.create({ parent: root, title: '锁定技能的隔离项目' });
    sqlite.db.prepare('UPDATE ppt_projects SET resource_json=? WHERE project_id=?').run(JSON.stringify({ skillHash: target.contentHash, skillRoot: target.root }), project.projectId);
    api.remove({ hashes: [target.contentHash], confirmed: true }); assert.equal(api.active(target.contentHash, true).status, 'retained'); assert(fs.existsSync(target.root)); assert.throws(() => api.active(target.contentHash), /停用/);
    api.enable({ contentHash: target.contentHash, enabled: true }); assert.equal(api.active(target.contentHash).enabled, 1);
    const moved = await api.configure({ parent: root, confirmed: true }); assert.notEqual(api.active(target.contentHash).root, target.root); assert(fs.existsSync(target.root)); assert.equal(api.directoryHash(api.active(target.contentHash).root), target.contentHash);
    assert(projects.project(project.projectId).resource.skillRoot.startsWith(moved.root));
    fs.renameSync(moved.root, `${moved.root}-失联`); const reopened = require('../electron/services/pptSkillService.cjs').createPptSkillService({ db: sqlite.db, root: path.join(root, '不应创建'), runtime, resources: {} });
    await assert.rejects(reopened.identify({ path: original }), /失联/); assert.equal(fs.existsSync(moved.root), false); assert.equal(fs.existsSync(path.join(root, '不应创建')), false); fs.renameSync(`${moved.root}-失联`, moved.root);
  });
  await check('仅历史/已删除项目引用的技能仍保留；恢复历史可读取固定版本', async () => {
    const file = path.join(root, '历史技能.md'); fs.writeFileSync(file, body.replace('local-ppt-test', 'history-only-ppt'));
    const candidate = await api.identify({ path: file }); api.install({ candidateId: candidate.candidateId, hashes: candidate.candidates.map((item) => item.contentHash), confirmed: true });
    const target = api.list().find((item) => item.name === 'history-only-ppt');
    const store = require('../electron/services/pptProjectStore.cjs').createPptProjectStore({ db: sqlite.db });
    const service = require('../electron/services/pptService.cjs').createPptService({ app, store, runtime, skills: api, resources: {}, agentService: {}, exporter: {}, dialog: {}, shell: {}, configStore: { load: () => ({}) } });
    let project = service.create({ parent: root, title: '历史锁定版本' }); project = service.selectSkillVersion({ projectId: project.projectId, revision: project.revision, contentHash: target.contentHash });
    project = await service.setPlan({ projectId: project.projectId, revision: project.revision, plan: { pages: [{ slideId: require("node:crypto").randomUUID(), title: "仅用于历史记录" }] } });
    project = service.selectSkillVersion({ projectId: project.projectId, revision: project.revision, contentHash: '' });
    sqlite.db.prepare("UPDATE ppt_projects SET deleted_at='隔离删除记录' WHERE project_id=?").run(project.projectId);
    api.remove({ hashes: [target.contentHash], confirmed: true }); assert.equal(api.active(target.contentHash, true).status, 'retained'); assert(fs.existsSync(target.root)); assert.throws(() => api.active(target.contentHash), /停用/);
    assert(api.storage().projects.some((item) => item.projectId === project.projectId)); await service.close();
  });
  await check('GitHub申请聚合105个就绪包，按ID读取不受首100条分页限制', async () => {
    const ids = Array.from({ length: 105 }, (_, index) => `ready-${index}`), packages = new Map();
    for (const id of ids) { const zip = new AdmZip(), file = path.join(root, `${id}.zip`); zip.addFile('SKILL.md', Buffer.from(body.replace('local-ppt-test', id))); zip.writeZip(file); packages.set(id, file); }
    let reads = 0;
    const repositoryApi = require('../electron/services/pptSkillService.cjs').createPptSkillService({ db: sqlite.db, root: path.join(root, '仓库副本'), runtime, resources: {
      repositoryStatus: async () => ({ status: 'ready', result: { resourceIds: ids } }), sync: async () => {},
      list: async () => { throw new Error('不应搜索资源首分页'); },
      getItem: async (resourceId) => { reads += 1; return { resourceId, assets: [{ role: 'package', assetId: resourceId }] }; },
      loadAsset: async ({ resourceId }) => ({ filePath: packages.get(resourceId) }),
    } });
    const found = await repositoryApi.identify({ requestId: '模拟管理端真实结果合同' }); assert.equal(found.candidates.length, 105); assert.equal(reads, 105);
    repositoryApi.install({ candidateId: found.candidateId, hashes: [found.candidates[104].contentHash], confirmed: true }); assert(repositoryApi.list().some((item) => item.name === 'ready-104'));
  });
}
main().catch((error) => { console.error(error.stack); if (!results.some((item) => item.status === 'FAIL')) results.push({ status: 'FAIL', error: error.stack }); }).finally(() => { sqlite?.close(); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(results, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); app.exit(results.some((item) => item.status === 'FAIL') ? 1 : 0); });
