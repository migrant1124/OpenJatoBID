const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createPptSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ppt_projects (
    project_id TEXT PRIMARY KEY, title TEXT NOT NULL, root TEXT NOT NULL UNIQUE, owner_token TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, route TEXT NOT NULL DEFAULT 'generate', status TEXT NOT NULL DEFAULT 'draft',
    requirements_json TEXT NOT NULL DEFAULT '{}', plan_json TEXT, confirmed_revision INTEGER,
    resource_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS ppt_pages (
    slide_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES ppt_projects(project_id), position INTEGER NOT NULL,
    source_path TEXT NOT NULL, hash TEXT NOT NULL, kind TEXT NOT NULL, notes_path TEXT
  );
  CREATE TABLE IF NOT EXISTS ppt_jobs (
    job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
    base_revision INTEGER NOT NULL, candidate_root TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ppt_history (
    project_id TEXT NOT NULL, revision INTEGER NOT NULL, folder TEXT NOT NULL, pages_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(project_id, revision)
  );
  CREATE TABLE IF NOT EXISTS ppt_skills (
    skill_id TEXT NOT NULL, content_hash TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL,
    root TEXT NOT NULL, metadata_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(skill_id, content_hash)
  );
  CREATE TABLE IF NOT EXISTS ppt_commit_journal (
    project_id TEXT PRIMARY KEY, base_revision INTEGER NOT NULL, candidate TEXT NOT NULL, history TEXT NOT NULL, names_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ppt_personal_templates (
    template_id TEXT PRIMARY KEY, title TEXT NOT NULL, root TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ppt_annotations (
    annotation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slide_id TEXT NOT NULL, element_id TEXT,
    source_hash TEXT NOT NULL, instruction TEXT NOT NULL, created_at TEXT NOT NULL, applied_at TEXT
  );
  CREATE TABLE IF NOT EXISTS ppt_image_requests (
    request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, base_revision INTEGER NOT NULL,
    task_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
}

function createPptProjectStore({ db }) {
  createPptSchema(db);
  db.prepare("UPDATE ppt_jobs SET status = 'interrupted', error = '进程退出时任务未完成，候选保留待恢复' WHERE status IN ('running', 'queued')").run();
  const project = (id) => {
    const row = db.prepare('SELECT * FROM ppt_projects WHERE project_id = ? AND deleted_at IS NULL').get(id);
    if (!row) throw new Error('PPT项目不存在');
    return { projectId: row.project_id, title: row.title, root: row.root, ownerToken: row.owner_token, revision: row.revision,
      route: row.route, status: row.status, requirements: JSON.parse(row.requirements_json), plan: row.plan_json ? JSON.parse(row.plan_json) : null,
      confirmedRevision: row.confirmed_revision, resource: row.resource_json ? JSON.parse(row.resource_json) : null };
  };
  function owned(id) {
    const value = project(id);
    let marker;
    try { marker = JSON.parse(fs.readFileSync(path.join(value.root, '.jato-ppt-owner.json'), 'utf8')); }
    catch { throw new Error('项目目录失联或归属标记丢失，请重新定位；不会另建系统盘副本'); }
    if (marker.projectId !== id || marker.ownerToken !== value.ownerToken) throw new Error('项目目录归属不一致，拒绝写入或删除');
    return value;
  }
  function inside(id, relative) {
    const value = owned(id), root = fs.realpathSync(value.root), target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('PPT操作越出项目子目录');
    let existing = target;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const real = fs.realpathSync(existing);
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error('PPT路径联接越出归属目录');
    return target;
  }
  function create({ parent, title, requirements = {} }) {
    if (!path.isAbsolute(parent) || !title?.trim()) throw new Error('请选择项目父目录并填写名称');
    const projectId = crypto.randomUUID(), ownerToken = crypto.randomUUID();
    const root = path.join(fs.realpathSync(parent), `Jato-PPT-${projectId}`);
    fs.mkdirSync(root); fs.writeFileSync(path.join(root, '.jato-ppt-owner.json'), JSON.stringify({ projectId, ownerToken }), 'utf8');
    for (const directory of ['sources', 'svg_output', 'svg_final', 'notes', 'materials', 'assets', 'images', 'reports', 'exports', 'history', 'candidates']) fs.mkdirSync(path.join(root, directory));
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO ppt_projects(project_id, title, root, owner_token, requirements_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, title.trim(), root, ownerToken, JSON.stringify(requirements), at, at);
    return project(projectId);
  }
  function setPlan({ projectId, revision, plan, requirements }) {
    owned(projectId);
    const result = db.prepare(`UPDATE ppt_projects SET plan_json = ?, requirements_json = COALESCE(?, requirements_json),
      revision = revision + 1, confirmed_revision = NULL, updated_at = ? WHERE project_id = ? AND revision = ?`)
      .run(JSON.stringify(plan), requirements ? JSON.stringify(requirements) : null, new Date().toISOString(), projectId, revision);
    if (!result.changes) throw new Error('项目修订已变化，请重新读取计划');
    return project(projectId);
  }
  function confirm({ projectId, revision }) {
    const value = owned(projectId);
    if (value.revision !== revision || !value.plan) throw new Error('计划不存在或确认已失效');
    db.prepare('UPDATE ppt_projects SET confirmed_revision = ? WHERE project_id = ?').run(revision, projectId);
    return project(projectId);
  }
  const pages = (id) => db.prepare('SELECT slide_id AS slideId, position, source_path AS sourcePath, hash, kind, notes_path AS notesPath FROM ppt_pages WHERE project_id = ? ORDER BY position').all(id);
  function replacePages(id, next) {
    db.prepare('DELETE FROM ppt_pages WHERE project_id = ?').run(id);
    const insert = db.prepare('INSERT INTO ppt_pages(slide_id, project_id, position, source_path, hash, kind, notes_path) VALUES (?, ?, ?, ?, ?, ?, ?)');
    next.forEach((page, position) => insert.run(page.slideId, id, position, page.sourcePath, page.hash, page.kind, page.notesPath || null));
  }
  function recoverCommits() {
    for (const journal of db.prepare('SELECT * FROM ppt_commit_journal').all()) {
      const value = owned(journal.project_id);
      for (const directory of [journal.candidate, journal.history]) inside(value.projectId, path.relative(value.root, directory));
      if (value.revision !== journal.base_revision) throw new Error('PPT 提交恢复修订不一致，请保留目录并人工定位');
      for (const entry of JSON.parse(journal.names_json).reverse()) {
        const target = inside(value.projectId, entry.name), backup = path.join(journal.history, entry.name), candidate = path.join(journal.candidate, entry.name);
        if (fs.existsSync(backup)) {
          if (fs.existsSync(target)) { if (fs.existsSync(candidate)) throw new Error('候选恢复路径冲突，停止以保护文件'); fs.renameSync(target, candidate); }
          fs.renameSync(backup, target);
        } else if (!entry.existed && !fs.existsSync(candidate) && fs.existsSync(target)) fs.renameSync(target, candidate);
      }
      db.prepare('DELETE FROM ppt_commit_journal WHERE project_id = ?').run(value.projectId);
    }
  }
  return { db, project, owned, inside, create, setPlan, confirm, pages, replacePages, recoverCommits,
    list: () => db.prepare('SELECT project_id AS projectId, title, root, revision, status, updated_at AS updatedAt FROM ppt_projects WHERE deleted_at IS NULL ORDER BY updated_at DESC').all(),
    jobs: (id) => db.prepare('SELECT job_id AS jobId, status, phase, base_revision AS baseRevision, error, updated_at AS updatedAt FROM ppt_jobs WHERE project_id = ? ORDER BY created_at DESC').all(id) };
}
module.exports = { createPptSchema, createPptProjectStore };
