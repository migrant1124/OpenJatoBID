const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');

const clientDir = path.resolve(__dirname, '..');
const outputDir = path.resolve(process.argv[2] || path.join(clientDir, '.tmp', 'pi184-upgrade', 'electron'));
const asarArg = process.argv.indexOf('--package-asar');
const asar = asarArg < 0 ? '' : path.resolve(process.argv[asarArg + 1]);
fs.mkdirSync(outputDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(outputDir, '隔离-userData-'));
assert.ok(path.isAbsolute(userData) && userData.startsWith(`${outputDir}${path.sep}`));
// 必须在加载任何业务服务或 Store 之前隔离实际 Electron userData。
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const deadline = setTimeout(() => { console.error('Pi Electron 验证超过总时限'); app.exit(1); }, 120000);
const { createFixture, normalScenario, toolChain, call, delay } = require('./pi-upgrade-fixture.cjs');

async function main() {
  let fixture;
  const evidence = { layer: asar ? 'L4-包内依赖在真实Electron中' : 'L3-真实ElectronMain', app_version: require('../package.json').version,
    versions: process.versions, platform: process.platform, arch: process.arch, isolated: app.getPath('userData') === userData,
    supplier: '仅本地模拟供应商', installer: 'NOT_RUN', external_model: 'NOT_RUN', checks: [] };
  try {
    await app.whenReady();
    let testApp = app;
    if (asar) {
      assert.ok(fs.existsSync(asar));
      // 外置测试入口只改变隔离夹具的资源根；生产授权及启动入口不修改。
      Object.defineProperty(process, 'resourcesPath', { value: path.dirname(asar) });
      assert.equal(process.resourcesPath, path.dirname(asar));
      testApp = new Proxy(app, { get(target, name) {
        if (name === 'isPackaged') return true;
        if (name === 'getPath') return (key) => key === 'exe' ? path.resolve(path.dirname(asar), '..', 'Jato AI BID.exe') : app.getPath(key);
        if (name === 'getAppPath') return () => asar;
        const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    const services = asar ? path.join(asar, 'electron', 'services') : path.join(clientDir, 'electron', 'services');
    const resolveBase = require('node:url').pathToFileURL(path.join(services, 'pi', 'piSessionFactory.cjs'));
    evidence.sdk_entries = Object.fromEntries(['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', 'typebox'].map((name) => [name, require('node:module').findPackageJSON(name, resolveBase)]));
    if (asar) for (const entry of Object.values(evidence.sdk_entries)) assert.ok(entry.startsWith(`${asar}${path.sep}`), `SDK 必须从包内解析：${entry}`);
    fixture = await createFixture({ electronApp: testApp, moduleRoot: asar ? path.join(asar, 'electron', 'services') : undefined,
      parentDir: outputDir, handler: toolChain });
    const normal = await normalScenario(fixture);
    evidence.snapshot = normal.result.diagnostics.session;
    evidence.checks.push('真实SDK/Proxy/工具/产物/监视事件');
    const { runtime } = fixture.runtime();
    fixture.handler = async (body, res) => {
      let result;
      if (body.tools?.some((tool) => tool.function.name === 'diagnostic_echo')) result = { calls: [call('diagnostic_echo', { value: 'YIBIAO_PI_TOOL_OK' })] };
      else if (!body.tools?.some((tool) => tool.function.name === 'read')) result = { text: 'OK' };
      else {
        const last = body.messages.at(-1);
        if (last.role !== 'tool') result = { calls: [call('read', { path: 'self-check-input.txt' }, '自检读取')] };
        else if (last.tool_call_id === '自检读取') result = { calls: [call('bash', { command: 'node -e "console.log(\'YIBIAO_PI_NODE_OK\')"' }, '自检命令')] };
        else if (last.tool_call_id === '自检命令') result = { calls: [call('write', { path: 'agent-self-check-result.json', content: JSON.stringify({ message: 'YIBIAO_PI_AGENT_SELF_CHECK_OK', input: 'YIBIAO_PI_AGENT_SELF_CHECK_INPUT', node: 'YIBIAO_PI_NODE_OK' }) }, '自检写入')] };
        else if (last.tool_call_id === '自检写入') result = { calls: [call('json-validation', { file_path: 'agent-self-check-result.json' }, '自检校验')] };
        else result = { text: '合成自检完成' };
      }
      require('./pi-upgrade-fixture.cjs').respond(res, body, result);
    };
    const selfCheck = await runtime.runSelfCheck();
    fs.writeFileSync(path.join(outputDir, '自检结果.json'), JSON.stringify(selfCheck, null, 2), 'utf8');
    assert.equal(selfCheck.success, true, selfCheck.message);
    assert.equal(selfCheck.sdk_version, '1.0.0');
    evidence.checks.push('真实自检、版本、资源与命令环境');
    evidence.child_node = selfCheck.tool_check.items.find((item) => item.id === 'node');
    const { createSqliteDatabase } = require(path.join(services, 'sqliteDatabase.cjs'));
    const { createConversationStore } = require(path.join(services, 'conversationStore.cjs'));
    const sqlite = createSqliteDatabase(testApp);
    const store = createConversationStore({ db: sqlite.db });
    const thread = store.createThread(); store.renameThread(thread.threadId, '合成历史对话');
    assert.ok(store.listThreads().some((item) => item.title === '合成历史对话')); sqlite.close();
    const reopened = createSqliteDatabase(testApp); const restored = createConversationStore({ db: reopened.db });
    assert.ok(restored.listThreads().some((item) => item.title === '合成历史对话')); reopened.close();
    evidence.checks.push('隔离SQLite合成对话跨关闭回读');
    let toolStarted;
    const started = new Promise((resolve) => { toolStarted = resolve; });
    fixture.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { calls: [call('bash', { command: 'node -e "setTimeout(()=>require(\'fs\').writeFileSync(\'退出迟到.txt\',\'错误\'),1500)"' })] });
    const closing = fixture.runtime({ onMonitorEvent(event) { if (event.type === 'tool_start') toolStarted(); } }).runtime;
    let settled = false;
    const pending = closing.runTask({ max_retries: 0 }).then(() => { throw new Error('取消不应成功'); }, () => { settled = true; });
    await Promise.race([started, delay(5000).then(() => { throw new Error('未观察到关闭测试工具启动'); })]);
    await closing.close(); assert.equal(settled, true); await pending;
    assert.equal(closing.getStatus().active_task, null);
    await delay(1800); assert.equal(fs.existsSync(path.join(fixture.environment.layout.workspaceDir, '退出迟到.txt')), false);
    evidence.checks.push('真实Electron运行中关闭、工具结算与无迟到写入');
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = error.stack || error.message;
    console.error(evidence.error);
  } finally {
    if (fixture) await fixture.close().catch((error) => { evidence.status = 'FAIL'; evidence.cleanup_error = error.message; });
    fs.writeFileSync(path.join(outputDir, 'electron-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    clearTimeout(deadline); console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks, outputDir })); app.exit(evidence.status === 'PASS' ? 0 : 1);
  }
}
main();
