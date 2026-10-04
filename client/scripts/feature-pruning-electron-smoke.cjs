const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const AdmZip = require('adm-zip');

const outputDir = path.resolve(process.argv[2]);
const baseline = process.argv.includes('--baseline');
const login = process.argv.includes('--login');
const userData = process.env.JATO_FP_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'jato-fp-userdata-'));
const wrapper = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-fp-app-'));
const packageJson = require('../package.json');
const templateName = `本轮合成模板-${Date.now()}`;
const editedTemplateName = `${templateName}-已编辑`;
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({ name: packageJson.name, version: packageJson.version,
  main: path.join(__dirname, 'feature-pruning-electron-harness.cjs') }), 'utf8');

async function main() {
  let electron;
  const evidence = { baseline, login, userData, packageVersion: packageJson.version, pages: [], errors: [], visibleErrors: [], requests: [] };
  try {
    electron = await _electron.launch({ executablePath: require('electron'), args: [wrapper], cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, YIBIAO_REQUIRE_LAN_LICENSE: login ? '1' : '0', JATO_FP_USERDATA: userData,
        JATO_FP_OUTPUT: outputDir, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' } });
    electron.process().stderr.on('data', (chunk) => fs.appendFileSync(path.join(outputDir, 'main-stderr.log'), chunk));
    evidence.runtime = await electron.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), electron: process.versions.electron }));
    assert.equal(path.resolve(evidence.runtime.userData), path.resolve(userData));
    assert.equal(evidence.runtime.version, packageJson.version);
    const win = await electron.firstWindow();
    // 合成回归不依赖公网公告，避免已确认的远程弹窗挡住菜单操作。
    await win.context().route('**/remote-notice.json?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    win.setDefaultTimeout(10000);
    win.on('pageerror', (error) => evidence.errors.push(error.message));
    win.on('request', (request) => evidence.requests.push(request.url()));
    const snapshot = async (name) => {
      const notice = win.getByRole('button', { name: '知道了', exact: true });
      if (await notice.isVisible()) await notice.click();
      const visibleErrors = await win.locator('.app-toast.is-error').allTextContents();
      evidence.visibleErrors.push(...visibleErrors.map((message) => ({ page: name, message })));
      await win.screenshot({ path: path.join(outputDir, `${name}.png`) });
      evidence.pages.push({ name, text: (await win.locator('body').innerText()).slice(0, 1400),
        metrics: await win.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })) });
      assert.deepEqual(visibleErrors, [], `${name} 不应显示错误提示`);
    };
    if (login) {
      await win.getByRole('heading', { name: '员工登录', exact: true }).waitFor({ timeout: 30000 });
      await win.getByText(`内部专用 · 版本 ${packageJson.version}`, { exact: true }).waitFor();
      await snapshot('login-version');
      assert.deepEqual(evidence.errors, []);
      return;
    }
    await win.getByRole('navigation', { name: '主菜单' }).waitFor({ timeout: 30000 });
    const labels = ['标书生成', '对话模式', '生图模式', '模板设置', '知识库', '标书检查'];
    assert.deepEqual(await win.locator('.sidebar-nav button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))), labels);
    await snapshot('ordinary-wide');
    for (const label of labels) {
      await win.getByRole('button', { name: label, exact: true }).click();
      await win.locator('.content-shell > *').first().waitFor({ timeout: 5000 });
      await snapshot(`page-${label}`);
    }
    for (const [parent, child, selector] of [
      ['标书生成', '生成技术方案', '.technical-project-list'],
      ['标书生成', '已有方案扩写', '.technical-project-list'],
      ['知识库', '文档知识库', '.knowledge-page'],
      ['标书检查', '标书查重', '.duplicate-check-page'],
      ['标书检查', '废标项检查', '.rejection-check-page'],
    ]) {
      await win.getByRole('button', { name: parent, exact: true }).click();
      await win.locator('.secondary-menu-row').filter({ hasText: child }).click();
      await win.locator(selector).waitFor();
      await snapshot(`business-${child}`);
    }
    await win.getByRole('button', { name: '生图模式', exact: true }).click();
    for (const label of ['提示词中心', '我的作品']) {
      await win.getByRole('navigation', { name: '生图模式页面' }).getByRole('button', { name: label, exact: true }).click();
      await win.locator('.image-studio-page').waitFor();
      await snapshot(`business-${label}`);
    }
    await win.getByRole('button', { name: '收起菜单', exact: true }).click();
    await snapshot('collapsed');
    await win.getByRole('button', { name: '展开菜单', exact: true }).click();
    await win.getByRole('button', { name: '设置', exact: true }).click();
    await win.getByRole('tab', { name: '关于', exact: true }).click();
    await win.getByText(`当前版本 ${packageJson.version}`, { exact: true }).waitFor();
    await snapshot('about-version');
    evidence.developerFixture = await win.evaluate(async () => {
      const project = await window.yibiao.technicalPlan.createProject({ name: '合成开发者正文' });
      await window.yibiao.technicalPlan.saveOutline({ outline: [{ id: '1', title: '合成开发者章节', level: 1, children: [] }] });
      await window.yibiao.technicalPlan.saveChapterContent({ nodeId: '1', content: '合成当前正文，用于开发者读取与精确替换测试，不调用模型。' });
      return { projectId: project.project.id, state: await window.yibiao.technicalPlan.loadState() };
    });
    assert.match(evidence.developerFixture.state.outlineData.outline[0].content, /合成当前正文/);
    await win.getByRole('tab', { name: '通用', exact: true }).click();
    const developerRow = win.locator('.settings-row').filter({ has: win.locator('strong', { hasText: /^开发者模式$/ }) });
    const developerToggle = developerRow.getByRole('checkbox');
    assert.equal(await developerToggle.isChecked(), false);
    await developerRow.getByText('开发者模式', { exact: true }).click();
    assert.equal(await developerToggle.isChecked(), true);
    await win.getByRole('button', { name: '保存', exact: true }).click();
    await win.getByText('配置已保存', { exact: true }).waitFor();
    await win.getByRole('button', { name: '测试页', exact: true }).click();
    const developerLabels = ['Json请求测试', '扩写替换测试', 'Pi Agent监视器', '系统诊断'];
    const actual = await win.locator('.secondary-menu-row strong').allTextContents();
    assert.deepEqual(actual, baseline ? ['Json请求测试', 'Prompt调试台', '文件解析沙盘', '导出链路预演', ...developerLabels.slice(1)] : developerLabels);
    await snapshot('developer-menu');
    for (const label of developerLabels) {
      await win.getByRole('button', { name: '测试页', exact: true }).click();
      await win.locator('.secondary-menu-row').filter({ hasText: label }).click();
      await win.getByRole('heading', { name: label === 'Pi Agent监视器' ? 'Pi Agent 链路测试' : label, exact: true }).waitFor();
      if (label === '扩写替换测试') await win.getByRole('option', { name: /合成开发者章节/ }).waitFor({ state: 'attached' });
      await snapshot(`developer-${label}`);
    }
    await win.getByRole('button', { name: '设置', exact: true }).click();
    await win.getByRole('tab', { name: '通用', exact: true }).click();
    assert.equal(await developerToggle.isChecked(), true);
    await developerRow.getByText('开发者模式', { exact: true }).click();
    assert.equal(await developerToggle.isChecked(), false);
    await win.getByRole('button', { name: '测试页', exact: true }).waitFor({ state: 'detached' });
    await win.getByRole('button', { name: '保存', exact: true }).click();
    await win.getByText('配置已保存', { exact: true }).waitFor();
    evidence.developerModeAfterDisable = await win.evaluate(async () => (await window.yibiao.config.load()).developer_mode);
    assert.equal(evidence.developerModeAfterDisable, false);
    assert.deepEqual(await win.locator('.sidebar-nav button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))), labels);
    await snapshot('developer-disabled');
    evidence.templatesBefore = await win.evaluate(() => window.yibiao.templates.list());
    if (!baseline) {
      await win.getByRole('button', { name: '模板设置', exact: true }).click();
      await win.locator('.secondary-menu-row').filter({ hasText: '新建模板' }).click();
      await win.getByRole('tab', { name: '布局设置', exact: true }).click();
      await win.getByLabel('模板名称', { exact: true }).fill(templateName);
      await win.getByRole('button', { name: '保存配置', exact: true }).click();
      await win.getByText('模板已创建', { exact: true }).waitFor();
      await win.getByRole('button', { name: '模板设置', exact: true }).click();
      await win.locator('.secondary-menu-row').filter({ hasText: '我的模板' }).click();
      await win.locator('.template-library-card').filter({ hasText: templateName }).getByRole('button', { name: '编辑', exact: true }).click();
      await win.getByRole('tab', { name: '布局设置', exact: true }).click();
      await win.getByLabel('模板名称', { exact: true }).fill(editedTemplateName);
      await win.locator('.settings-row').filter({ has: win.locator('strong', { hasText: /^页眉$/ }) }).getByRole('checkbox').check();
      await win.getByLabel('页眉文本', { exact: true }).fill('合成模板页眉');
      await win.getByRole('button', { name: '保存配置', exact: true }).click();
      await win.getByRole('button', { name: '返回我的模板', exact: true }).click();
      await win.getByRole('heading', { name: editedTemplateName, exact: true }).waitFor();
      evidence.templatesAfter = await win.evaluate(() => window.yibiao.templates.list());
      const original = evidence.templatesBefore.find((item) => item.template_name === '升级保留合成模板');
      assert.deepEqual(evidence.templatesAfter.find((item) => item.template_id === original.template_id), original);
      await snapshot('template-edited');
      evidence.exportResult = await win.evaluate(async (name) => {
        const template = (await window.yibiao.templates.list()).find((item) => item.template_name === name);
        const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
        return window.yibiao.export.exportWord({ project_name: '合成验证项目', export_format: template.config,
          outline: [{ id: '1', title: '中文技术服务方案', content: `合成正文内容。本项目按合成测试要求形成完整实施记录并交付验收材料。\n\n| 项目 | 说明 |\n| --- | --- |\n| 合成行 | 合成值 |\n\n![合成测试图片](${image})` }] });
      }, editedTemplateName);
      assert.equal(evidence.exportResult.success, true);
      const zip = new AdmZip(evidence.exportResult.path);
      const document = zip.readAsText('word/document.xml');
      assert.match(document, /中文技术服务方案/);
      assert.match(document, /合成正文内容/);
      assert.match(document, /<w:tbl>/);
      assert.ok(zip.getEntries().some((item) => item.entryName.startsWith('word/media/')));
      assert.ok(zip.getEntries().filter((item) => /^word\/header\d+\.xml$/.test(item.entryName)).some((item) => zip.readAsText(item).includes('合成模板页眉')));
      evidence.docx = { bytes: fs.statSync(evidence.exportResult.path).size, table: true, chinese: true, image: true, templateHeader: true };
      // 以两个合成 DOCX 驱动正式本地查重服务，SQLite 仍在隔离 userData 内。
      evidence.duplicateCheck = await electron.evaluate(async ({ app }, input) => {
        const require = process.getBuiltinModule('module').createRequire(`${input.root}/package.json`);
        const fs = require('node:fs');
        const path = require('node:path');
        const copy = path.join(input.outputDir, '合成查重副本.docx');
        fs.copyFileSync(input.filePath, copy);
        const files = [input.filePath, copy].map((filePath, index) => ({ id: `synthetic-${index}`,
          file_path: filePath, file_name: path.basename(filePath), extension: '.docx', size: fs.statSync(filePath).size,
          modified_at: fs.statSync(filePath).mtime.toISOString() }));
        const { createSqliteDatabase } = require(path.join(input.root, 'electron/services/sqliteDatabase.cjs'));
        const { createDuplicateCheckStore } = require(path.join(input.root, 'electron/services/duplicateCheckStore.cjs'));
        const { createDuplicateCheckService } = require(path.join(input.root, 'electron/services/duplicateCheckService.cjs'));
        const sqlite = createSqliteDatabase(app);
        try {
          const workspaceStore = createDuplicateCheckStore({ app, db: sqlite.db });
          const service = createDuplicateCheckService({ app, configStore: { load: () => ({}) }, workspaceStore });
          await service.runAnalysisTask({ workspaceStore, updateTask: (partial) => partial,
            payload: { bidFiles: files, tenderFiles: [], force: true } });
          const state = workspaceStore.loadDuplicateCheck();
          return { status: state.analysisTask.status, metadata: state.metadataAnalysis.status,
            outline: state.outlineAnalysis.status, content: state.contentAnalysis.status, image: state.imageAnalysis.status,
            duplicatedSentences: state.contentAnalysis.duplicateSentences.length };
        } finally { sqlite.close(); }
      }, { filePath: evidence.exportResult.path, outputDir, root: path.resolve(__dirname, '..') });
      assert.equal(evidence.duplicateCheck.status, 'success');
      assert.ok(evidence.duplicateCheck.duplicatedSentences > 0);
    }
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
    await snapshot('narrow');
    evidence.retiredRequests = evidence.requests.filter((url) => /^https:\/\/analytics\.agnet\.top\/resources(?:[?/#]|$)/.test(url));
    assert.deepEqual(evidence.retiredRequests, []);
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.visibleErrors, []);
    // 空模型配置下调用真实 IPC；错误必须可诊断且不影响既有页面。
    evidence.agentConfigFailure = await win.evaluate(async () => {
      try { await window.yibiao.agent.run({ mode: 'conversation', max_retries: 0 }); return ''; }
      catch (error) { return String(error?.message || error); }
    });
    assert.match(evidence.agentConfigFailure, /配置|API|模型/i);
    await win.getByRole('button', { name: '知识库', exact: true }).click();
    await snapshot('agent-config-failure-recovered');
  } finally {
    fs.writeFileSync(path.join(outputDir, 'electron-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    await electron?.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
