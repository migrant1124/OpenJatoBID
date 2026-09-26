const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createTechnicalPlanProjectDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
const { getWorkspaceDir, getDeveloperLogsDir, getTechnicalPlanDir, getTechnicalPlanGeneratedIllustrationsDir } = require('../utils/paths.cjs');

const LEGACY_ID = 'legacy-primary';

function createTechnicalPlanProjects({ app, db, fileService, legacyStore }) {
  const projectRoot = path.join(getWorkspaceDir(app), 'technical-plan', 'projects');
  const generatedRoot = path.join(getWorkspaceDir(app), 'generated-images', 'technical-plan', 'projects');
  const opened = new Map();
  let activeId = null;
  let busyCheck = () => false;
  let pendingOperations = 0;

  const rowById = db.prepare('SELECT * FROM technical_plan_projects WHERE project_id = ?');
  const insert = db.prepare(`INSERT INTO technical_plan_projects
    (project_id, name, buyer, project_number, lot, storage_kind, created_at, updated_at)
    VALUES (@project_id, @name, @buyer, @project_number, @lot, @storage_kind, @created_at, @updated_at)`);

  function assertIdle() {
    if (pendingOperations || busyCheck()) throw new Error('当前项目仍有任务或文件操作在执行，请等待完成后再切换项目');
  }

  function projectApp(id) {
    return { getPath: (name) => app.getPath(name), technicalPlanProjectId: id };
  }

  function storeFor(row, allowCreate = false) {
    if (row.storage_kind === 'legacy') return legacyStore;
    if (!opened.has(row.project_id)) {
      const scopedApp = projectApp(row.project_id);
      const databasePath = path.join(getTechnicalPlanDir(scopedApp), 'plan.sqlite');
      if (!allowCreate && !fs.existsSync(databasePath)) throw new Error(`项目“${row.name}”的数据文件缺失，已停止打开，避免创建空项目覆盖状态`);
      const projectDb = createTechnicalPlanProjectDatabase(databasePath);
      opened.set(row.project_id, {
        db: projectDb,
        store: createTechnicalPlanStore({ app: scopedApp, db: projectDb, fileService }),
      });
    }
    return opened.get(row.project_id).store;
  }

  function currentStore() {
    const row = activeId && rowById.get(activeId);
    if (!row) throw new Error('请先在项目列表中选择项目');
    return storeFor(row);
  }

  function registerLegacy() {
    if (rowById.get(LEGACY_ID)) return;
    const meta = db.prepare('SELECT * FROM technical_plan_meta WHERE id = 1').get();
    const hasBusinessData = Boolean(meta && (
      meta.tender_markdown_path || meta.original_plan_markdown_path || meta.project_understanding_json || meta.step !== 'document-analysis'
      || db.prepare('SELECT 1 FROM technical_plan_outline_nodes LIMIT 1').get()
      || db.prepare('SELECT 1 FROM technical_plan_bid_items LIMIT 1').get()
      || db.prepare('SELECT 1 FROM technical_plan_tasks LIMIT 1').get()
      || db.prepare('SELECT 1 FROM technical_plan_global_fact_groups LIMIT 1').get()
      || db.prepare('SELECT 1 FROM technical_plan_reference_docs LIMIT 1').get()
    ));
    if (!hasBusinessData) return;
    const at = new Date().toISOString();
    insert.run({
      project_id: LEGACY_ID,
      name: meta.outline_project_name || meta.tender_file_name || '原有技术方案项目',
      buyer: null, project_number: null, lot: null, storage_kind: 'legacy', created_at: at, updated_at: at,
    });
  }

  registerLegacy();

  function projectView(row, state) {
    const projectDb = row.storage_kind === 'legacy' ? db : opened.get(row.project_id)?.db;
    const savedAt = projectDb?.prepare('SELECT updated_at FROM technical_plan_meta WHERE id = 1').get()?.updated_at;
    return {
        id: row.project_id,
        name: row.name,
        buyer: row.buyer || '',
        projectNumber: row.project_number || '',
        lot: row.lot || '',
        step: state.step,
        updatedAt: savedAt || row.updated_at,
        createdAt: row.created_at,
      };
  }

  function list() {
    return db.prepare('SELECT * FROM technical_plan_projects').all()
      .map((row) => {
        try { return projectView(row, storeFor(row).loadTechnicalPlan()); }
        catch (error) { return { ...projectView(row, { step: 'document-analysis' }), unavailableReason: error.message }; }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  function create(data = {}) {
    assertIdle();
    const name = String(data.name || '').trim();
    if (!name) throw new Error('请填写项目名称');
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    const row = {
      project_id: id,
      name,
      buyer: String(data.buyer || '').trim() || null,
      project_number: String(data.projectNumber || '').trim() || null,
      lot: String(data.lot || '').trim() || null,
      storage_kind: 'isolated',
      created_at: at,
      updated_at: at,
    };
    const store = storeFor(row, true);
    store.loadTechnicalPlan();
    insert.run(row);
    const state = store.loadTechnicalPlan();
    const project = projectView(row, state);
    activeId = id;
    return { project, state };
  }

  function open(id) {
    assertIdle();
    const row = rowById.get(String(id || ''));
    if (!row) throw new Error('项目不存在或已被删除');
    const state = storeFor(row).loadTechnicalPlan();
    const project = projectView(row, state);
    db.prepare('UPDATE technical_plan_projects SET updated_at = ? WHERE project_id = ?').run(new Date().toISOString(), row.project_id);
    activeId = row.project_id;
    return { project, state };
  }

  function leave() {
    assertIdle();
    activeId = null;
    return { success: true };
  }

  function assertOwnedDirectory(root, target) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(target);
    if (path.dirname(resolved) !== resolvedRoot) throw new Error('项目目录越界，已拒绝删除');
    const workspace = path.resolve(getWorkspaceDir(app));
    const relativeRoot = path.relative(workspace, resolvedRoot);
    if (!relativeRoot || relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) throw new Error('项目目录不在工作区内，已拒绝删除');
    let current = workspace;
    for (const segment of ['', ...relativeRoot.split(path.sep)]) {
      if (segment) current = path.join(current, segment);
      if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('项目父目录是链接，已拒绝删除');
    }
    if (fs.lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('项目目录是链接，已拒绝删除');
    return resolved;
  }

  function remove(id) {
    try {
      const result = removeOwnedProject(id);
      const auditError = appendDeleteAudit(id, true, 'complete');
      if (auditError) result.warning = [result.warning, '项目已删除，但本地删除记录写入失败'].filter(Boolean).join('；');
      return result;
    } catch (error) {
      appendDeleteAudit(id, false, error.deletionStage || 'precheck');
      throw error;
    }
  }

  function appendDeleteAudit(id, success, stage) {
    try {
      const logDir = getDeveloperLogsDir(app, 'technical-plan');
      fs.mkdirSync(logDir, { recursive: true });
      const projectId = id === LEGACY_ID || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(id)) ? String(id) : 'invalid';
      fs.appendFileSync(path.join(logDir, 'project-deletion.jsonl'), `${JSON.stringify({ project_id: projectId, action: 'delete', at: new Date().toISOString(), success, stage })}\n`, 'utf8');
      return null;
    } catch (error) { return error; }
  }

  function removeOwnedProject(id) {
    assertIdle();
    const row = rowById.get(String(id || ''));
    if (!row) throw new Error('项目不存在或已被删除');
    const legacy = row.storage_kind === 'legacy';
    const targets = legacy ? legacyDeleteTargets() : [
      assertOwnedDirectory(generatedRoot, path.dirname(getTechnicalPlanGeneratedIllustrationsDir(projectApp(row.project_id)))),
      assertOwnedDirectory(projectRoot, getTechnicalPlanDir(projectApp(row.project_id))),
    ];
    if (!legacy) {
      opened.get(row.project_id)?.db.close();
      opened.delete(row.project_id);
    }
    const backupRoot = path.join(getWorkspaceDir(app), `.technical-plan-delete-${crypto.randomUUID()}`);
    fs.mkdirSync(backupRoot, { recursive: true });
    const copies = targets.filter((target) => fs.existsSync(target)).map((target, index) => ({ target, backup: path.join(backupRoot, String(index)) }));
    let stage = 'backup';
    try {
      for (const item of copies) fs.cpSync(item.target, item.backup, { recursive: true });
      stage = 'managed-files';
      if (legacy) {
        db.transaction(() => {
          legacyStore.clearTechnicalPlan();
          for (const target of targets) if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
          db.prepare('DELETE FROM technical_plan_projects WHERE project_id = ?').run(row.project_id);
        })();
      } else {
        for (const target of targets) if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
        db.prepare('DELETE FROM technical_plan_projects WHERE project_id = ?').run(row.project_id);
      }
    } catch (error) {
      error.deletionStage = stage;
      let restoreError;
      for (const item of copies) {
        try { fs.cpSync(item.backup, item.target, { recursive: true, force: false }); }
        catch (cause) { restoreError = cause; }
      }
      if (restoreError) throw new Error(`删除失败且恢复未完成，请保留备份 ${backupRoot}：${error.message}；${restoreError.message}`);
      fs.rmSync(backupRoot, { recursive: true, force: true });
      throw error;
    }
    let warning;
    try { fs.rmSync(backupRoot, { recursive: true, force: true }); }
    catch (error) { warning = `项目已删除，但临时备份清理失败：${backupRoot}（${error.message}）`; }
    if (activeId === row.project_id) activeId = null;
    return { success: true, warning };
  }

  function legacyDeleteTargets() {
    const workspace = getWorkspaceDir(app);
    const planDir = getTechnicalPlanDir(app);
    const generatedDir = path.dirname(getTechnicalPlanGeneratedIllustrationsDir(app));
    const importedDir = path.join(workspace, 'imported-images');
    for (const directory of [workspace, planDir, path.dirname(generatedDir), generatedDir, importedDir]) {
      if (fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('旧项目受管父目录是链接，已拒绝删除');
    }
    const targets = [];
    if (fs.existsSync(planDir)) for (const name of fs.readdirSync(planDir)) {
      if (name === 'projects') continue;
      if (['tender.md', 'tender-original.md', 'original-plan.md', 'original-outline-runtime.json', 'tender-files', 'illustrations'].includes(name)
        || /^tender-(?:original-)?[0-9a-f]{16}\.md$/.test(name) || /^tender-pending-\d+\.tmp\.md$/.test(name)) targets.push(path.join(planDir, name));
    }
    const legacyGenerated = path.join(generatedDir, 'illustrations');
    if (fs.existsSync(legacyGenerated)) targets.push(legacyGenerated);
    if (fs.existsSync(importedDir)) for (const name of fs.readdirSync(importedDir)) {
      if (name === 'technical-plan' || name.startsWith('technical-plan-')) targets.push(path.join(importedDir, name));
    }
    return targets;
  }

  const store = new Proxy(legacyStore, {
    get(_target, key) {
      if (key === 'projectId') return activeId;
      if (key === 'forCurrentProject') return currentStore;
      if (key === 'loadTechnicalPlan' && !activeId) return () => null;
      const value = currentStore()[key];
      return typeof value === 'function' ? value.bind(currentStore()) : value;
    },
  });

  return {
    store, list, create, open, leave, remove,
    active: () => activeId,
    projectName: () => activeId ? rowById.get(activeId)?.name || '' : '',
    recordExport(source, outputPath) {
      if (!activeId) throw new Error('请先选择项目');
      const state = currentStore().loadTechnicalPlan();
      const sourceRevision = source === 'technical-plan-analysis' ? state.analysisSourceHash || ''
        : crypto.createHash('sha256').update(JSON.stringify(source === 'technical-plan-outline'
          ? state.outlineData?.outline || []
          : { tender: state.tenderFile, outline: state.outlineData?.outline, content: state.contentGenerationSections })).digest('hex');
      db.prepare('INSERT INTO technical_plan_project_exports (export_id, project_id, source, source_revision, output_path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), activeId, source, sourceRevision, outputPath, new Date().toISOString());
    },
    async runOperation(operation) {
      currentStore();
      pendingOperations += 1;
      try { return await operation(); } finally { pendingOperations -= 1; }
    },
    setBusyCheck(check) { busyCheck = check; },
    close() { for (const entry of opened.values()) entry.db.close(); opened.clear(); },
  };
}

module.exports = { createTechnicalPlanProjects };
