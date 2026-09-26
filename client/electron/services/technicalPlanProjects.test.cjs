const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
const { createTechnicalPlanProjects } = require('./technicalPlanProjects.cjs');

function fixture(t, fileService = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-project-test-'));
  const app = { getPath: () => root, once: () => {} };
  const sqlite = createSqliteDatabase(app);
  const legacyStore = createTechnicalPlanStore({ app, db: sqlite.db, fileService });
  const projects = createTechnicalPlanProjects({ app, db: sqlite.db, fileService, legacyStore });
  t.after(() => { projects.close(); sqlite.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { app, sqlite, legacyStore, projects };
}

test('合成项目A/B独立持久化，打开项目不运行任务', (t) => {
  const { projects } = fixture(t);
  const a = projects.create({ name: '项目A' });
  projects.store.updateTechnicalPlan({ projectOverview: 'A的项目事实' });
  projects.leave();
  const b = projects.create({ name: '项目A' });
  projects.store.updateTechnicalPlan({ projectOverview: 'B的项目事实' });
  assert.notEqual(a.project.id, b.project.id);
  assert.equal(projects.open(a.project.id).state.projectOverview, 'A的项目事实');
  assert.equal(projects.open(b.project.id).state.projectOverview, 'B的项目事实');
  assert.deepEqual(projects.list().map((project) => project.name), ['项目A', '项目A']);
});

test('运行中拒绝切换和删除；取消删除不调用服务', (t) => {
  const { projects } = fixture(t);
  const a = projects.create({ name: '项目A' });
  projects.setBusyCheck(() => true);
  assert.throws(() => projects.leave(), /在执行/);
  assert.throws(() => projects.remove(a.project.id), /在执行/);
  assert.equal(projects.list().length, 1);
});

test('删除受管图片失败时保留项目和数据，解除文件锁后可重试', (t) => {
  const { app, projects } = fixture(t);
  const created = projects.create({ name: '可重试项目' });
  projects.store.updateTechnicalPlan({ projectOverview: '保留的内容' });
  fs.mkdirSync(path.join(app.getPath('userData'), 'workspace', 'generated-images', 'technical-plan', 'projects', created.project.id), { recursive: true });
  const originalRm = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target).includes('generated-images')) throw new Error('EBUSY');
    return originalRm(target, options);
  };
  try {
    assert.throws(() => projects.remove(created.project.id), /EBUSY/);
    assert.equal(projects.open(created.project.id).state.projectOverview, '保留的内容');
  } finally {
    fs.rmSync = originalRm;
  }
  projects.remove(created.project.id);
  assert.equal(projects.list().length, 0);
  const audit = fs.readFileSync(path.join(app.getPath('userData'), 'logs', 'technical-plan', 'project-deletion.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit.map((entry) => entry.success), [false, true]);
  assert.equal(JSON.stringify(audit).includes('保留的内容'), false);
});

test('项目目录部分删除失败后从备份恢复并允许重试', (t) => {
  const { projects } = fixture(t);
  const created = projects.create({ name: '部分删除' });
  projects.store.updateTechnicalPlan({ projectOverview: '不能丢的内容' });
  const originalRm = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target).endsWith(created.project.id)) {
      originalRm(path.join(target, 'plan.sqlite'), { force: true });
      throw new Error('EBUSY after partial delete');
    }
    return originalRm(target, options);
  };
  try { assert.throws(() => projects.remove(created.project.id), /EBUSY/); }
  finally { fs.rmSync = originalRm; }
  assert.equal(projects.open(created.project.id).state.projectOverview, '不能丢的内容');
  projects.remove(created.project.id);
});

