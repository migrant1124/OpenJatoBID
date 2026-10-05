// 两个真实 Main/preload/Renderer 的同机授权；只使用合成身份和独立数据，不改变正式登录或开机启动。
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const repository = path.resolve(__dirname, '../..'), client = path.join(repository, 'client'), management = path.join(repository, 'management');
const base = path.join(client, '.tmp/ci184-fix/same-machine'); fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, '隔离-')), applications = [], results = [], errors = [];
let managerPage, employeePage;
async function check(name, action) { try { await action(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
async function capture(name, page) { await page.screenshot({ path: path.join(root, `${name}.png`) }); }
function entry(name, directory, code) {
  const target = path.join(root, name); fs.mkdirSync(target);
  const manifest = require(path.join(directory, 'package.json'));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, main: 'boot.cjs' }));
  fs.writeFileSync(path.join(target, 'boot.cjs'), `const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path');app.setPath('userData',${JSON.stringify(path.join(target, 'userData'))});app.disableHardwareAcceleration();app.setLoginItemSettings=()=>{};dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(1);};\n${code}`, 'utf8');
  return target;
}
async function launch(directory, local) {
  const env = { ...process.env, LOCALAPPDATA: path.join(root, local), YIBIAO_REQUIRE_LAN_LICENSE: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const application = await _electron.launch({ executablePath: path.join(client, 'node_modules/electron/dist/electron.exe'), args: [directory, '--disable-gpu'], env, timeout: 60000 });
  applications.push(application); const page = await application.firstWindow({ timeout: 60000 });
  page.on('pageerror', (error) => errors.push(error.stack)); return page;
}
async function main() {
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  const credentialInput = path.join(root, '合成初始凭据.json'), credential = path.join(root, '合成凭据.cjs');
  fs.writeFileSync(credentialInput, JSON.stringify({ username: 'same-machine-test', password: 'Fixture-Initial-184', credentialVersion: 'isolated-same-machine' }));
  require(path.join(management, 'scripts/prepare-initial-admin-credential.cjs')).prepareInitialAdminCredential({ inputPath: credentialInput, outputPath: credential });
  const managerEntry = entry('管理端', management, `
const Module=require('node:module'),originalLoad=Module._load,credential=require(${JSON.stringify(credential)});
Module._load=function(request,parent,...args){if(request==='better-sqlite3')return originalLoad(${JSON.stringify(path.join(client, 'node_modules/better-sqlite3'))},parent,...args);if(request==='./generated/initialAdminCredential.cjs'&&parent.filename===${JSON.stringify(path.join(management, 'electron/main.cjs'))})return credential;return originalLoad(request,parent,...args);};
const services=${JSON.stringify(path.join(management, 'electron/services'))},data=require(path.join(services,'managementDataService.cjs')).getFixedManagementDataRoot();
const service=require(path.join(services,'databaseService.cjs')).createDatabaseService({databasePath:path.join(data,'management.sqlite3')}),db=service.database;
require(path.join(services,'adminAuthService.cjs')).createAdminAuthService({database:db,initialCredential:credential,allowInitialBootstrap:true});
db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?)').run('server_config',JSON.stringify({host:'0.0.0.0',port:${port}}),new Date().toISOString());
const store=require(path.join(services,'resourceStore.cjs')).createResourceStore({database:db,sources:require(path.join(services,'resourceSourceAdapters.cjs')).DEFAULT_SOURCES});for(const source of store.listSources())store.setEnabled(source.sourceId,false);service.close();
require(${JSON.stringify(path.join(management, 'electron/main.cjs'))});`);
  managerPage = await launch(managerEntry, '管理端Local');
  await check('管理端真实初始登录与强制改密，同机HTTP服务监听', async () => {
    await managerPage.getByPlaceholder('请输入管理员账号').fill('same-machine-test'); await managerPage.getByPlaceholder('请输入管理员密码').fill('Fixture-Initial-184'); await managerPage.getByRole('button', { name: '登录', exact: true }).click();
    await managerPage.getByPlaceholder('请输入新的管理员密码').fill('Fixture-Owner-184'); await managerPage.locator('input[type=password]').nth(1).fill('Fixture-Owner-184'); await managerPage.getByRole('button', { name: /保存|设置|完成/ }).click();
    await managerPage.getByRole('button', { name: '授权管理', exact: true }).waitFor();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`); assert.equal(response.status, 200); await capture('01-管理端登录', managerPage);
  });
  const employeeEntry = entry('客户端', client, `
fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(path.join(app.getPath('userData'),'user_config.json'),JSON.stringify({gpu_hardware_acceleration_enabled:false,gpu_hardware_acceleration_configured:true,developer_mode:false,lan_management:{server_address:'127.0.0.1:${port}'}}),'utf8');
require(${JSON.stringify(path.join(client, 'electron/bootstrap.cjs'))});`);
  employeePage = await launch(employeeEntry, '客户端Local');
  await check('两端真实Electron同时运行，用户数据目录独立', async () => {
    const roots = await Promise.all(applications.map((application) => application.evaluate(({ app }) => ({ userData: app.getPath('userData'), name: app.getName(), electron: process.versions.electron }))));
    assert.notEqual(roots[0].userData, roots[1].userData); assert.notEqual(roots[0].name, roots[1].name);
    fs.writeFileSync(path.join(root, '进程目录.json'), JSON.stringify({ port, host: '0.0.0.0', clientAddress: `127.0.0.1:${port}`, roots }, null, 2));
  });
  await check('客户端通过回环HTTP提交申请，管理员真实审批并登录获签名授权', async () => {
    await employeePage.getByRole('button', { name: /授权申请/ }).click(); const modal = employeePage.getByRole('dialog');
    await modal.getByLabel('姓名', { exact: true }).fill('同机隔离员工'); await modal.getByLabel('手机号', { exact: true }).fill('13800000000'); await modal.getByLabel('服务器 IP', { exact: true }).fill(`127.0.0.1:${port}`); await modal.getByRole('button', { name: '提交授权申请' }).click(); await modal.getByText('等待管理员审批', { exact: true }).waitFor();
    await managerPage.getByRole('button', { name: '授权管理', exact: true }).click(); await managerPage.getByRole('button', { name: '刷新', exact: true }).click(); await managerPage.getByRole('button', { name: /批准/ }).first().click(); await capture('02-管理端审批', managerPage);
    await modal.getByRole('button', { name: '刷新状态' }).click(); await modal.getByRole('button', { name: '返回登录' }).click();
    await employeePage.getByLabel('姓名', { exact: true }).fill('同机隔离员工'); await employeePage.getByLabel('手机号', { exact: true }).fill('13800000000'); await employeePage.getByRole('button', { name: '登录', exact: true }).click();
    await employeePage.getByRole('button', { name: 'PPT 模式', exact: true }).waitFor({ timeout: 60000 });
    const status = await employeePage.evaluate(() => window.yibiao.license.getStatus()); assert.equal(status.status, 'active');
    fs.writeFileSync(path.join(root, '授权状态.json'), JSON.stringify({ status: status.status }, null, 2)); await capture('03-客户端授权后', employeePage);
  });
  assert.equal(errors.length, 0, errors.join('\n'));
}
main().catch(async (error) => { console.error(error.stack); if (!results.some((item) => item.status === 'FAIL')) results.push({ status: 'FAIL', error: error.stack }); if (employeePage) await capture('失败-客户端', employeePage).catch(() => {}); if (managerPage) await capture('失败-管理端', managerPage).catch(() => {}); }).finally(async () => {
  for (const application of applications.reverse()) await application.close().catch(() => {});
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实双端Main/preload/Renderer/HTTP；合成初始凭据、隔离userData/LOCALAPPDATA及同ABI native加载，不是安装包验收', results, errors }, null, 2));
  console.log(JSON.stringify({ root, results })); process.exitCode = results.some((item) => item.status === 'FAIL') ? 1 : 0;
});
