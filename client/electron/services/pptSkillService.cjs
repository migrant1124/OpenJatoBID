const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { hash } = require('./pptTemplateService.cjs');
const { loadPiModules } = require('./pi/piSessionFactory.cjs');
const { completeSkillReferences } = require('./pptSkillPackage.cjs');
const markdownParser = new (require('markdown-it'))();

function copySkillTree(source, destination) {
  let bytes = 0, count = 0; const names = new Set();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name), relative = path.relative(source, full), lower = relative.toLowerCase();
      if (names.has(lower) || entry.isSymbolicLink()) throw new Error('技能包含链接或大小写冲突');
      names.add(lower);
      if (entry.isDirectory()) { if (entry.name === '.git' || entry.name === 'node_modules') throw new Error('请选择技能子目录，不包含 .git 或 node_modules'); visit(full); }
      else {
        bytes += fs.statSync(full).size; count += 1;
        if (bytes > 512 * 1024 ** 2 || count > 20000 || /\.(exe|dll|bat|cmd|msi|ps1)$/i.test(entry.name)) throw new Error('技能规模超限或含未批准的执行组件');
        const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(full, target);
      }
    }
  }
  visit(source); return { bytes, count };
}
function unpackSkills(source, destination, prefix = '') {
  let bytes = 0; const names = new Set(), archive = new AdmZip(source), entries = archive.getEntries();
  for (const entry of entries) {
    const name = entry.entryName, lower = name.toLowerCase(); bytes += entry.header.size;
    if (names.has(lower) || /(^\/|^[A-Za-z]:|\\|(^|\/)\.\.(\/|$))/.test(name) || (entry.attr >>> 16 & 0xf000) === 0xa000
      || bytes > 512 * 1024 ** 2 || entry.header.size > 128 * 1024 ** 2 || entries.length > 20000) throw new Error('技能 ZIP 路径、链接、大小或名称异常');
    names.add(lower);
    if (entry.isDirectory) continue;
    if (!name.startsWith(prefix)) continue;
    if (/\.(exe|dll|bat|cmd|msi|ps1)$/i.test(name)) throw new Error('技能包含未批准的执行组件');
    const target = path.resolve(destination, name.slice(prefix.length));
    if (!target.startsWith(`${destination}${path.sep}`)) throw new Error('技能 ZIP 路径越界');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, entry.getData());
  }
  completeSkillReferences(source, prefix, destination);
}
function directoryHash(root) {
  const files = [];
  function scan(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isSymbolicLink()) throw new Error('技能版本含链接，停止校验'); if (entry.isDirectory()) scan(full); else files.push([path.relative(root, full).replace(/\\/g, '/'), hash(fs.readFileSync(full))]); } }
  scan(root); return hash(JSON.stringify(files.sort((a, b) => a[0].localeCompare(b[0]))));
}
function skillMetadata(root, entry) {
  const missing = [], dependencies = [];
  let bytes = 0;
  const visit = (directory) => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) visit(file); else {
      bytes += fs.statSync(file).size;
      if (item.name === 'package.json') {
        const packageJson = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Object.keys(packageJson.scripts || {}).some((name) => /^(pre|post)?install$|^prepare$/.test(name))) throw new Error('技能包含未批准的生命周期安装脚本');
      }
      if (!/\.md$/i.test(file)) continue;
      const links = markdownParser.parse(fs.readFileSync(file, 'utf8'), {}).flatMap((token) => token.children || []).filter((token) => ['link_open', 'image'].includes(token.type));
      for (const link of links) {
        const reference = (link.attrGet(link.type === 'image' ? 'src' : 'href') || '').split('#')[0];
        if (!reference || /^(?:https?:|mailto:|data:|#)/i.test(reference)) continue;
        let relative; try { relative = decodeURIComponent(reference); } catch { relative = reference; }
        const target = path.resolve(path.dirname(file), relative);
        dependencies.push(path.relative(root, target).replace(/\\/g, '/'));
        if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) missing.push(reference);
      }
    }
  } };
  visit(root);
  const license = /(?:^|\n)\s*license:\s*["']?([^\n"']+)/.exec(entry)?.[1]?.trim()
    || (['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find((name) => fs.existsSync(path.join(root, name))) ? '许可文件随包保存' : '未声明许可，仅个人方法参考');
  return { missing: [...new Set(missing)], dependencies: [...new Set(dependencies)], bytes, license };
}
function createPptSkillService({ db, root, runtime, resources }) {
  const saved = db.prepare("SELECT value_json FROM resource_client_settings WHERE key = 'ppt_skill_root'").get();
  if (saved) root = JSON.parse(saved.value_json); else fs.mkdirSync(root, { recursive: true });
  const candidates = new Map(); let migrating = false;
  function idle() { if (migrating || db.prepare("SELECT 1 FROM ppt_jobs WHERE status IN ('running','queued') LIMIT 1").get()) throw new Error('请先停止 PPT 任务，再管理技能'); }
  function discard({ candidateId }) {
    const value = candidates.get(candidateId); if (!value) return;
    for (const stage of value.stages || (value.stage ? [value.stage] : [])) {
      const target = path.resolve(stage), parent = path.resolve(root, 'candidates');
      if (path.dirname(target) !== parent) throw new Error('候选归属异常');
      fs.rmSync(target, { recursive: true, force: true });
    }
    candidates.delete(candidateId);
  }
  const list = () => db.prepare('SELECT skill_id AS skillId, content_hash AS contentHash, name, version, root, metadata_json, enabled, status FROM ppt_skills ORDER BY created_at DESC').all().map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json), metadata_json: undefined }));
  async function identify(input) {
    idle(); if (!fs.existsSync(root)) throw new Error('技能目录失联，请连接原目录或重新定位；不会另建副本');
    if (input.requestId) {
      const status = await resources.repositoryStatus(input.requestId);
      idle();
      const ids = status.result?.resourceIds || (status.result?.resourceId ? [status.result.resourceId] : []);
      if (status.status !== 'ready' || !ids.length) return { repository: status, candidates: [] };
      await resources.sync();
      idle();
      const found = [], stages = [], acquired = [];
      try { for (const resourceId of ids) { const value = await identify({ resourceId }), candidate = candidates.get(value.candidateId); acquired.push(value.candidateId); found.push(...candidate.found); stages.push(candidate.stage); } }
      catch (error) { for (const id of acquired) discard({ candidateId: id }); throw error; }
      for (const id of acquired) candidates.delete(id);
      const candidateId = crypto.randomUUID(); candidates.set(candidateId, { found, stages });
      return { candidateId, candidates: found.map(({ root: _root, ...item }) => item) };
    }
    if (input.repositoryUrl) {
      const url = new URL(input.repositoryUrl);
      const match = /^\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/.exec(url.pathname);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match) throw new Error('请输入 GitHub 仓库或明确子目录地址');
      return { repository: await resources.repositoryRequest({ repo: `${match[1]}/${match[2]}`, ref: match[3] || 'main', root: match[4] || '' }), candidates: [] };
    }
    const candidateId = crypto.randomUUID(), stage = path.join(root, 'candidates', candidateId);
    fs.mkdirSync(stage, { recursive: true });
    candidates.set(candidateId, { stage, found: [] });
    try {
    if (input.resourceId) {
      const item = await resources.getItem(input.resourceId);
      idle();
      const packageAsset = item?.assets.find((asset) => asset.role === 'package');
      if (!packageAsset) throw new Error('管理端完整技能包尚未就绪');
      const file = await resources.loadAsset({ resourceId: item.resourceId, assetId: packageAsset.assetId });
      idle();
      unpackSkills(file.filePath, stage, item.packagePrefix || '');
    } else {
      const selected = fs.realpathSync(input.path);
      if (fs.statSync(selected).isDirectory()) copySkillTree(selected, stage);
      else if (/\.zip$/i.test(selected)) unpackSkills(selected, stage);
      else if (/\.md$/i.test(selected)) {
        const text = fs.readFileSync(selected, 'utf8');
        if (!/^---\r?\n/.test(text)) {
          if (!input.normalize?.confirmed) { discard({ candidateId }); return { candidates: [], needsNormalization: true, originalPath: selected }; }
          if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.normalize.name) || !input.normalize.description?.trim()) throw new Error('请填写技能英文标识和中文用途');
          fs.writeFileSync(path.join(stage, 'SKILL.md'), `---\nname: ${input.normalize.name}\ndescription: ${JSON.stringify(input.normalize.description.trim())}\nversion: 1\n---\n\n${text}`, 'utf8');
        } else fs.copyFileSync(selected, path.join(stage, 'SKILL.md'));
      }
      else throw new Error('请选择 SKILL.md、完整文件夹或 ZIP');
    }
    const { codingAgent } = await loadPiModules();
    idle();
    const discovered = codingAgent.loadSkillsFromDir({ dir: stage, source: '用户选择的安装候选' });
    if (!discovered.skills.length) throw new Error('未发现有效技能元数据；普通 Markdown 需先明确整理为技能');
    const found = discovered.skills.map((skill) => {
      const contentHash = directoryHash(skill.baseDir), entry = fs.readFileSync(skill.filePath, 'utf8');
      const version = /(?:^|\n)\s*version:\s*["']?([^\s"']+)/.exec(entry)?.[1] || '未声明';
      const metadata = skillMetadata(skill.baseDir, entry);
      const missing = [...metadata.missing, ...(skill.name === 'ppt-master' ? ['scripts/attribution_guard.py', 'templates', 'references', 'workflows/routing.md', 'LICENSE', 'SPONSORS.md', 'SPONSORS_CN.md'].filter((file) => !fs.existsSync(path.join(skill.baseDir, file))) : [])];
      const builtIn = skill.name === 'ppt-master' && fs.existsSync(runtime.skillRoot) && directoryHash(runtime.skillRoot) === contentHash;
      return { skillId: skill.name, name: skill.name, description: skill.description, contentHash, version, root: skill.baseDir,
        status: missing.length ? 'missing_resources' : builtIn ? 'ready' : 'workflow_only',
        ...metadata, missing, source: input.resourceId ? `管理端资源 ${input.resourceId}` : input.path,
        permissions: builtIn ? ['受管项目读写', '固定工具'] : ['受管项目读写；第三方脚本不执行'], executable: builtIn };
    });
    candidates.set(candidateId, { stage, found });
    return { candidateId, candidates: found.map(({ root: _root, ...item }) => item), diagnostics: discovered.diagnostics };
    } catch (error) { discard({ candidateId }); throw error; }
  }
  function install({ candidateId, hashes, confirmed }) {
    idle();
    if (!confirmed) throw new Error('安装技能需要明确确认名称、来源及权限');
    const candidate = candidates.get(candidateId);
    if (!candidate) throw new Error('安装候选已过期，请重新识别');
    const installed = [];
    for (const skill of candidate.found.filter((item) => hashes.includes(item.contentHash))) {
      if (skill.missing.length) throw new Error(`缺少完整资源：${skill.missing.join('、')}`);
      if (directoryHash(skill.root) !== skill.contentHash) throw new Error('候选文件已变化，请重新确认');
      const target = path.join(root, 'versions', skill.contentHash);
      if (!fs.existsSync(target)) { fs.mkdirSync(target, { recursive: true }); copySkillTree(skill.root, target); }
      db.prepare(`INSERT INTO ppt_skills(skill_id, content_hash, name, version, root, metadata_json, enabled, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(skill_id,content_hash) DO UPDATE SET root=excluded.root, enabled=1, status=excluded.status, metadata_json=excluded.metadata_json`)
        .run(skill.skillId, skill.contentHash, skill.name, skill.version, target, JSON.stringify({ description: skill.description, permissions: skill.permissions, executable: skill.executable, source: skill.source, bytes: skill.bytes, license: skill.license, dependencies: skill.dependencies }), skill.status, new Date().toISOString());
      installed.push(skill.contentHash);
    }
    if (!installed.length) throw new Error('请至少选择一项完整技能');
    discard({ candidateId }); return { installed, skills: list() };
  }
  function remove({ hashes, confirmed, removeReferenced = false }) {
    idle();
    if (!confirmed) throw new Error('卸载技能需要一次明确确认');
    for (const value of hashes) {
      const referenced = db.prepare('SELECT COUNT(*) AS count FROM ppt_projects WHERE resource_json LIKE ?').get(`%${value}%`).count
        + db.prepare('SELECT COUNT(*) AS count FROM ppt_history WHERE pages_json LIKE ?').get(`%${value}%`).count;
      if (referenced && !removeReferenced) { db.prepare("UPDATE ppt_skills SET enabled=0, status='retained' WHERE content_hash=?").run(value); continue; }
      const item = list().find((item) => item.contentHash === value);
      if (item) { const target = fs.realpathSync(item.root), expected = path.join(fs.realpathSync(root), 'versions', value); if (target !== expected) throw new Error('技能归属路径异常'); fs.rmSync(target, { recursive: true }); db.prepare('DELETE FROM ppt_skills WHERE content_hash = ?').run(value); }
    }
    return list();
  }
  return { list, identify, install, remove, discard, directoryHash,
    storage() { const projects = db.prepare('SELECT project_id AS projectId, title, resource_json, deleted_at FROM ppt_projects').all().filter((item) => JSON.parse(item.resource_json || '{}')?.skillHash).map(({ resource_json, deleted_at, ...item }) => ({ ...item, title: `${item.title}${deleted_at ? '（可恢复的删除记录）' : ''}`, contentHash: JSON.parse(resource_json).skillHash })); for (const row of db.prepare('SELECT h.project_id AS projectId, p.title, h.revision, h.pages_json FROM ppt_history h JOIN ppt_projects p ON p.project_id=h.project_id').all()) { const resource = JSON.parse(row.pages_json).resource; if (resource?.skillHash && !projects.some((item) => item.projectId === row.projectId && item.contentHash === resource.skillHash)) projects.push({ projectId: row.projectId, title: `${row.title}（历史修订${row.revision}）`, contentHash: resource.skillHash }); } return { root, bytes: list().reduce((sum, item) => sum + (item.metadata.bytes || 0), 0), projects }; },
    async configure({ parent, confirmed }) {
      idle(); if (!confirmed || candidates.size) throw new Error('请先取消安装候选并确认迁移'); migrating = true;
      let target, installed = false;
      try {
        const oldRoot = fs.realpathSync(root); target = path.join(fs.realpathSync(parent), `Jato-PPT-Skills-${crypto.randomUUID()}`);
        if (target.startsWith(`${oldRoot}${path.sep}`)) throw new Error('目标不能在旧技能目录内部');
        fs.mkdirSync(target); copySkillTree(oldRoot, target);
        if (directoryHash(oldRoot) !== directoryHash(target)) throw new Error('技能迁移 hash 不符，原路径保留');
        db.transaction(() => {
          for (const item of list()) db.prepare('UPDATE ppt_skills SET root=? WHERE content_hash=?').run(path.join(target, path.relative(oldRoot, item.root)), item.contentHash);
          for (const item of db.prepare('SELECT project_id,resource_json FROM ppt_projects').all()) { const resource = JSON.parse(item.resource_json || '{}'); if (resource?.skillRoot?.startsWith(`${oldRoot}${path.sep}`)) db.prepare('UPDATE ppt_projects SET resource_json=? WHERE project_id=?').run(JSON.stringify({ ...resource, skillRoot: path.join(target, path.relative(oldRoot, resource.skillRoot)) }), item.project_id); }
          db.prepare("INSERT OR REPLACE INTO resource_client_settings VALUES ('ppt_skill_root', ?)").run(JSON.stringify(target));
        })(); root = target; installed = true; return { root, retainedOldFiles: true };
      } finally { if (!installed && target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); migrating = false; }
    },
    enable({ contentHash, enabled }) { idle(); const item = list().find((value) => value.contentHash === contentHash); if (!item || !fs.existsSync(item.root) || directoryHash(item.root) !== contentHash) throw new Error('技能版本缺失或变化，请重新安装固定版本'); db.prepare('UPDATE ppt_skills SET enabled = ?, status=? WHERE content_hash = ?').run(enabled ? 1 : 0, item.metadata.executable ? 'ready' : 'workflow_only', contentHash); return list(); },
    active(contentHash, locked = false) { const item = list().find((entry) => entry.contentHash === contentHash && (entry.enabled || locked && entry.status === 'retained')); if (!item || !fs.existsSync(item.root) || directoryHash(item.root) !== contentHash) throw new Error('所选固定技能版本缺失、变化或已停用，请恢复该版本'); return item; } };
}
module.exports = { createPptSkillService, copySkillTree, unpackSkills, directoryHash };