test('项目受管父目录为链接时拒绝越界删除', (t) => {
  const { app, projects } = fixture(t);
  const created = projects.create({ name: '链接保护' });
  const outside = path.join(app.getPath('userData'), 'outside-owned');
  const parent = path.join(app.getPath('userData'), 'workspace', 'generated-images', 'technical-plan', 'projects');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, created.project.id), '外部文件');
  fs.mkdirSync(path.dirname(parent), { recursive: true });
  try { fs.symlinkSync(outside, parent, 'junction'); }
  catch (error) { t.skip(`当前 Windows 环境无法创建测试 junction：${error.code}`); return; }
  assert.throws(() => projects.remove(created.project.id), /父目录是链接/);
  assert.equal(fs.readFileSync(path.join(outside, created.project.id), 'utf8'), '外部文件');
});

test('目标数据库缺失时打开失败且 Main 仍绑定原项目', (t) => {
  const { app, projects } = fixture(t);
  const a = projects.create({ name: '项目A' });
  projects.store.updateTechnicalPlan({ projectOverview: 'A内容' });
  const b = projects.create({ name: '项目B' });
  projects.open(a.project.id);
  projects.close();
  fs.rmSync(path.join(app.getPath('userData'), 'workspace', 'technical-plan', 'projects', b.project.id, 'plan.sqlite'));
  assert.throws(() => projects.open(b.project.id), /数据文件缺失/);
  assert.equal(projects.list().find((project) => project.id === b.project.id).unavailableReason.includes('数据文件缺失'), true);
  assert.equal(projects.list().find((project) => project.id === a.project.id).name, '项目A');
  assert.equal(projects.active(), a.project.id);
  assert.equal(projects.store.loadTechnicalPlan().projectOverview, 'A内容');
});

test('旧单项目只登记一次，且新项目删除不影响旧项目', (t) => {
  const { app, sqlite, legacyStore, projects } = fixture(t);
  legacyStore.updateTechnicalPlan({ projectOverview: '旧事实' });
  projects.close();
  const reopened = createTechnicalPlanProjects({ app, db: sqlite.db, fileService: {}, legacyStore });
  t.after(() => reopened.close());
  assert.equal(reopened.list().filter((project) => project.id === 'legacy-primary').length, 1);
  const fresh = reopened.create({ name: '新项目' });
  reopened.remove(fresh.project.id);
  assert.equal(reopened.open('legacy-primary').state.projectOverview, '旧事实');
});

test('旧项目删除失败回滚数据库与修订文件，重试只清旧项目', (t) => {
  const { app, sqlite, legacyStore, projects } = fixture(t);
  legacyStore.updateTechnicalPlan({ projectOverview: '旧项目内容' });
  projects.close();
  const reopened = createTechnicalPlanProjects({ app, db: sqlite.db, fileService: {}, legacyStore });
  t.after(() => reopened.close());
  const versioned = path.join(app.getPath('userData'), 'workspace', 'technical-plan', 'tender-0123456789abcdef.md');
  fs.mkdirSync(path.dirname(versioned), { recursive: true });
  fs.writeFileSync(versioned, '旧来源修订');
  const originalRm = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (target === versioned) throw new Error('EBUSY');
    return originalRm(target, options);
  };
  try {
    assert.throws(() => reopened.remove('legacy-primary'), /EBUSY/);
    assert.equal(reopened.open('legacy-primary').state.projectOverview, '旧项目内容');
    assert.equal(fs.readFileSync(versioned, 'utf8'), '旧来源修订');
  } finally { fs.rmSync = originalRm; }
  reopened.remove('legacy-primary');
  assert.equal(fs.existsSync(versioned), false);
  assert.equal(reopened.list().length, 0);
});

