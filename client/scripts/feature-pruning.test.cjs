const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const retired = ['bid-opportunity', 'resources', 'business-bid', 'image-knowledge-base', 'ai-evaluation',
  'developer-prompt-lab', 'developer-parser-sandbox', 'developer-export-preview'];
const primary = ['bid-generation', 'conversation', 'image-studio', 'template-settings', 'knowledge-base', 'bid-check'];
const developers = ['developer-json-test', 'developer-expansion-replace-test', 'developer-pi-agent-monitor', 'developer-system-diagnostics'];
const children = {
  'bid-generation': ['technical-plan', 'existing-plan-expansion'],
  'image-studio': ['image-studio-create', 'image-studio-prompts', 'image-studio-works'],
  'template-settings': ['my-templates', 'new-template'],
  'knowledge-base': ['document-knowledge-base'],
  'bid-check': ['duplicate-check', 'rejection-check'],
  'developer-test': developers,
};
const moduleObject = { exports: {} };
const compiled = ts.transpileModule(read('src/app/menuConfig.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(compiled, { exports: moduleObject.exports, module: moduleObject });
const menu = moduleObject.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('普通菜单和子菜单保持名称、顺序与归属', () => {
  const items = plain(menu.getAppMenuItems(false));
  assert.deepEqual(items.map((item) => item.id), primary);
  assert.deepEqual(items.map((item) => item.label), ['标书生成', '对话模式', '生图模式', '模板设置', '知识库', '标书检查']);
  for (const item of items) assert.deepEqual(item.children?.map((child) => child.id) || [], children[item.id] || []);
});

test('开发者菜单只保留四个真实入口', () => {
  const items = plain(menu.getAppMenuItems(true));
  assert.deepEqual(items.map((item) => item.id), [...primary, 'developer-test']);
  assert.deepEqual(items.at(-1).children.map((item) => item.id), developers);
  assert.deepEqual(items.at(-1).children.map((item) => item.label), ['Json请求测试', '扩写替换测试', 'Pi Agent监视器', '系统诊断']);
});

test('重复切换不污染数组且顺序和父子查询正确', () => {
  const before = JSON.stringify(menu.appMenuItems);
  for (let index = 0; index < 10; index += 1) {
    const enabled = index % 2 === 0;
    const ids = enabled ? [...primary, 'developer-test'] : primary;
    assert.deepEqual(plain(menu.getSectionOrder(enabled)), ids.flatMap((id) => [id, ...(children[id] || [])]));
    for (const id of ids) {
      assert.equal(menu.getAppMenuItemById(id, enabled).id, id);
      for (const child of children[id] || []) assert.equal(menu.getParentMenuItemBySection(child, enabled).id, id);
    }
    for (const id of [...retired, 'export-format']) assert.equal(menu.getParentMenuItemBySection(id, enabled), undefined);
  }
  assert.equal(JSON.stringify(menu.appMenuItems), before);
});

test('执行 App 现有模式回退 effect，当前开发者页关闭模式后退出且普通页不跳转', () => {
  const source = ts.createSourceFile('App.tsx', read('src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helper = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'isDeveloperSection');
  let effect;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
      const dependencies = node.arguments[1];
      if (dependencies && ts.isArrayLiteralExpression(dependencies)) {
        const names = dependencies.elements.map((item) => item.getText(source));
        if (names.includes('activeSection') && names.includes('developerMode')) effect = node.arguments[0];
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(helper && effect, '保留实际模式回退 effect');
  const code = ts.transpileModule(`${helper.getText(source)}\n(${effect.getText(source)})();`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const activeSection of [...developers, 'developer-test', ...primary, 'settings']) {
    for (const developerMode of [true, false]) {
      const updates = [];
      vm.runInNewContext(code, { activeSection, developerMode, setActiveSection: (value) => updates.push(value) });
      assert.deepEqual(updates, !developerMode && [...developers, 'developer-test'].includes(activeSection) ? ['bid-generation'] : []);
    }
  }
});

test('退役导航、图标和页面连接已删除，模板连接保留', () => {
  for (const file of ['src/app/menuConfig.ts', 'src/shared/types/navigation.ts', 'src/components/Sidebar.tsx', 'src/app/AppRouter.tsx']) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteralLike(node)) assert.ok(![...retired, 'export-format'].includes(node.text), `${file} 仍有活动旧 ID ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const file of ['features/bid-opportunity/pages/BidOpportunityPage.tsx', 'features/business-bid/pages/BusinessBidPage.tsx',
    'features/resources/pages/ResourcesPage.tsx', 'features/developer/pages/DeveloperDemoPage.tsx', 'features/developer/developerDemoSections.ts']) {
    assert.equal(fs.existsSync(path.join(root, 'src', file)), false, file);
  }
  const router = read('src/app/AppRouter.tsx');
  assert.match(router, /case 'new-template'/);
  assert.match(router, /mode="edit" templateId=\{editingTemplateId\}/);
  assert.match(router, /registerLeaveGuard=\{registerLeaveGuard\}/);
  for (const page of ['ExportFormatPage', 'MyTemplatesPage', 'DeveloperTestPage', 'ContentExpansionReplaceTestPage', 'PiAgentMonitorPage', 'SystemDiagnosticsPage']) {
    assert.match(router, new RegExp(`import\\([^\\n]*${page}`));
  }
});

test('隐藏文档按钮清理且设置、共享外链和提示保留', () => {
  const source = read('src/components/Sidebar.tsx');
  assert.doesNotMatch(source, /SHOW_USER_GUIDE|USER_GUIDE_URL|renderUserGuideButton|function BookIcon|function RadarIcon|function BriefcaseIcon|function ResourcesIcon/);
  assert.match(source, /sidebar-footer/);
  assert.match(source, /renderSettingsButton/);
  assert.match(source, /async function openExternalUrl/);
  assert.match(source, /showToast\(item.notice.message/);
});

test('独占 CSS 删除，开发者、模板和共用覆盖层仍在', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/styles/feature-resources.css')), false);
  for (const file of ['styles.css', ...fs.readdirSync(path.join(root, 'src/styles')).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)]) {
    const source = read(`src/${file}`);
    postcss.parse(source).walkRules((rule) => {
      assert.doesNotMatch(rule.selector, /\.(?:resources-|resource-book-|resource-detail-|demo-|opportunity-|developer-secondary-|business-bid-demo)/, file);
    });
  }
  const developer = read('src/styles/feature-developer.css');
  for (const token of ['developer-test-grid', 'developer-expansion-replace-grid', 'token-stats-card', 'agent-monitor-window']) assert.ok(developer.includes(token));
  assert.match(read('src/styles/feature-technical-plan.css'), /\.feature-under-development-overlay/);
  assert.match(read('src/styles/feature-export-format.css'), /\.export-format-layout/);
});

test('客户端根项目版本为 1.8.4，版本显示读取桥接', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(packageJson.version, '1.8.4');
  assert.equal(lock.version, packageJson.version);
  assert.equal(lock.packages[''].version, packageJson.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '../management/package.json'), 'utf8')).version, '1.4.2');
  assert.match(read('src/shared/runtime/appVersion.ts'), /bridge\?\.getVersion/);
  assert.match(read('electron/ipc/index.cjs'), /app:get-version.*app.getVersion/);
  assert.match(read('src/features/auth/StartupAuthPage.tsx'), /getAppVersion\(\)/);
  assert.match(read('src/features/settings/pages/SettingsPage.tsx'), /getAppVersion\(\)/);
});

test('共享资源统计和历史标签保持原契约', () => {
  assert.match(read('src/shared/analytics/analytics.ts'), /export function trackResourceClick/);
  assert.match(read('src/shared/analytics/analytics.ts'), /sendAnalytics\('resource_click', 'resources'/);
  const traffic = fs.readFileSync(path.join(root, '../analytics/dashboard/public/src/pages/traffic.js'), 'utf8');
  for (const id of ['export-format', 'resources', 'business-bid', 'bid-opportunity', ...retired.slice(5)]) assert.ok(traffic.includes(id));
});

test('合成检查任务仍执行废标、错别字和逻辑三个真实分支', async () => {
  const { runRejectionCheckTask } = require('../electron/services/rejectionCheckTask.cjs');
  const options = { rejectionCheck: true, typoCheck: true, logicCheck: true };
  let state = { checkOptions: options, bidDocuments: [{ id: 'synthetic-bid', fileName: '合成投标资料' }],
    invalidBidAndRejectionItems: { content: '合成要求：交付实施记录。' } };
  const schemas = [];
  const tasks = [];
  let textCalls = 0;
  await runRejectionCheckTask({
    aiService: {
      chat: async () => { textCalls += 1; return '受控合成检查响应，未调用模型。'; },
      requestJson: async (request) => { schemas.push(request.schemaName); return { findings: [] }; },
    },
    workspaceStore: {
      loadRejectionCheck: () => state,
      readDocumentMarkdown: () => '合成正文：交付实施记录。',
      createDocumentSignature: () => 'synthetic-bid-signature',
      createRejectionCheckInputSignature: () => 'synthetic-input-signature',
      updateRejectionCheck: (partial) => { state = { ...state, ...partial }; return state; },
    },
    updateTask: (partial) => { tasks.push(partial); return partial; },
    payload: { runOptions: options },
  });
  assert.equal(textCalls, 2);
  assert.deepEqual(schemas.sort(), ['LogicCheckFindings', 'RejectionCheckFindings', 'TypoCheckFindings']);
  assert.equal(tasks.at(-1).status, 'success');
  for (const key of ['rejectionCheckResult', 'typoCheckResult', 'logicCheckResult']) assert.equal(state[key].status, 'success');
});
