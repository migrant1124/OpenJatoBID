// 真实公开GitHub固定提交 -> 管理端审批/镜像 -> 授权HTTP -> 员工识别安装；独立数据，无第三方脚本执行。
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { app } = require('electron');
const base = path.resolve(__dirname, '../.tmp/ppt184-resource-center/repository'); fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, '公开固定版-')); app.setPath('userData', path.join(root, '员工数据')); app.disableHardwareAcceleration();
const results = [], requests = []; let sqlite, manager, server, center, client, runtime;
const resume = process.argv.includes('--resume-r3') ? path.join(base, '公开固定版-w6cxoX') : null;
const management = (name) => require(path.resolve(__dirname, '../../management/electron/services', name));
async function main() {
  await app.whenReady(); sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  if (resume) { fs.copyFileSync(path.join(resume, '独立管理.sqlite'), path.join(root, '独立管理.sqlite')); fs.cpSync(path.join(resume, '管理镜像'), path.join(root, '管理镜像'), { recursive: true }); }
  manager = new (require('better-sqlite3'))(path.join(root, '独立管理.sqlite')); management('migrations.cjs').migrateDatabase(manager);
  const signing = management('signingService.cjs').createSigningService({ database: manager });
  const auth = management('authorizationService.cjs').createAuthorizationService({ database: manager, signingService: signing });
  const employee = { name: '链接回归员工', phone: '13800000000', deviceFingerprint: 'repository-fixture-device', clientId: 'repository-fixture-client', platform: 'win32', arch: 'x64' }; if (!resume) auth.approveApplication(auth.submitApplication(employee).id); const license = auth.login(employee).license;
  center = management('resourceCenterService.cjs').createResourceCenterService({ database: manager, signingService: signing, defaultRoot: path.join(root, '管理镜像'), fetchImpl: async (url, options) => { requests.push({ url: String(url), role: '管理上游' }); return fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(120000) }); } });
  if (resume) manager.prepare('UPDATE resource_sources SET enabled=0').run();
  await center.start(); server = http.createServer(management('httpRouter.cjs').createHttpRouter({ getServiceInfo: () => ({}), resourceRouter: center.route })); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const serverAddress = `http://127.0.0.1:${server.address().port}`;
  const store = require('../electron/services/resourceCacheStore.cjs').createResourceCacheStore({ db: sqlite.db });
  client = require('../electron/services/resourceClientService.cjs').createResourceClientService({ app, store, licenseService: { getResourceIdentity: async () => ({ ...employee, serverAddress, license, employeeId: license.payload.employeeId, publicKey: signing.getPublicKey() }) }, fetchImpl: async (url, options) => { assert(String(url).startsWith(serverAddress)); requests.push({ url: String(url), role: '员工局域网' }); try { return await require('undici').fetch(url, options); } catch (error) { console.error(JSON.stringify({ url: String(url), message: error.message, cause: error.cause?.stack })); throw error; } } });
  runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({ app }); await runtime.verify();
  const skills = require('../electron/services/pptSkillService.cjs').createPptSkillService({ db: sqlite.db, root: path.join(root, '员工安装副本'), resources: client, runtime });
  const commit = '44c10ed0bc3a9e1df7a25aa179ae7c26db09469b';
  const request = resume ? { repository: { requestId: manager.prepare("SELECT request_id FROM resource_repository_requests WHERE status='ready'").get().request_id } } : await skills.identify({ repositoryUrl: `https://github.com/hugohe3/ppt-master/tree/${commit}` });
  if (!resume) { assert.equal(request.repository.status, 'awaiting_admin'); assert.equal(requests.filter((item) => item.role === '管理上游').length, 0); results.push({ name: '真实申请在管理员批准前不下载', status: 'PASS' }); }
  else results.push({ name: '接续r3实际公开审批和已镜像完整包；复制隔离数据，不模拟供应商', status: 'PASS', from: resume });
  try { if (!resume) await center.repositoryDecision({ requestId: request.repository.requestId, approve: true }); }
  catch (error) { results.push({ name: '真实公开GitHub固定提交完整包获取', status: /fetch failed|timeout|ENOTFOUND|网络|HTTP 4|HTTP 5/i.test(error.message) ? 'BLOCKED' : 'FAIL', error: error.stack }); throw error; }
  const status = await client.repositoryStatus(request.repository.requestId); assert.equal(status.status, 'ready'); assert.equal(status.result.commit, commit); results.push({ name: '真实GitHub树/完整包成员hash校验及管理审批发布', status: 'PASS', commit });
  const found = await skills.identify({ requestId: request.repository.requestId }); assert(found.candidates.length); assert(found.candidates.every((item) => !item.missing.length));
  const installed = skills.install({ candidateId: found.candidateId, hashes: found.candidates.map((item) => item.contentHash), confirmed: true }); assert.equal(installed.installed.length, found.candidates.length); assert(skills.list().every((item) => fs.existsSync(path.join(item.root, 'SKILL.md'))));
  results.push({ name: '员工仅局域网获取完整固定包，真实SDK识别并明确安装，不自动执行', status: 'PASS', candidates: found.candidates.map(({ contentHash, status, permissions }) => ({ contentHash, status, permissions })) });
  fs.writeFileSync(path.join(root, 'network.json'), JSON.stringify(requests, null, 2), 'utf8');
}
main().catch((error) => { console.error(error.stack); if (!results.some((item) => ['FAIL','BLOCKED'].includes(item.status))) results.push({ name: '真实链接回归', status: 'FAIL', error: error.stack }); }).finally(async () => { await client?.close(); await center?.stop(); if (server) await new Promise((resolve) => server.close(resolve)); manager?.close(); sqlite?.close(); fs.writeFileSync(path.join(root, 'network.json'), JSON.stringify(requests, null, 2), 'utf8'); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实公开资源网络/SDK/Electron业务；无UI、无模型或第三方脚本执行', results }, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); app.exit(results.some((item) => item.status !== 'PASS') ? 1 : 0); });