test('同一项目分批追加不清旧解析；重复字节跳过，同名异内容待选择', async (t) => {
  const batches = [];
  const fileService = { importDocument: async () => batches.shift() };
  const { app, projects } = fixture(t, fileService);
  projects.create({ name: '项目A' });
  const source1 = path.join(app.getPath('userData'), '外部原件1.txt');
  const source2 = path.join(app.getPath('userData'), '外部原件2.txt');
  fs.writeFileSync(source1, '原件1'); fs.writeFileSync(source2, '原件2');
  const doc1 = { file_name: '招标文件.txt', file_content: '条款A', source_hash: 'hash-a', file_path: source1 };
  const doc2 = { file_name: '补充文件.txt', file_content: '条款B', source_hash: 'hash-b', file_path: source2 };
  batches.push({ success: true, file_content: doc1.file_content, documents: [doc1] });
  assert.equal((await projects.store.importTenderDocument()).state.tenderFiles.length, 1);
  projects.store.updateTechnicalPlan({ projectOverview: '人工核对的原解析' });
  batches.push({ success: true, file_content: doc2.file_content, documents: [doc2] });
  const added = await projects.store.importTenderDocument();
  assert.equal(added.state.tenderFiles.length, 2);
  assert.equal(added.state.projectOverview, '人工核对的原解析');
  assert.match(added.markdown, /招标资料来源/);
  batches.push({ success: true, file_content: doc1.file_content, documents: [doc1] });
  assert.equal((await projects.store.importTenderDocument()).state.tenderFiles.length, 2);
  const changedName = { ...doc1, file_content: '条款A更新', source_hash: 'hash-a-new', file_path: source2 };
  batches.push({ success: true, file_content: changedName.file_content, documents: [changedName] });
  const conflict = await projects.store.importTenderDocument();
  assert.equal(conflict.requiresChoice, true);
  assert.equal(projects.store.loadTechnicalPlan().tenderFiles.length, 2);
  const kept = projects.store.resolveTenderImport(conflict.token, 'keep');
  assert.equal(kept.state.tenderFiles.length, 3);
  assert.equal(fs.readFileSync(source1, 'utf8'), '原件1');
  batches.push({ success: true, file_content: '第三份', documents: [{ ...changedName, file_content: '第三份', source_hash: 'hash-a-third' }] });
  const third = await projects.store.importTenderDocument();
  assert.equal(third.requiresChoice, true);
  assert.throws(() => projects.store.resolveTenderImport(third.token, 'replace'), /同名旧文件不止一份/);
  assert.equal(projects.store.loadTechnicalPlan().tenderFiles.length, 3);
});

test('投标范围配置变更不清空旧解析和目录', async (t) => {
  const fileService = { importDocument: async () => ({ success: true, file_content: '通用条款\n标包甲', documents: [{ file_name: '招标.txt', file_content: '通用条款\n标包甲', source_hash: 'range-source' }] }) };
  const { projects } = fixture(t, fileService);
  projects.create({ name: '范围测试' });
  await projects.store.importTenderDocument();
  projects.store.updateTechnicalPlan({ bidAnalysisTasks: { projectOverview: { status: 'success', content: '旧解析' } }, bidAnalysisTask: { status: 'running', task_id: 'synthetic', progress: 0 } });
  projects.store.saveOutline({ outlineData: { outline: [{ id: '1', title: '旧目录', children: [] }] }, reason: 'replace' });
  const changed = projects.store.saveBidAnalysisConfig({ mode: 'key', bidSectionMode: 'single' });
  assert.equal(changed.bidAnalysisTasks.projectOverview.content, '旧解析');
  assert.equal(changed.outlineData.outline[0].title, '旧目录');
});

