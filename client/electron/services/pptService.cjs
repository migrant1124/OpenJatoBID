const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { load } = require('cheerio');
const { inspectPptx, replaceNativeText, replaceNativeChartData, hash } = require('./pptTemplateService.cjs');
const { registerResourceAsset } = require('./resourceAssets.cjs');
const { parseDocumentWithConfig } = require('./fileService.cjs');
const { pageRoster, selectPages, pruneNativePages } = require('./pptPageRoster.cjs');
const { sourceObjects, updateNativeWorkspace } = require('./pptNativeWorkspace.cjs');
const { remapLinks, updatePlanDocuments } = require('./pptPageAssociations.cjs');

function validateSvg(text, root, baseDirectory = root) {
  if (Buffer.byteLength(text) > 16 * 1024 ** 2 || /<!DOCTYPE|<!ENTITY|<\s*(script|foreignObject|iframe)|\bon\w+\s*=|javascript:/i.test(text)) throw new Error('页面含脚本或不支持的内容');
  const doc = load(text, { xml: true });
  if (doc('svg').length !== 1 || !doc('svg').attr('viewBox')) throw new Error('页面缺少唯一 SVG 画幅');
  for (const node of doc('*').toArray()) for (const [name, value] of Object.entries(node.attribs || {})) {
    if (/href$/.test(name) && !String(value).startsWith('#') && !/^data:image\/(png|jpeg|webp);base64,/.test(value)) {
      const target = path.resolve(baseDirectory, value);
      if (/^[\w-]+:/.test(value) || !target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)
        || !fs.realpathSync(target).startsWith(`${fs.realpathSync(root)}${path.sep}`)) throw new Error('页面引用未授权的外部资源');
    }
    if (/url\(\s*['"]?(?!#)/i.test(value)) throw new Error('页面样式含外部资源');
  }
  const identities = doc('[id]').toArray().map((node) => doc(node).attr('id'));
  if (new Set(identities).size !== identities.length) throw new Error('页面元素 ID 重复');
  return doc;
}

function editableElements(doc) {
  return doc('svg *').toArray().map((node, index) => ({ node, elementId: doc(node).attr('id') || `svg-node:${index}` }))
    .filter(({ node }) => ['g', 'text', 'tspan', 'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'image'].includes(node.name) && !doc(node).parents('defs,clipPath,mask,pattern').length);
}

function createPptService({ app, store, resources, runtime, skills, agentService, configStore, imageStudioService, exporter, dialog, shell }) {
  const jobs = new Map();
  let closed = false;
  const db = store.db;
  const preferences = () => { const row = db.prepare("SELECT value_json FROM resource_client_settings WHERE key = 'ppt_preferences'").get(); return row ? JSON.parse(row.value_json) : {}; };
  store.recoverCommits();
  function assertIdle(id, revision, validatePages = true) {
    if (closed) throw new Error('PPT 服务已关闭');
    if (jobs.has(id)) throw new Error('项目正在制作，该页面暂为只读');
    const project = store.owned(id);
    if (revision !== undefined && project.revision !== revision) throw new Error('项目修订已变化，请重新读取');
    if (validatePages) for (const page of store.pages(id)) if (!fs.existsSync(store.inside(id, page.sourcePath)) || hash(fs.readFileSync(store.inside(id, page.sourcePath))) !== page.hash) throw new Error('页面文件缺失或已被外部修改，请先恢复或重新检查');
    return project;
  }
  function makeCandidate(project, id) {
    const candidate = store.inside(project.projectId, `candidates/${id}`); fs.mkdirSync(candidate);
    for (const name of ['sources', 'svg_output', 'svg_final', 'notes', 'materials', 'assets', 'images', 'reports', 'exports', 'native']) {
      const source = store.inside(project.projectId, name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(candidate, name), { recursive: true, dereference: false, filter: (entry) => { if (fs.lstatSync(entry).isSymbolicLink()) throw new Error('项目含越界链接'); return true; } });
      else fs.mkdirSync(path.join(candidate, name));
    }
    for (const name of ['design_spec.md', 'spec_lock.md', 'page_plan.json', 'animations.json']) {
      const source = store.inside(project.projectId, name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(candidate, name));
    }
    return candidate;
  }
  function commit(project, candidate, pages, route = project.route, resource = project.resource, signal, restored) {
    if (signal?.aborted) throw new Error('任务已取消，原版保留');
    const current = store.owned(project.projectId);
    if (current.revision !== project.revision) throw new Error('候选基准修订已变化，原版保留');
    for (const page of store.pages(project.projectId)) {
      const file = store.inside(project.projectId, page.sourcePath), actual = fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
      if (actual !== (project.recoveryHashes ? project.recoveryHashes[page.slideId] : page.hash)) throw new Error('原页面在运行中发生修改，候选不能覆盖');
    }
    const history = store.inside(project.projectId, `history/r${project.revision}-${crypto.randomUUID()}`); fs.mkdirSync(history);
    const moved = [], installed = [];
    const names = [...new Set([...fs.readdirSync(candidate).filter((name) => !name.startsWith('.runtime-')),
      'design_spec.md', 'spec_lock.md', 'page_plan.json', 'animations.json'])];
    db.prepare('INSERT INTO ppt_commit_journal(project_id, base_revision, candidate, history, names_json) VALUES (?, ?, ?, ?, ?)')
      .run(project.projectId, project.revision, candidate, history, JSON.stringify(names.map((name) => ({ name, existed: fs.existsSync(store.inside(project.projectId, name)) }))));
    try {
      for (const name of names) {
        const target = store.inside(project.projectId, name), backup = path.join(history, name);
        if (fs.existsSync(target)) { fs.renameSync(target, backup); moved.push(name); }
        if (fs.existsSync(path.join(candidate, name))) { fs.renameSync(path.join(candidate, name), target); installed.push(name); }
      }
      db.transaction(() => {
        db.prepare('INSERT INTO ppt_history(project_id, revision, folder, pages_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(project.projectId, project.revision, history, JSON.stringify({ pages: store.pages(project.projectId), route: project.route, resource: project.resource, plan: project.plan, requirements: project.requirements }), new Date().toISOString());
        store.replacePages(project.projectId, pages);
        db.prepare('UPDATE ppt_projects SET revision = revision + 1, route = ?, resource_json = ?, status = ?, confirmed_revision = NULL, updated_at = ? WHERE project_id = ?')
          .run(route, JSON.stringify(resource), 'review', new Date().toISOString(), project.projectId);
        if (restored) db.prepare('UPDATE ppt_projects SET plan_json = ?, requirements_json = ? WHERE project_id = ?').run(JSON.stringify(restored.plan), JSON.stringify(restored.requirements), project.projectId);
        db.prepare('DELETE FROM ppt_commit_journal WHERE project_id = ?').run(project.projectId);
      })();
    } catch (error) {
      for (const name of installed.reverse()) fs.renameSync(store.inside(project.projectId, name), path.join(candidate, name));
      for (const name of moved.reverse()) fs.renameSync(path.join(history, name), store.inside(project.projectId, name));
      db.prepare('DELETE FROM ppt_commit_journal WHERE project_id = ?').run(project.projectId);
      throw error;
    }
    return get(project.projectId);
  }
  async function scanPages(project, candidate, route, signal) {
    const relative = route === 'edit-native' ? 'native/authoring-svg-flat' : 'svg_output';
    const directory = path.join(candidate, relative);
    if (!fs.existsSync(directory)) throw new Error('没有所选路线的页面文件');
    const files = pageRoster(candidate, route).map((entry) => entry.fileName);
    if (!files.length) throw new Error('未生成可用页面，原版保留');
    const old = new Map(store.pages(project.projectId).map((page) => [page.sourcePath, page.slideId]));
    const pages = [];
    for (const name of files) {
      if (signal?.aborted) throw new Error('任务已取消，原版保留');
      const sourcePath = `${relative}/${name}`, content = fs.readFileSync(path.join(directory, name), 'utf8'), doc = validateSvg(content, candidate, directory);
      if (route === 'generate' && project.resource?.route === 'generate') {
        const references = [];
        const images = path.join(candidate, 'native/images');
        const collect = (root) => { if (!fs.existsSync(root)) return; for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const file = path.join(root, entry.name); if (entry.isDirectory()) collect(file); else references.push(hash(fs.readFileSync(file))); } }; collect(images);
        const [, , width, height] = doc('svg').attr('viewBox').split(/[ ,]+/).map(Number);
        for (const image of doc('image').toArray()) {
          const node = doc(image), href = node.attr('href') || node.attr('xlink:href') || '';
          const bytes = href.startsWith('data:') ? Buffer.from(href.split(',')[1] || '', 'base64') : fs.readFileSync(path.resolve(directory, href));
          if (references.includes(hash(bytes)) && Number(node.attr('width')) >= width * .9 && Number(node.attr('height')) >= height * .9) throw new Error('视觉参考重制不能以旧整页图片作为新页面底图，请生成独立内容对象');
        }
      }
      for (const node of doc('image').toArray()) for (const attribute of ['href', 'xlink:href']) {
        const reference = doc(node).attr(attribute);
        if (reference && !reference.startsWith('data:') && !reference.startsWith('#')) {
          const bytes = await sharp(path.resolve(directory, reference)).png().toBuffer();
          doc(node).attr(attribute, `data:image/png;base64,${bytes.toString('base64')}`);
        }
      }
      const slideId = old.get(sourcePath) || project.plan?.pages?.find((page) => page.fileName === name)?.slideId || crypto.randomUUID();
      const previewPath = path.join(candidate, 'svg_final', `${slideId}.png`);
      await sharp(Buffer.from(doc.xml()), { density: 96, limitInputPixels: 80_000_000 }).resize({ width: 1600, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toFile(previewPath);
      const note = `${route === 'edit-native' ? 'native/' : ''}notes/${path.basename(name, '.svg')}.md`;
      pages.push({ slideId, sourcePath, hash: hash(content), kind: route, notesPath: fs.existsSync(path.join(candidate, note)) ? note : null });
    }
    return pages;
  }
  function get(id) {
    const project = store.owned(id), roster = pageRoster(project.root, project.route), pages = store.pages(id).map((page) => {
      const preview = store.inside(id, `svg_final/${page.slideId}.png`);
      return { ...page, sourceSlide: roster.find((item) => item.fileName === path.basename(page.sourcePath))?.sourceSlide, previewUrl: fs.existsSync(preview) ? registerResourceAsset(hash(fs.readFileSync(preview)), preview) : undefined };
    });
    const answer = store.inside(id, 'reports/agent-result.md');
    return { ...project, plan: completePagePlan(project), ownerToken: undefined, pages, agentAnswer: fs.existsSync(answer) ? fs.readFileSync(answer, 'utf8') : '', jobs: store.jobs(id), runtime: runtime.status(), history: db.prepare('SELECT revision, created_at AS createdAt FROM ppt_history WHERE project_id = ? ORDER BY revision DESC').all(id) };
  }
  function completePagePlan(project) {
    const pages = store.pages(project.projectId), planned = project.plan?.pages || [];
    if (!pages.length || pages.every((page) => planned.some((item) => item.slideId === page.slideId))) return project.plan;
    return { ...project.plan, pages: [...pages.map((page, index) => ({ title: `第 ${index + 1} 页`, ...(planned.find((item) => item.slideId === page.slideId) || {}), slideId: page.slideId, fileName: path.basename(page.sourcePath) })), ...planned.filter((item) => !pages.some((page) => page.slideId === item.slideId))] };
  }
  function nativeObjects(project, root = project.root) {
    if (!project.resource?.nativePath) throw new Error('项目没有原生文件');
    const report = inspectPptx(path.join(root, project.resource.nativePath));
    const pages = pageRoster(root, 'edit-native').map((entry) => {
      const page = report.pages[entry.sourceSlide - 1], current = sourceObjects(root, entry.sourceSlide).find((item) => item.fileName === entry.fileName);
      const slideId = store.pages(project.projectId).find((item) => path.basename(item.sourcePath) === entry.fileName)?.slideId;
      return { ...page, fileName: entry.fileName, slideId, elements: page.elements.filter((item) => current.refs.has(`slide:${item.elementId}`)).map((item) => {
        const group = current.doc('[data-pptx-source-ref]').toArray().find((node) => current.doc(node).attr('data-pptx-source-ref') === `slide:${item.elementId}`);
        return { ...item, text: item.type === 'p:sp' ? current.doc(group).find('text').toArray().map((node) => current.doc(node).text()).join('') : item.text };
      }) };
    });
    return { ...report, pages, pageCount: pages.length };
  }
  function startJob(input, phase, action, allowDamaged = false) {
    const project = assertIdle(input.projectId, input.revision, !allowDamaged), jobId = crypto.randomUUID(), controller = new AbortController();
    if (allowDamaged) project.recoveryHashes = Object.fromEntries(store.pages(project.projectId).map((page) => { const file = store.inside(project.projectId, page.sourcePath); return [page.slideId, fs.existsSync(file) ? hash(fs.readFileSync(file)) : null]; }));
    const candidate = makeCandidate(project, jobId), at = new Date().toISOString();
    db.prepare('INSERT INTO ppt_jobs(job_id, project_id, status, phase, base_revision, candidate_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, project.projectId, 'running', phase, project.revision, candidate, at, at);
    const entry = { controller, jobId, candidate, promise: null }; jobs.set(project.projectId, entry);
    entry.promise = (async () => {
      try { await action({ project, candidate, signal: controller.signal }); if (controller.signal.aborted) throw new Error('任务已取消，原版保留'); db.prepare("UPDATE ppt_jobs SET status = 'completed', updated_at = ? WHERE job_id = ?").run(new Date().toISOString(), jobId); }
      catch (error) { db.prepare('UPDATE ppt_jobs SET status = ?, error = ?, updated_at = ? WHERE job_id = ?').run(controller.signal.aborted ? 'cancelled' : 'failed', error.message, new Date().toISOString(), jobId); }
      finally { jobs.delete(project.projectId); }
    })();
    return { jobId };
  }
  function importMaterials(input) {
    return startJob(input, 'materials', async ({ project, candidate, signal }) => {
    const results = [];
    for (const original of input.paths) {
      if (signal.aborted) throw new Error('资料导入已取消，原版保留');
      const source = fs.realpathSync(original), bytes = fs.statSync(source).size;
      if (bytes > 256 * 1024 ** 2) throw new Error('单份资料超过 256 MB');
      const digest = hash(fs.readFileSync(source)), name = `${digest}${path.extname(source).toLowerCase()}`;
      const copy = path.join(candidate, 'materials', name); fs.copyFileSync(source, copy);
      let text;
      if (/\.pptx$/i.test(source)) { const report = inspectPptx(copy); text = report.pages.map((page, index) => `## 第 ${index + 1} 页\n${page.elements.map((item) => item.text).filter(Boolean).join('\n')}`).join('\n\n'); fs.writeFileSync(`${copy}.structure.json`, JSON.stringify(report, null, 2), 'utf8'); }
      else if (/\.(png|jpe?g|webp)$/i.test(source)) { await sharp(copy).metadata(); text = '图片资料：只有视觉模型读取后才能解释内容；不得补造图片内文字。'; }
      else text = await parseDocumentWithConfig(app, copy, { ...configStore.load(), file_parser: { ...configStore.load().file_parser, provider: 'local' } }, { preserveImages: false });
      fs.writeFileSync(`${copy}.md`, text, 'utf8'); results.push({ name: path.basename(source), path: `materials/${name}`, hash: digest, bytes });
    }
    fs.writeFileSync(path.join(candidate, 'reports', 'material-import.json'), JSON.stringify(results, null, 2), 'utf8');
    commit(project, candidate, store.pages(project.projectId), project.route, project.resource, signal);
    });
  }
  function toolFactory({ project, candidate, signal, operation, selectedSlideIds }) {
    const safePath = (relative) => {
      const target = path.resolve(candidate, relative);
      if (!target.startsWith(`${candidate}${path.sep}`)) throw new Error('工具路径越出候选');
      let existing = target; while (!fs.existsSync(existing)) existing = path.dirname(existing);
      if (!fs.realpathSync(existing).startsWith(`${fs.realpathSync(candidate)}${path.sep}`) && existing !== candidate) throw new Error('工具路径联接越界');
      return target;
    };
    return async ({ Type, codingAgent, requestUserQuestion }) => {
      const tool = (name, description, properties, execute) => codingAgent.defineTool({ name, label: description, description,
        parameters: Type.Object(properties), async execute(_id, input) { if (signal.aborted) throw new Error('任务已取消'); const value = await execute(input); return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], details: {} }; } });
      const definitions = [
        tool('ppt_read', '读取当前候选或选定技能文件', { path: Type.String(), skill: Type.Optional(Type.Boolean()) }, (input) => {
          const target = input.skill ? path.resolve(project.resource?.skillRoot || runtime.skillRoot, input.path) : safePath(input.path);
          const skillRoot = fs.realpathSync(project.resource?.skillRoot || runtime.skillRoot);
          if (input.skill && (!target.startsWith(`${skillRoot}${path.sep}`) || !fs.realpathSync(target).startsWith(`${skillRoot}${path.sep}`))) throw new Error('技能读取越界');
          if (fs.statSync(target).size > 4 * 1024 ** 2) throw new Error('单次文本读取超限');
          return fs.readFileSync(target, 'utf8');
        }),
        tool('ppt_list', '列出候选目录', { path: Type.String() }, (input) => fs.readdirSync(input.path === '.' ? candidate : safePath(input.path))),
        tool('ppt_ask', '询问用户并等待真实确认', { question: Type.String() }, (input) => requestUserQuestion({ tool_call_id: crypto.randomUUID(), question: input.question, options: [{ label: '确认继续', custom: false }, { label: '调整方案', custom: true }] }, signal)),
      ];
      definitions.push(codingAgent.defineTool({ name: 'ppt_image_read', label: '读取项目参考图', description: '仅将用户明确启用视觉模型的项目参考图交给当前模型', parameters: Type.Object({ path: Type.String() }), async execute(_id, input) {
        if (!project.requirements.visualModelEnabled) throw new Error('尚未确认当前模型支持看图；未读取图片内容');
        if (signal.aborted) throw new Error('任务已取消');
        const file = safePath(input.path), bytes = await sharp(file, { limitInputPixels: 80_000_000 }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        if (bytes.length > 20 * 1024 ** 2) throw new Error('模型参考图大小超过限制');
        return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }], details: { path: input.path, actualImageProvided: true } };
      } }));
      if (operation === 'plan') definitions.push(tool('ppt_plan', '保存方案候选，等待用户确认后才能制作', { plan: Type.Any() }, (input) => {
        if (!Array.isArray(input.plan.pages) || !input.plan.pages.length) throw new Error('计划需要实际页面清单');
        const plan = { ...input.plan, pages: input.plan.pages.map((page) => ({ ...page, slideId: page.slideId || crypto.randomUUID() })) };
        fs.writeFileSync(path.join(candidate, 'plan-result.json'), JSON.stringify(plan), 'utf8'); return { status: 'awaiting_confirmation' };
      }));
      else definitions.push(
        codingAgent.defineTool({ name: 'ppt_image_generate', label: '项目配图', description: '使用既有生图模型、参考图处理及队列生成单张配图；必须在项目要求中明确授权限额，失败或未知不自动重发', parameters: Type.Object({ prompt: Type.String(), size: Type.String(), references: Type.Optional(Type.Array(Type.Object({ path: Type.String(), role: Type.Union(['主体','风格','构图','色彩'].map((role) => Type.Literal(role))) }))) }), async execute(callId, input) {
          if (signal.aborted) throw new Error('任务已取消');
          const limit = Number(project.requirements.imageGenerationLimit || 0);
          if (!project.requirements.imageGenerationEnabled || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('项目尚未明确启用配图及调用上限；未发送收费请求');
          const requestId = `${project.projectId}:${project.revision}:${callId}`;
          const prior = db.prepare('SELECT * FROM ppt_image_requests WHERE request_id=?').get(requestId);
          if (prior) return { content: [{ type: 'text', text: JSON.stringify({ status: prior.status, taskId: prior.task_id, message: '已有请求不重复发送；结果未知须先核对生图任务' }) }], details: {} };
          const references = [];
          for (const reference of input.references || []) { const imported = await imageStudioService.importReferenceFile(safePath(reference.path)); references.push({ assetId: imported.asset.assetId, role: reference.role }); }
          if (signal.aborted) throw new Error('任务已取消，未发送生图请求');
          const used = db.transaction(() => { const count = db.prepare('SELECT COUNT(*) AS count FROM ppt_image_requests WHERE project_id=? AND base_revision=?').get(project.projectId, project.revision).count;
            if (count >= limit) throw new Error('本修订配图请求已达明确上限，请审阅后调整方案；未发起新调用');
            db.prepare("INSERT INTO ppt_image_requests VALUES (?, ?, ?, NULL, 'preparing', ?)").run(requestId, project.projectId, project.revision, new Date().toISOString()); return count; })();
          let taskId;
          try {
            taskId = imageStudioService.submit({ requestId, prompt: input.prompt, size: input.size, count: 1, references }).taskId;
            db.prepare("UPDATE ppt_image_requests SET task_id=?,status='submitted' WHERE request_id=?").run(taskId, requestId);
            const task = await new Promise((resolve, reject) => {
              let unsubscribe, timer;
              const cleanup = () => { unsubscribe?.(); clearTimeout(timer); signal.removeEventListener('abort', abort); };
              const abort = () => { imageStudioService.cancelTask({ taskId }); cleanup(); reject(new Error('PPT 配图等待已取消；已发送结果须核对生图任务，不自动重发')); };
              const inspect = () => { const current = imageStudioService.getState().tasks.find((item) => item.taskId === taskId); if (current && !['queued','running','sent','downloading'].includes(current.status)) { cleanup(); resolve(current); } };
              unsubscribe = imageStudioService.onEvent(inspect); signal.addEventListener('abort', abort, { once: true });
              timer = setTimeout(() => { cleanup(); reject(new Error('配图等待超时，结果未知；请核对生图任务，不自动重发')); }, 600000);
              if (signal.aborted) abort(); else inspect();
            });
            db.prepare('UPDATE ppt_image_requests SET status=? WHERE request_id=?').run(task.status, requestId);
            if (task.status !== 'completed') throw new Error(`配图状态 ${task.status}：${task.error || '请核对生图记录，未重发'}`);
            const work = db.prepare('SELECT work_id,file_path,sha256 FROM image_studio_works WHERE task_id=? AND deleted_at IS NULL').get(taskId);
            if (!work || signal.aborted || hash(fs.readFileSync(work.file_path)) !== work.sha256) throw new Error('配图文件缺失、变化或任务已取消');
            const relative = `images/image-${work.work_id}.png`; await sharp(work.file_path).png().toFile(safePath(relative));
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'completed', path: relative, taskId, remaining: limit - used - 1, hash: hash(fs.readFileSync(safePath(relative))) }) }], details: {} };
          } catch (error) { db.prepare("UPDATE ppt_image_requests SET status=CASE WHEN status='preparing' THEN 'failed_before_send' WHEN status='completed' THEN status ELSE 'needs_check' END WHERE request_id=?").run(requestId); throw error; }
        } }),
        tool('ppt_native_objects', '检查当前制作页面的原生对象映射', {}, () => nativeObjects(project, candidate)),
        tool('ppt_native_replace', '替换选定原生文字或普通图表，工作簿与画面数据同时更新', { changes: Type.Optional(Type.Any()), chart: Type.Optional(Type.Any()) }, async (input) => {
          if (project.route !== 'edit-native') throw new Error('当前路线只能按参考重制');
          const source = safePath(project.resource.nativePath), target = safePath('sources/native-agent.pptx');
          const currentHash = hash(fs.readFileSync(source));
          const result = input.chart ? replaceNativeChartData({ ...input.chart, source, target, sourceHash: currentHash }) : replaceNativeText({ source, target, sourceHash: currentHash, changes: (input.changes || []).map(({ expectedText: _expected, ...change }) => change) });
          await updateNativeWorkspace({ candidate, source: target, runtime, signal, changes: input.chart ? [{ ...input.chart, chart: true }] : input.changes || [], pages: store.pages(project.projectId) });
          fs.copyFileSync(target, source);
          project.resource = { ...project.resource, sourceHash: result.hash };
          return result;
        }),
        tool('ppt_write', '写入候选页面、规划和讲稿；不执行代码', { path: Type.String(), content: Type.String() }, (input) => {
          if (project.requirements.quick === true && project.route === 'generate' && /^(design_spec|spec_lock)\.md$|^page_plan\.json$/.test(input.path)) throw new Error('Quick 不写 Default 规格、执行锁或替代规划文件');
          if (!/^(svg_output|notes|assets|images|reports|templates|analysis|authoring-svg-flat|native\/(?:authoring-svg-flat|notes))\/.+\.(svg|md|json|txt)$/.test(input.path) && !/^(design_spec|spec_lock)\.md$|^(page_plan|animations)\.json$/.test(input.path)) throw new Error('不允许的工具写入范围或类型');
          if (selectedSlideIds?.length && input.path.endsWith('.svg')) { const allowed = store.pages(project.projectId).filter((page) => selectedSlideIds.includes(page.slideId)).map((page) => page.sourcePath); if (!allowed.includes(input.path)) throw new Error('局部修改只能写选定页面'); }
          if (selectedSlideIds?.length && /^(native\/)?notes\//.test(input.path)) { const allowed = store.pages(project.projectId).filter((page) => selectedSlideIds.includes(page.slideId)).map((page) => page.notesPath || `${project.route === 'edit-native' ? 'native/' : ''}notes/${path.basename(page.sourcePath, '.svg')}.md`); if (!allowed.includes(input.path)) throw new Error('局部修改不能写未选页讲稿'); }
          const target = safePath(input.path); if (input.path.endsWith('.svg')) validateSvg(input.content, candidate, path.dirname(target));
          fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(`${target}.part`, input.content, 'utf8'); fs.renameSync(`${target}.part`, target); return { saved: input.path };
        }),
        tool('ppt_tool', '运行锁定的 ppt-master 检查与转换工具', { action: Type.Union(['check', 'finalize', 'export', 'native-import'].map((item) => Type.Literal(item))) }, async (input) => {
          const native = project.route === 'edit-native';
          const working = native ? path.join(candidate, 'native') : candidate;
          if (input.action === 'native-import') { if (!project.resource?.nativePath) throw new Error('未选择原生模板'); return { alreadyImported: true, objects: nativeObjects(project, candidate), message: '保留当前作者页面和编排；更新原生对象请使用 ppt_native_replace' }; }
          if (input.action === 'check') return runtime.run({ script: 'svg_quality_checker.py', args: [working, ...(native ? ['--roundtrip'] : project.requirements.quick === true ? ['--quick-generate'] : []), '--json'], projectRoot: candidate, signal });
          if (input.action === 'finalize') { if (native) throw new Error('原生编辑不使用普通生成 finalize'); return runtime.run({ script: 'finalize_svg.py', args: [candidate], projectRoot: candidate, signal }); }
          return runtime.run({ script: 'svg_to_pptx.py', args: [working, '-o', path.join(candidate, 'exports', 'presentation.pptx'), ...(native ? ['--roundtrip'] : project.requirements.quick === true ? ['--quick-generate'] : []), '--native-charts-and-tables'], projectRoot: candidate, signal });
        }),
      );
      return definitions;
    };
  }
  function agent(input) {
    const operation = input.operation === 'plan' ? 'plan' : 'generate';
    const value = store.owned(input.projectId);
    const quick = value.requirements.quick === true && value.route === 'generate';
    if (quick && operation === 'plan') throw new Error('已明确选择 Quick，请直接制作；此路线不生成 Default 规划文件');
    if (!quick && operation !== 'plan' && value.confirmedRevision !== value.revision) throw new Error('请先明确确认当前方案；资料或修订变化后须重新确认');
    if (quick && ['design_spec.md', 'spec_lock.md', 'page_plan.json'].some((name) => fs.existsSync(store.inside(value.projectId, name)))) throw new Error('此项目已有其他路线的规划文件，请保留该路线或另建明确选择 Quick 的项目');
    return startJob(input, operation, async ({ project, candidate, signal }) => {
      await runtime.guard(candidate, signal);
      let beautifyExpected = null;
      if (project.requirements.preserveContent && project.route === 'generate' && fs.existsSync(store.inside(project.projectId, 'reports/beautify-source.json'))) {
        const original = inspectPptx(store.inside(project.projectId, project.resource.nativePath));
        if (original.hash !== project.resource.sourceHash) throw new Error('美化原始文件已变化，请重新导入和确认');
        beautifyExpected = original.pages.map((page) => page.sourceText);
      }
      const selected = project.resource?.skillHash ? skills.active(project.resource.skillHash, true) : null;
      const skillRoot = selected?.root || runtime.skillRoot;
      const entry = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
      const result = await agentService.runTask({ mode: 'ppt', title: `PPT ${operation === 'plan' ? '规划' : '制作'}`, signal, max_retries: 0, archive_workspace: false,
        ppt_tools: toolFactory({ project: { ...project, resource: { ...project.resource, skillRoot } }, candidate, signal, operation, selectedSlideIds: input.slideIds }),
        session_instructions: `你是 Jato PPT 助手，runtime_id=pi。只依据用户材料，不使用模板旧事实。只准宿主 PPT 工具，不准 shell、外部 Skill、MCP、扩权或安装依赖。当前 SKILL_DIR=${skillRoot}。宿主已真实执行 attribution_guard，后续按唯一选定路线的文档顺序执行，遇 blocking gate 必须 ppt_ask 并等待用户，不伪造回执。确认表面以用户指令和 requirements.confirmationSurface 为准；本应用仅提供宿主问答框，未明确选择 chat 时须先用 ppt_ask 让用户选择在此确认，再继续 chat 分支。不能启动额外服务器或伪造 UI 回执；保留两个阶段的合同及三个方案意图。${quick ? '用户已明确选择 Quick；按 quick-generate 的独立合同执行，不伪造 Default 的 spec/lock。' : '普通 Default 不使用 Quick。'}${project.requirements.preserveContent ? '美化路线必须逐页保留原始文字、页数与顺序，不能偷偷改写事实。' : ''}${operation === 'plan' ? '只形成完整计划，不生成后续阶段文件；用 ppt_plan 保存计划。' : '只执行已确认范围；局部修改保留无关文件；工具检查失败不标完成。'}\n${entry}`,
        prompt: JSON.stringify({ operation, instruction: input.instruction, requirements: project.requirements, plan: project.plan, confirmedRevision: project.confirmedRevision, route: project.route, selectedSlideIds: input.slideIds || [], materials: fs.readdirSync(path.join(candidate, 'materials')) }) });
      if (signal.aborted) throw new Error('任务已取消');
      const nextResource = project.route === 'edit-native' && project.resource?.nativePath ? { ...project.resource, sourceHash: hash(fs.readFileSync(path.join(candidate, project.resource.nativePath))) } : project.resource;
      fs.writeFileSync(path.join(candidate, 'reports', 'agent-result.md'), result.assistant_text || '', 'utf8');
      if (operation === 'plan') {
        const file = path.join(candidate, 'plan-result.json'); if (!fs.existsSync(file)) throw new Error('Agent 未提供完整页面计划');
        const plan = JSON.parse(fs.readFileSync(file, 'utf8')); fs.unlinkSync(file);
        commit(project, candidate, store.pages(project.projectId), project.route, project.resource, signal, { plan, requirements: project.requirements });
      } else {
        const native = project.route === 'edit-native', working = native ? path.join(candidate, 'native') : candidate;
        await runtime.run({ script: 'svg_quality_checker.py', args: [working, ...(native ? ['--roundtrip'] : project.requirements.quick === true ? ['--quick-generate'] : []), '--json'], projectRoot: candidate, signal });
        const pages = await scanPages(project, candidate, project.route, signal);
        if (beautifyExpected) {
          const compact = (text) => text.replace(/\s+/g, '');
          if (pages.length !== beautifyExpected.length) throw new Error('美化改变了原文页数，候选保留但不应用');
          for (let index = 0; index < pages.length; index++) { const file = path.join(candidate, pages[index].sourcePath), doc = validateSvg(fs.readFileSync(file, 'utf8'), candidate, path.dirname(file)); const actual = doc('text').toArray().map((item) => doc(item).text()).join(''); if (compact(actual) !== compact(beautifyExpected[index])) throw new Error(`美化第${index + 1}页改变了原始文字或顺序，候选保留但不应用`); }
        }
        if (input.slideIds?.length) {
          const sameFile = (relative) => { const original = path.join(project.root, relative), next = path.join(candidate, relative); return fs.existsSync(original) === fs.existsSync(next) && (!fs.existsSync(original) || hash(fs.readFileSync(original)) === hash(fs.readFileSync(next))); };
          const unselected = store.pages(project.projectId).filter((page) => !input.slideIds.includes(page.slideId));
          for (const page of unselected) {
            if (!sameFile(page.sourcePath)) throw new Error('局部任务改动了受保护页面，候选保留但不应用');
            const note = page.notesPath || `${project.route === 'edit-native' ? 'native/' : ''}notes/${path.basename(page.sourcePath, '.svg')}.md`;
            if (!sameFile(note)) throw new Error('局部任务改动了未选页讲稿，候选不应用');
            const doc = validateSvg(fs.readFileSync(path.join(project.root, page.sourcePath), 'utf8'), project.root, path.dirname(path.join(project.root, page.sourcePath)));
            for (const node of doc('image').toArray()) { const href = doc(node).attr('href') || doc(node).attr('xlink:href'); if (href && !href.startsWith('data:') && !href.startsWith('#') && !sameFile(path.relative(project.root, path.resolve(project.root, path.dirname(page.sourcePath), href)))) throw new Error('局部任务改动了未选页引用图片，候选不应用'); }
          }
          const animation = project.route === 'edit-native' ? 'native/animations.json' : 'animations.json', read = (base) => fs.existsSync(path.join(base, animation)) ? JSON.parse(fs.readFileSync(path.join(base, animation), 'utf8')) : { slides: {} }, before = read(project.root), after = read(candidate);
          for (const page of unselected) { const stem = path.basename(page.sourcePath, '.svg'); if (JSON.stringify(before.slides?.[stem]) !== JSON.stringify(after.slides?.[stem])) throw new Error('局部任务改动了未选页动画，候选不应用'); }
          for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (key !== 'slides' && !(key === 'version' && before[key] === undefined) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error('局部任务改动了整稿动画设置，候选不应用');
        }
        commit(project, candidate, pages, project.route, nextResource, signal);
        if (input.annotationIds?.length) for (const id of input.annotationIds) db.prepare('UPDATE ppt_annotations SET applied_at = ? WHERE annotation_id = ? AND project_id = ?').run(new Date().toISOString(), id, project.projectId);
      }
    });
  }
  function applyAnnotations(input) {
    const project = assertIdle(input.projectId, input.revision), selected = db.prepare('SELECT * FROM ppt_annotations WHERE project_id = ? AND applied_at IS NULL').all(project.projectId).filter((item) => input.annotationIds.includes(item.annotation_id));
    if (!selected.length) throw new Error('没有选择未应用的批注');
    const pages = store.pages(project.projectId);
    for (const item of selected) if (!pages.some((page) => page.slideId === item.slide_id && page.hash === item.source_hash)) throw new Error('批注目标页已变化，请重新审阅后保存批注');
    return agent({ ...input, operation: 'generate', slideIds: [...new Set(selected.map((item) => item.slide_id))], instruction: `仅应用已选批注，保持其他页面：\n${selected.map((item) => JSON.stringify({ slideId: item.slide_id, elementId: item.element_id, instruction: item.instruction })).join('\n')}` });
  }
  async function exportProject(input) {
    const project = assertIdle(input.projectId, input.revision);
    if (!['pptx', 'pdf', 'notes', 'images', 'mp4'].includes(input.format) || input.format === 'mp4' && !project.requirements.mediaEnabled) throw new Error('所选媒体格式尚未明确启用，未发起付费或外部请求');
    const output = input.format === 'images'
      ? await dialog.showOpenDialog({ title: '选择页面图片导出父目录', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showSaveDialog({ title: '导出 PPT 项目', defaultPath: `${project.title.replace(/[<>:"/\\|?*]/g, '_')}.${input.format === 'notes' ? 'md' : input.format}`, filters: [{ name: '成品', extensions: [input.format === 'notes' ? 'md' : input.format] }] });
    if (output.canceled) return { cancelled: true };
    return startJob(input, 'export', async ({ candidate, signal }) => {
      const pages = store.pages(project.projectId).filter((page) => !input.slideIds?.length || input.slideIds.includes(page.slideId));
      if (!pages.length) throw new Error('未选择有效页面');
      if (input.slideIds?.length) selectPages(candidate, { ...project, pages: store.pages(project.projectId) }, pages);
      if (input.format === 'images') {
        await exporter.check({ root: candidate, project, pages, signal });
        const target = path.join(output.filePaths[0], `Jato-PPT-${crypto.randomUUID()}`); fs.mkdirSync(target);
        for (const page of pages) { if (signal.aborted) throw new Error('导出已取消'); const source = path.join(candidate, 'svg_final', `${page.slideId}.png`); if (!fs.existsSync(source)) throw new Error('页面预览缺失'); fs.copyFileSync(source, path.join(target, `${page.slideId}.png`)); }
        fs.writeFileSync(path.join(candidate, 'reports', 'export-result.json'), JSON.stringify({ format: input.format, target, revision: project.revision, pages: pages.map((page) => page.slideId) }), 'utf8');
      } else {
        const result = await exporter.build({ root: candidate, project, pages, format: input.format, signal });
        if (signal.aborted) throw new Error('导出已取消');
        const part = `${output.filePath}.part`; fs.copyFileSync(result.file, part);
        if (hash(fs.readFileSync(part)) !== result.hash) throw new Error('导出副本校验失败'); fs.renameSync(part, output.filePath);
        fs.writeFileSync(path.join(candidate, 'reports', 'export-result.json'), JSON.stringify({ format: input.format, path: output.filePath, hash: result.hash, revision: project.revision, warnings: result.warnings }), 'utf8');
      }
    });
  }
  function prepareTemplate(input) {
    return startJob(input, 'template', async ({ project, candidate, signal }) => {
      const personal = input.templateId ? personalTemplates().find((item) => item.templateId === input.templateId) : null;
      const item = input.filePath ? { resourceId: `local:${hash(fs.readFileSync(input.filePath))}`, assets: [{ role: 'original' }] } : personal || await resources.getItem(input.resourceId), asset = item?.assets?.find((asset) => asset.role === 'original');
      if (!asset) throw new Error('模板原始文件尚未在管理端准备');
      const download = input.filePath ? { filePath: fs.realpathSync(input.filePath) } : personal ? { filePath: path.join(personal.root, 'template.pptx') } : await resources.loadAsset({ resourceId: item.resourceId, assetId: asset.assetId });
      if (personal) {
        const marker = JSON.parse(fs.readFileSync(path.join(personal.root, '.jato-template-owner.json'), 'utf8'));
        if (marker.templateId !== personal.templateId || hash(fs.readFileSync(download.filePath)) !== asset.hash) throw new Error('个人模板归属或文件 hash 不符');
      }
      const target = path.join(candidate, 'sources', 'template.pptx'); fs.copyFileSync(download.filePath, target);
      const structure = inspectPptx(target); fs.writeFileSync(path.join(candidate, 'reports', 'template-structure.json'), JSON.stringify(structure, null, 2), 'utf8');
      const route = structure.routeCandidate === 'edit-native' ? 'edit-native' : 'generate';
      if (project.requirements.aspectRatio && project.requirements.aspectRatio !== structure.aspectRatio && !input.ratioDecision) throw new Error(`模板是 ${structure.aspectRatio}，需求是 ${project.requirements.aspectRatio}；请明确保持原画幅或重新布局`);
      const resource = { ...project.resource, resourceId: item.resourceId, sourceHash: structure.hash, nativePath: 'sources/template.pptx', capability: 'unverified', route: input.beautify || input.ratioDecision === 'reflow' ? 'generate' : route, skillVersion: runtime.status().skillVersion };
      // 整稿替换只清空本次候选；原页面、计划及成品随提交保存到历史。
      for (const name of ['native', 'svg_output', 'svg_final', 'notes', 'exports']) { fs.rmSync(path.join(candidate, name), { recursive: true, force: true }); fs.mkdirSync(path.join(candidate, name)); }
      for (const name of ['design_spec.md', 'spec_lock.md', 'page_plan.json', 'animations.json']) fs.rmSync(path.join(candidate, name), { force: true });
      await runtime.guard(candidate, signal);
      await runtime.run({ script: 'pptx_to_svg.py', args: [target, '-o', path.join(candidate, 'native'), '--roundtrip'], projectRoot: candidate, signal });
      // 图片型模板仅提供参考；不把原整页图叠字视为重建。
      const pages = resource.route === 'edit-native' ? await scanPages(project, candidate, resource.route, signal) : [];
      const originalText = structure.pages.map((page) => page.sourceText);
      if (input.beautify) fs.writeFileSync(path.join(candidate, 'reports/beautify-source.json'), JSON.stringify({ sourceHash: structure.hash, pages: originalText }), 'utf8');
      else fs.rmSync(path.join(candidate, 'reports/beautify-source.json'), { force: true });
      const plan = pages.length ? { pages: pages.map((page, index) => ({ slideId: page.slideId, fileName: path.basename(page.sourcePath), title: `第 ${index + 1} 页`, content: input.preserveContent ? originalText[index] : '' })) } : input.beautify ? { pages: originalText.map((content, index) => ({ slideId: crypto.randomUUID(), fileName: `slide_${String(index + 1).padStart(4, '0')}.svg`, title: `第 ${index + 1} 页`, content })) } : null;
      commit(project, candidate, pages, resource.route, resource, signal, { plan, requirements: { ...project.requirements, preserveContent: Boolean(input.preserveContent), aspectRatio: input.ratioDecision === 'reflow' ? project.requirements.aspectRatio : structure.aspectRatio } });
    });
  }
  function insertLayout(input) {
    return startJob(input, 'insert-layout', async ({ project, candidate, signal }) => {
      const item = await resources.getItem(input.resourceId), asset = item?.assets.find((asset) => asset.role === 'original');
      if (item?.kind !== 'layout' || !asset) throw new Error('请选择原文件已就绪的单页版式');
      const file = await resources.loadAsset({ resourceId: item.resourceId, assetId: asset.assetId });
      const referenceId = crypto.randomUUID(), reference = `materials/layout-${referenceId}`, original = `${reference}.pptx`;
      fs.copyFileSync(file.filePath, path.join(candidate, original)); const structure = inspectPptx(path.join(candidate, original));
      if (structure.hash !== asset.hash || structure.pageCount !== 1) throw new Error('单页版式版本或真实页数不符');
      await runtime.guard(candidate, signal); await runtime.run({ script: 'pptx_to_svg.py', args: [path.join(candidate, original), '-o', path.join(candidate, reference), '--roundtrip'], projectRoot: candidate, signal });
      const native = project.route === 'edit-native', previous = store.pages(project.projectId), previousPlan = completePagePlan(project), slideId = crypto.randomUUID(), fileName = native ? `new_${slideId}.svg` : `slide_${String(previous.length + 1).padStart(4, '0')}_${slideId}.svg`, relative = `${native ? 'native/authoring-svg-flat' : 'svg_output'}/${fileName}`;
      let content;
      if (previous.length) { const file = path.join(candidate, previous[0].sourcePath), doc = validateSvg(fs.readFileSync(file, 'utf8'), candidate, path.dirname(file)); doc('svg').children().filter((_, node) => node.name !== 'defs' && !doc(node).attr('data-pptx-inherited')).remove(); content = doc.xml(); }
      else { const [width, height] = project.requirements.aspectRatio === '4:3' ? [1200,900] : [1280,720]; content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`; }
      let existingPlan = previousPlan?.pages || [];
      if (!native && previous.length) {
        const directory = path.join(candidate, 'svg_output'), notes = path.join(candidate, 'notes'), animationFile = path.join(candidate, 'animations.json'), animations = fs.existsSync(animationFile) ? JSON.parse(fs.readFileSync(animationFile, 'utf8')) : null, renamedAnimations = {};
        const names = previous.map((page, index) => ({ page, fileName: `slide_${String(index + 1).padStart(4, '0')}_${page.slideId}.svg` }));
        for (const entry of names) {
          fs.copyFileSync(path.join(candidate, entry.page.sourcePath), path.join(directory, `${entry.fileName}.part`));
          const oldStem = path.basename(entry.page.sourcePath, '.svg'), newStem = path.basename(entry.fileName, '.svg');
          if (entry.page.notesPath && fs.existsSync(path.join(candidate, entry.page.notesPath)) && path.resolve(candidate, entry.page.notesPath) !== path.join(notes, `${newStem}.md`)) fs.copyFileSync(path.join(candidate, entry.page.notesPath), path.join(notes, `${newStem}.md`));
          if (animations?.slides?.[oldStem]) renamedAnimations[newStem] = animations.slides[oldStem];
        }
        for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('.svg'))) fs.unlinkSync(path.join(directory, name));
        for (const entry of names) fs.renameSync(path.join(directory, `${entry.fileName}.part`), path.join(directory, entry.fileName));
        existingPlan = existingPlan.map((page) => ({ ...page, fileName: names.find((entry) => entry.page.slideId === page.slideId)?.fileName || page.fileName }));
        if (animations?.slides) fs.writeFileSync(animationFile, JSON.stringify({ ...animations, slides: renamedAnimations }, null, 2), 'utf8');
      }
      fs.writeFileSync(path.join(candidate, relative), content, 'utf8');
      if (native) { const roster = pageRoster(candidate, project.route).filter((page) => page.fileName !== fileName); fs.writeFileSync(path.join(candidate, 'native/page_plan.json'), JSON.stringify({ schema: 'ppt-master.roundtrip-page-plan.v1', pages: [...roster.map((page) => ({ source_slide: page.sourceSlide, svg: page.fileName })), { source_slide: roster[0].sourceSlide, svg: fileName }] }, null, 2), 'utf8'); }
      const plan = { ...previousPlan, pages: [...existingPlan, { slideId, fileName, title: `按${item.title}制作新页`, content: '', level: 1, sourceRefs: reference, expression: '按单页视觉参考生成独立新对象；未套用', materialNeeds: '依据用户确认内容制作，不能沿用模板旧事实' }] };
      if (!native) updatePlanDocuments(candidate, project.plan?.pages || [], plan.pages);
      fs.writeFileSync(path.join(candidate, 'reports', `layout-${referenceId}.json`), JSON.stringify({ resourceId: item.resourceId, sourceHash: structure.hash, reference, slideId, route: 'visual-reference', status: 'awaiting_plan_confirmation' }, null, 2), 'utf8');
      const pages = await scanPages({ ...project, plan }, candidate, project.route, signal); commit(project, candidate, pages, project.route, project.resource, signal, { plan, requirements: project.requirements });
    });
  }
  function edit(input) {
    return startJob(input, 'direct-edit', async ({ project, candidate, signal }) => {
    const page = store.pages(input.projectId).find((page) => page.slideId === input.slideId);
    if (!page) throw new Error('目标页面不存在');
    const file = path.join(candidate, page.sourcePath);
    const doc = validateSvg(fs.readFileSync(file, 'utf8'), candidate, path.dirname(file));
    const selected = editableElements(doc).find((item) => item.elementId === input.elementId)?.node;
    if (!selected) throw new Error('该元素没有可编辑映射，请使用 Agent 修改');
    if (!doc(selected).attr('id')) doc(selected).attr('id', `jato-edit-${crypto.randomUUID()}`);
    if (input.text !== undefined) { if (!['text', 'tspan'].includes(selected.name)) throw new Error('目标不是文字元素'); doc(selected).text(input.text); }
    for (const [name, value] of Object.entries(input.attributes || {})) {
      if (!['x', 'y', 'fill', 'font-size', 'font-family', 'width', 'height', 'transform'].includes(name)) throw new Error('不支持的直接编辑属性');
      doc(selected).attr(name, String(value));
      if (selected.name === 'g' && ['font-size', 'font-family'].includes(name)) doc(selected).find('text,tspan').attr(name, String(value));
      if (selected.name === 'g' && name === 'fill') doc(selected).find('[data-pptx-part="geometry"]').attr(name, String(value));
    }
    fs.writeFileSync(file, doc.xml(), 'utf8');
    const pages = await scanPages(project, candidate, project.route, signal); commit(project, candidate, pages, project.route, project.resource, signal);
    });
  }
  async function nativeReplace(input) {
    return startJob(input, 'native-replace', async ({ project, candidate, signal }) => {
      if (project.route !== 'edit-native') throw new Error('该模板只能按视觉参考制作');
      const target = path.join(candidate, 'sources', `native-r${project.revision + 1}.pptx`);
      const options = { source: path.join(candidate, project.resource.nativePath), target, sourceHash: project.resource.sourceHash };
      const report = input.chart ? replaceNativeChartData({ ...options, ...input.chart }) : replaceNativeText({ ...options, changes: input.changes.map(({ expectedText: _expected, ...change }) => change) });
      await updateNativeWorkspace({ candidate, source: target, runtime, signal, changes: input.chart ? [{ ...input.chart, chart: true }] : input.changes, pages: store.pages(project.projectId) });
      fs.writeFileSync(path.join(candidate, 'reports', 'native-replacement.json'), JSON.stringify(report, null, 2), 'utf8');
      commit(project, candidate, await scanPages(project, candidate, 'edit-native', signal), 'edit-native', { ...project.resource, nativePath: path.relative(candidate, target).replace(/\\/g, '/'), sourceHash: report.hash, capability: 'unverified' }, signal);
    });
  }
  function restore(input) {
    return startJob(input, 'restore', async ({ project, candidate, signal }) => {
      const history = db.prepare('SELECT * FROM ppt_history WHERE project_id = ? AND revision = ?').get(project.projectId, input.historyRevision);
      if (!history) throw new Error('所选历史版本不存在');
      store.inside(project.projectId, path.relative(project.root, history.folder));
      const metadata = JSON.parse(history.pages_json);
      for (const name of fs.readdirSync(candidate)) {
        const target = path.resolve(candidate, name);
        if (!target.startsWith(`${candidate}${path.sep}`)) throw new Error('历史候选路径异常');
        fs.rmSync(target, { recursive: true, force: true });
      }
      for (const name of ['sources', 'svg_output', 'svg_final', 'notes', 'materials', 'assets', 'images', 'reports', 'exports', 'native']) fs.mkdirSync(path.join(candidate, name));
      for (const entry of fs.readdirSync(history.folder)) {
        const target = path.join(candidate, entry); if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(path.join(history.folder, entry), target, { recursive: true, dereference: false, filter: (file) => { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('历史版本含目录链接，停止恢复'); return true; } });
      }
      for (const page of metadata.pages) if (hash(fs.readFileSync(path.join(candidate, page.sourcePath))) !== page.hash) throw new Error('历史页面 hash 不符，原版保留');
      commit(project, candidate, metadata.pages, metadata.route, metadata.resource, signal, { plan: metadata.plan ?? null, requirements: metadata.requirements || project.requirements });
    }, true);
  }
  async function relocate({ projectId, parent, root: selectedRoot, revision, confirmed }) {
    if (!confirmed || closed || jobs.has(projectId)) throw new Error('迁移或重新定位需要确认并停止项目写入');
    const value = store.project(projectId); if (value.revision !== revision) throw new Error('项目修订已变化');
    return exclusive(projectId, 'relocate', async (signal) => {
    const oldRoot = value.root;
    const target = selectedRoot ? fs.realpathSync(selectedRoot) : path.join(fs.realpathSync(parent), `Jato-PPT-${projectId}`);
    if (!selectedRoot) {
      store.owned(projectId); if (fs.existsSync(target) || target.startsWith(`${oldRoot}${path.sep}`)) throw new Error('目标目录已有内容或位于旧项目内部');
      await fs.promises.cp(oldRoot, target, { recursive: true, dereference: false, filter: (file) => { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('项目含目录链接，停止迁移'); return true; } });
      const verifyCopy = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) verifyCopy(file); else if (hash(fs.readFileSync(file)) !== hash(fs.readFileSync(path.join(target, path.relative(oldRoot, file))))) throw new Error('项目迁移校验失败，原索引保留'); } }; verifyCopy(oldRoot);
    }
    const marker = JSON.parse(fs.readFileSync(path.join(target, '.jato-ppt-owner.json'), 'utf8'));
    if (marker.projectId !== projectId || marker.ownerToken !== value.ownerToken) throw new Error('目标目录归属不一致');
    for (const page of store.pages(projectId)) if (hash(fs.readFileSync(path.join(target, page.sourcePath))) !== page.hash) throw new Error('目标目录页面 hash 不符');
    const current = store.project(projectId);
    if (signal.aborted || current.revision !== revision || current.root !== oldRoot) throw new Error('迁移已取消或基准变化，原索引保留');
    db.transaction(() => {
      db.prepare('UPDATE ppt_projects SET root = ?, revision = revision + 1, confirmed_revision = NULL, updated_at = ? WHERE project_id = ?').run(target, new Date().toISOString(), projectId);
      for (const row of db.prepare('SELECT revision, folder FROM ppt_history WHERE project_id = ?').all(projectId)) db.prepare('UPDATE ppt_history SET folder = ? WHERE project_id = ? AND revision = ?').run(path.join(target, path.relative(oldRoot, row.folder)), projectId, row.revision);
    })();
    return { ...get(projectId), retainedOldRoot: oldRoot };
    });
  }
  function exclusive(id, phase, action) {
    if (closed || jobs.has(id)) throw new Error('项目正在写入或服务已关闭');
    const jobId = crypto.randomUUID(), controller = new AbortController(), at = new Date().toISOString();
    db.prepare('INSERT INTO ppt_jobs(job_id, project_id, status, phase, base_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(jobId, id, 'running', phase, store.project(id).revision, at, at);
    const entry = { controller, jobId, promise: null }; jobs.set(id, entry);
    entry.promise = (async () => {
      try { const result = await action(controller.signal); db.prepare("UPDATE ppt_jobs SET status = 'completed', updated_at = ? WHERE job_id = ?").run(new Date().toISOString(), jobId); return result; }
      catch (error) { db.prepare('UPDATE ppt_jobs SET status = ?, error = ? WHERE job_id = ?').run(controller.signal.aborted ? 'cancelled' : 'failed', error.message, jobId); throw error; }
      finally { jobs.delete(id); }
    })();
    return entry.promise;
  }
  function selectSkillVersion(input) {
    const value = assertIdle(input.projectId, input.revision), selected = input.contentHash ? skills.active(input.contentHash) : null;
    db.prepare('UPDATE ppt_projects SET resource_json = ?, revision = revision + 1, confirmed_revision = NULL WHERE project_id = ?').run(JSON.stringify({ ...value.resource, skillHash: selected?.contentHash || null, skillRoot: selected?.root || null }), value.projectId);
    return get(value.projectId);
  }
  function personalTemplates() {
    return db.prepare('SELECT * FROM ppt_personal_templates ORDER BY created_at DESC').all().map((row) => {
      const metadata = JSON.parse(row.metadata_json), file = path.join(row.root, 'cover.png');
      return { ...metadata, templateId: row.template_id, title: row.title, root: row.root, coverUrl: fs.existsSync(file) ? registerResourceAsset(hash(fs.readFileSync(file)), file) : '' };
    });
  }
  function savePersonalTemplate(input) {
    if (!input.title?.trim() || !input.parent || !input.confirmed) throw new Error('个人模板需要确认名称与保存父目录');
    return startJob(input, 'personal-template', async ({ project, candidate, signal }) => {
      const templateId = crypto.randomUUID(), root = path.join(fs.realpathSync(input.parent), `Jato-Template-${templateId}`);
      const output = await exporter.build({ root: candidate, project, pages: store.pages(project.projectId), format: 'pptx', signal });
      if (signal.aborted) throw new Error('保存个人模板已取消');
      fs.mkdirSync(root); fs.writeFileSync(path.join(root, '.jato-template-owner.json'), JSON.stringify({ templateId }), 'utf8');
      fs.copyFileSync(output.file, path.join(root, 'template.pptx'));
      const first = store.pages(project.projectId)[0]; fs.copyFileSync(path.join(candidate, `svg_final/${first.slideId}.png`), path.join(root, 'cover.png'));
      const metadata = { ...inspectPptx(output.file), resourceId: `personal:${templateId}`, center: 'templates', license: '用户个人内容', capability: 'unverified',
        assets: [{ role: 'original', assetId: output.hash, hash: output.hash }], sourceProjectId: project.projectId, sourceRevision: project.revision };
      db.prepare('INSERT INTO ppt_personal_templates VALUES (?, ?, ?, ?, ?)').run(templateId, input.title.trim(), root, JSON.stringify(metadata), new Date().toISOString());
    });
  }
  async function setPlan(input) {
    const value = assertIdle(input.projectId, input.revision);
    if (!input.plan?.pages?.length || new Set(input.plan.pages.map((page) => page.slideId)).size !== input.plan.pages.length) throw new Error('计划需要非空且稳定 ID 唯一的页面清单');
    if (!store.pages(value.projectId).length) {
      const started = startJob(input, 'page-plan', async ({ project, candidate, signal }) => commit(project, candidate, [], project.route, project.resource, signal, { plan: input.plan, requirements: input.requirements || project.requirements }));
      await jobs.get(value.projectId)?.promise;
      const completed = store.jobs(value.projectId).find((item) => item.jobId === started.jobId); if (completed.status !== 'completed') throw new Error(completed.error); return get(value.projectId);
    }
    const result = startJob(input, 'page-plan', async ({ project, candidate, signal }) => {
      const oldPages = store.pages(project.projectId), oldRoster = pageRoster(candidate, project.route), native = project.route === 'edit-native';
      const directory = path.join(candidate, native ? 'native/authoring-svg-flat' : 'svg_output');
      const moves = [], nextPlan = { ...input.plan, pages: input.plan.pages.map((page) => ({ ...page })) };
      const animationFile = path.join(candidate, native ? 'native/animations.json' : 'animations.json');
      const animations = fs.existsSync(animationFile) ? JSON.parse(fs.readFileSync(animationFile, 'utf8')) : null, nextAnimations = {};
      const nativePlan = [];
      for (let index = 0; index < nextPlan.pages.length; index++) {
        const page = nextPlan.pages[index], old = oldPages.find((item) => item.slideId === page.slideId);
        const sourceName = old ? path.basename(old.sourcePath) : oldRoster[0].fileName;
        const fileName = native ? (old ? sourceName : `new_${page.slideId}.svg`) : `slide_${String(index + 1).padStart(4, '0')}_${page.slideId}.svg`;
        const oldStem = path.basename(sourceName, '.svg'), newStem = path.basename(fileName, '.svg');
        let text = fs.readFileSync(path.join(directory, sourceName), 'utf8');
        if (!old) { const doc = validateSvg(text, candidate, directory); doc('svg').children().filter((_, node) => node.name !== 'defs' && !doc(node).attr('data-pptx-inherited')).remove(); text = doc.xml(); }
        moves.push({ fileName, text: native ? text : remapLinks(text, oldPages, nextPlan.pages) }); page.fileName = fileName;
        if (native) nativePlan.push({ source_slide: oldRoster.find((item) => item.fileName === sourceName).sourceSlide, svg: fileName });
        const noteRoot = path.join(candidate, native ? 'native/notes' : 'notes'); fs.mkdirSync(noteRoot, { recursive: true });
        const note = old?.notesPath ? path.join(candidate, old.notesPath) : path.join(noteRoot, `${oldStem}.md`);
        if (old && fs.existsSync(note) && path.resolve(note) !== path.join(noteRoot, `${newStem}.md`)) fs.copyFileSync(note, path.join(noteRoot, `${newStem}.md`));
        else if (!old) fs.writeFileSync(path.join(noteRoot, `${newStem}.md`), '', 'utf8');
        if (old && animations?.slides?.[oldStem]) nextAnimations[newStem] = animations.slides[oldStem];
      }
      if (!native) for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('.svg'))) fs.unlinkSync(path.join(directory, name));
      for (const move of moves) fs.writeFileSync(path.join(directory, move.fileName), move.text, 'utf8');
      if (native) fs.writeFileSync(path.join(candidate, 'native/page_plan.json'), JSON.stringify({ schema: 'ppt-master.roundtrip-page-plan.v1', pages: nativePlan }, null, 2), 'utf8');
      if (native) pruneNativePages(candidate, nativePlan.map((page) => page.svg));
      if (animations?.slides) fs.writeFileSync(animationFile, JSON.stringify({ ...animations, slides: nextAnimations }, null, 2), 'utf8');
      if (!native) updatePlanDocuments(candidate, project.plan?.pages || oldPages, nextPlan.pages);
      // 稳定 ID 随计划映射，文件顺序由所选上游路线的实际清单决定。
      project.plan = nextPlan;
      const pages = await scanPages(project, candidate, project.route, signal);
      commit(value, candidate, pages, project.route, project.resource, signal, { plan: nextPlan, requirements: input.requirements || project.requirements });
    });
    await jobs.get(value.projectId)?.promise;
    const job = store.jobs(value.projectId).find((item) => item.jobId === result.jobId);
    if (job.status !== 'completed') throw new Error(job.error || '页面计划未保存');
    return get(value.projectId);
  }
  return { get, list: store.list, agent, applyAnnotations, prepareTemplate, insertLayout, importMaterials, edit, nativeReplace, exportProject, restore, relocate, selectSkillVersion, personalTemplates, savePersonalTemplate, skills, runtime,
    saveNotes(input) { return startJob(input, 'notes', async ({ project, candidate, signal }) => { const page = store.pages(project.projectId).find((item) => item.slideId === input.slideId); if (!page) throw new Error('讲稿目标页不存在'); const relative = page.notesPath || `${project.route === 'edit-native' ? 'native/' : ''}notes/${path.basename(page.sourcePath, '.svg')}.md`; fs.mkdirSync(path.dirname(path.join(candidate, relative)), { recursive: true }); fs.writeFileSync(path.join(candidate, relative), input.content, 'utf8'); const pages = store.pages(project.projectId).map((item) => item.slideId === page.slideId ? { ...item, notesPath: relative } : item); commit(project, candidate, pages, project.route, project.resource, signal); }); },
    notes({ projectId, slideId }) { const page = store.pages(projectId).find((item) => item.slideId === slideId); return page?.notesPath ? fs.readFileSync(store.inside(projectId, page.notesPath), 'utf8') : ''; },
    async importNarration(input) { const selected = await dialog.showOpenDialog({ title: '选择已获授权的本地旁白音频', properties: ['openFile'], filters: [{ name: '音频', extensions: ['wav','mp3','m4a','aac'] }] }); if (selected.canceled) return { cancelled: true }; return startJob(input, 'narration', async ({ project, candidate, signal }) => { const original = fs.realpathSync(selected.filePaths[0]); if (fs.statSync(original).size > 256 * 1024 ** 2) throw new Error('音频超过256MB'); const relative = `assets/narration-${hash(fs.readFileSync(original))}${path.extname(original)}`; fs.copyFileSync(original, path.join(candidate, relative)); const report = JSON.parse((await runtime.probe({ projectRoot: candidate, file: relative, signal })).output); if (!report.streams.some((item) => item.codec_type === 'audio')) throw new Error('文件没有有效音频流'); commit(project, candidate, store.pages(project.projectId), project.route, project.resource, signal, { plan: project.plan, requirements: { ...project.requirements, mediaEnabled: true, narrationFile: relative } }); }); },
    deletedProjects() { return db.prepare('SELECT project_id AS projectId,title,root,revision,deleted_at AS deletedAt FROM ppt_projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(); },
    restoreDeleted({ projectId, root: selectedRoot, confirmed }) {
      if (!confirmed || jobs.size) throw new Error('请先停止任务并确认恢复项目索引');
      const row = db.prepare('SELECT * FROM ppt_projects WHERE project_id=? AND deleted_at IS NOT NULL').get(projectId); if (!row) throw new Error('已删除项目记录不存在');
      const target = fs.realpathSync(selectedRoot || row.root), marker = JSON.parse(fs.readFileSync(path.join(target, '.jato-ppt-owner.json'), 'utf8'));
      if (marker.projectId !== projectId || marker.ownerToken !== row.owner_token) throw new Error('恢复目录不属于该项目');
      for (const page of store.pages(projectId)) { const file = path.resolve(target, page.sourcePath); if (!fs.realpathSync(file).startsWith(`${target}${path.sep}`) || hash(fs.readFileSync(file)) !== page.hash) throw new Error('恢复页面缺失或 hash 不符，索引保持删除状态'); }
      db.transaction(() => { db.prepare('UPDATE ppt_projects SET root=?,deleted_at=NULL,revision=revision+1,confirmed_revision=NULL WHERE project_id=?').run(target, projectId); for (const item of db.prepare('SELECT revision,folder FROM ppt_history WHERE project_id=?').all(projectId)) db.prepare('UPDATE ppt_history SET folder=? WHERE project_id=? AND revision=?').run(path.join(target, path.relative(row.root, item.folder)), projectId, item.revision); })(); return get(projectId);
    },
    preferences,
    setPreferences({ parent }) { const directory = fs.realpathSync(parent); db.prepare("INSERT OR REPLACE INTO resource_client_settings(key, value_json) VALUES ('ppt_preferences', ?)").run(JSON.stringify({ ...preferences(), parent: directory })); return preferences(); },
    annotations({ projectId }) { return db.prepare('SELECT annotation_id AS annotationId, slide_id AS slideId, element_id AS elementId, source_hash AS sourceHash, instruction, created_at AS createdAt, applied_at AS appliedAt FROM ppt_annotations WHERE project_id = ? ORDER BY created_at').all(projectId); },
    saveAnnotation(input) {
      const project = assertIdle(input.projectId, input.revision), page = store.pages(project.projectId).find((item) => item.slideId === input.slideId);
      if (!page || !input.instruction?.trim()) throw new Error('请选择页面并填写批注');
      const id = crypto.randomUUID(); db.prepare('INSERT INTO ppt_annotations VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run(id, project.projectId, page.slideId, input.elementId || null, page.hash, input.instruction.trim(), new Date().toISOString());
      return { annotationId: id };
    },
    nativeObjects({ projectId }) { return nativeObjects(store.owned(projectId)); },
    async removePersonalTemplate({ templateId, confirmed }) {
      if (!confirmed) throw new Error('删除个人模板需要确认名称和路径');
      const item = personalTemplates().find((item) => item.templateId === templateId); if (!item) throw new Error('个人模板不存在');
      const marker = JSON.parse(fs.readFileSync(path.join(item.root, '.jato-template-owner.json'), 'utf8'));
      if (marker.templateId !== templateId) throw new Error('个人模板归属不符');
      await shell.trashItem(item.root); db.prepare('DELETE FROM ppt_personal_templates WHERE template_id = ?').run(templateId); return personalTemplates();
    },
    create: (input) => get(store.create(input).projectId), setPlan, confirm: (input) => { assertIdle(input.projectId, input.revision); return store.confirm(input); },
    page({ projectId, slideId }) { const page = store.pages(projectId).find((page) => page.slideId === slideId); if (!page) throw new Error('页面不存在'); const file = store.inside(projectId, page.sourcePath), doc = validateSvg(fs.readFileSync(file, 'utf8'), store.owned(projectId).root, path.dirname(file)); return { ...page, elements: editableElements(doc).map(({ node, elementId }) => ({ elementId, type: node.name, text: ['text', 'tspan'].includes(node.name) ? doc(node).text() : '', attributes: node.attribs })) }; },
    rename({ projectId, title, revision }) { assertIdle(projectId, revision); if (!title?.trim()) throw new Error('项目名称不能为空'); db.prepare('UPDATE ppt_projects SET title = ?, revision = revision + 1, confirmed_revision = NULL, updated_at = ? WHERE project_id = ?').run(title.trim(), new Date().toISOString(), projectId); return get(projectId); },
    async remove({ projectIds, confirmed }) { if (!confirmed) throw new Error('删除项目需要明确确认名称和路径'); for (const id of projectIds) { const project = assertIdle(id); await exclusive(id, 'remove', async (signal) => { if (signal.aborted) throw new Error('删除已取消'); await shell.trashItem(project.root); db.prepare('UPDATE ppt_projects SET deleted_at = ? WHERE project_id = ?').run(new Date().toISOString(), id); }); } return store.list(); },
    cancel(id) { jobs.get(id)?.controller.abort(); return { cancelled: jobs.has(id) }; },
    busy: () => jobs.size > 0,
    async close() { closed = true; [...jobs.values()].forEach((job) => job.controller.abort()); await Promise.allSettled([...jobs.values()].map((job) => job.promise)); await runtime.close(); },
    async selectDirectory() {
      const result = await dialog.showOpenDialog({ title: '选择 PPT 项目父目录', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled) return null;
      const target = fs.realpathSync(result.filePaths[0]), system = fs.realpathSync(process.env.SystemRoot || 'C:/Windows'), volume = runtime.volume(target, system);
      const probe = path.join(target, `.jato-write-probe-${crypto.randomUUID()}`); fs.writeFileSync(probe, '', { flag: 'wx' }); fs.unlinkSync(probe);
      const space = fs.statfsSync(target); return { path: target, systemVolume: volume.target === volume.system, freeBytes: space.bavail * space.bsize };
    },
    async selectMaterials() { const result = await dialog.showOpenDialog({ title: '选择 PPT 资料', properties: ['openFile', 'multiSelections'], filters: [{ name: '资料', extensions: ['docx', 'pdf', 'md', 'txt', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls'] }] }); return result.canceled ? [] : result.filePaths; },
    inspectTemplate(filePath) { const { aspectRatio, pageCount, hash } = inspectPptx(fs.realpathSync(filePath)); return { aspectRatio, pageCount, hash }; },
    async selectPpt() { const result = await dialog.showOpenDialog({ title: '选择自己的已有 PPT', properties: ['openFile'], filters: [{ name: '演示文稿', extensions: ['pptx'] }] }); return result.canceled ? null : result.filePaths[0]; },
    async selectSkill(kind) { const result = await dialog.showOpenDialog({ title: '选择技能', properties: [kind === 'folder' ? 'openDirectory' : 'openFile'], ...(kind === 'folder' ? {} : { filters: [{ name: '技能', extensions: [kind === 'zip' ? 'zip' : 'md'] }] }) }); return result.canceled ? null : result.filePaths[0]; },
  };
}
module.exports = { createPptService, validateSvg };