test('重选标段保留旧成果并使分析来源与旧标段快照过期', async (t) => {
  const fileService = { importDocument: async () => ({ success: true, file_content: '通用条款\n甲标包\n乙标包', documents: [{ file_name: '招标.txt', file_content: '通用条款\n甲标包\n乙标包', source_hash: 'range-source' }] }) };
  const { projects } = fixture(t, fileService);
  projects.create({ name: '标段测试' });
  await projects.store.importTenderDocument();
  projects.store.updateTechnicalPlan({ bidSections: [
    { id: 'a', title: '甲标包', includeRanges: [{ startLine: 2, endLine: 2 }] },
    { id: 'b', title: '乙标包', includeRanges: [{ startLine: 3, endLine: 3 }] },
  ], bidSectionExtractionStatus: 'success', bidSectionMode: 'multiple' });
  projects.store.selectBidSection({ id: 'a' });
  projects.store.updateTechnicalPlan({ bidAnalysisTasks: { projectOverview: { status: 'success', content: '甲解析' } }, bidAnalysisTask: { status: 'running', task_id: 'synthetic', progress: 0 } });
  projects.store.saveOutline({ outlineData: { outline: [{ id: '1', title: '保留目录', children: [] }] }, reason: 'replace' });
  const changed = projects.store.selectBidSection({ id: 'b' }).state;
  assert.equal(changed.bidAnalysisTasks.projectOverview.content, '甲解析');
  assert.equal(changed.outlineData.outline[0].title, '保留目录');
  assert.equal(changed.analysisSourceSectionTitle, '甲标包');
  assert.equal(changed.analysisStale, true);
  assert.equal(changed.downstreamReviewRequired, true);
});

test('格式解析变化只标记旧下游待复核，不清目录和正文', (t) => {
  const { projects } = fixture(t);
  projects.create({ name: '格式变化' });
  projects.store.updateTechnicalPlan({ bidAnalysisTasks: { responseFileRequirements: { status: 'success', content: '【技术文件目录状态】：未明确\n旧格式' } } });
  projects.store.saveOutline({ outlineData: { outline: [{ id: '1', title: '人工目录', children: [] }] }, reason: 'replace' });
  projects.store.saveContentGenerationItem({ nodeId: '1', section: { status: 'success', content: '人工正文' } });
  const changed = projects.store.updateTechnicalPlan({ bidAnalysisTasks: { responseFileRequirements: { status: 'success', content: '【技术文件目录状态】：未明确\n新格式' } } });
  assert.equal(changed.outlineData.outline[0].content, '人工正文');
  assert.equal(changed.downstreamReviewRequired, true);
});

test('外部原件在解析与复制之间变化时拒绝落库', async (t) => {
  const fileService = { importDocument: async () => ({ success: true, file_content: '解析时内容', documents: [{
    file_name: '来源.txt', file_content: '解析时内容', source_hash: '0'.repeat(64), file_path: sourcePath,
  }] }) };
  const { app, projects } = fixture(t, fileService);
  const sourcePath = path.join(app.getPath('userData'), '正在变化的外部文件.txt');
  fs.writeFileSync(sourcePath, '复制时内容');
  projects.create({ name: '来源一致性' });
  await assert.rejects(projects.store.importTenderDocument(), /文件在导入期间发生变化/);
  assert.equal(projects.store.loadTechnicalPlan().tenderFiles.length, 0);
});

test('正文开始后 Main 拒绝层级调整且保留已存目录', (t) => {
  const { projects } = fixture(t);
  projects.create({ name: '目录测试' });
  const original = { outline: [{ id: '1', title: '父节点', children: [{ id: '1.1', title: '子节点', children: [] }] }] };
  projects.store.saveOutline({ outlineData: original, reason: 'replace' });
  const moved = { outline: [{ id: '1', title: '父节点', children: [] }, { id: '2', title: '子节点', children: [] }] };
  projects.store.saveOutline({ outlineData: moved, reason: 'restructure', idMap: { '1': '1', '1.1': '2' } });
  assert.equal(projects.store.loadTechnicalPlan().outlineData.outline[1].title, '子节点');
  projects.store.saveContentGenerationItem({ nodeId: '1', section: { status: 'success', content: '人工正文' } });
  assert.throws(() => projects.store.saveOutline({ outlineData: original, reason: 'restructure' }), /正文已启动或已有内容/);
  assert.equal(projects.store.loadTechnicalPlan().outlineData.outline[0].content, '人工正文');
});
