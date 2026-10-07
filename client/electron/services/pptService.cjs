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
const { createPptConversationStore } = require('./pptConversationStore.cjs');
const { auditDesign, auditTemplate } = require('./pptContractAudit.cjs');

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
  store.recoverCommits();
  const conversations = createPptConversationStore(db), listeners = new Set();
  let eventSequence = 0;
  function emit(projectId, conversationId, event) { const value = { ...event, projectId, conversationId, sequence: ++eventSequence }; listeners.forEach((listener) => listener(value)); }
  const preferences = () => { const row = db.prepare("SELECT value_json FROM resource_client_settings WHERE key = 'ppt_preferences'").get(); return row ? JSON.parse(row.value_json) : {}; };
  function assertIdle(id, revision, validatePages = true) {
    if (closed) throw new Error('PPT 服务已关闭');
    if (jobs.has(id)) throw new Error('项目正在制作，该页面暂为只读');
    const project = store.owned(id);
    if (revision !== undefined && project.revision !== revision) throw new Error('项目修订已变化，请重新读取');
    if (validatePages) for (const page of store.pages(id)) if (!fs.existsSync(store.inside(id, page.sourcePath)) || hash(fs.readFileSync(store.inside(id, page.sourcePath))) !== page.hash) throw new Error('页面文件缺失或已被外部修改，请先恢复或重新检查');
    return project;
  }
  function makeCandidate(project, id, resumeScope = null) {
    const candidate = store.inside(project.projectId, `candidates/${id}`); fs.mkdirSync(candidate);
    for (const name of ['sources', 'svg_output', 'svg_final', 'notes', 'materials', 'assets', 'images', 'reports', 'exports', 'native', 'templates', 'template-import', 'template-workspace', 'template-reference']) {
      const source = store.inside(project.projectId, name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(candidate, name), { recursive: true, dereference: false, filter: (entry) => { if (fs.lstatSync(entry).isSymbolicLink()) throw new Error('项目含越界链接'); return true; } });
      else fs.mkdirSync(path.join(candidate, name));
    }
    for (const name of ['design_spec.md', 'spec_lock.md', 'page_plan.json', 'animations.json']) {
      const source = store.inside(project.projectId, name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(candidate, name));
    }
    const conversation = conversations.get({ projectId: project.projectId });
    if (!project.requirements.quick && resumeScope && JSON.stringify(resumeScope) === JSON.stringify(conversation.checkpoint?.scope || []) && conversation.checkpoint?.baseRevision === project.revision && conversation.checkpoint.fingerprint === conversations.fingerprint(project, conversation, resumeScope)) {
      const previous = store.inside(project.projectId, path.relative(project.root, conversation.checkpoint.root));
      if (fs.existsSync(previous)) fs.cpSync(previous, candidate, { recursive: true, filter: (entry) => { if (fs.lstatSync(entry).isSymbolicLink()) throw new Error('检查点含越界链接'); return !path.basename(entry).startsWith('.runtime-'); } });
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
    const planFile = path.join(candidate, 'plan-result.json');
    const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : project.plan;
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
      const slideId = old.get(sourcePath) || plan?.pages?.find((page) => page.fileName === name)?.slideId || crypto.randomUUID();
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
    const answer = store.inside(id, 'reports/agent-result.md'), agentAnswer = fs.existsSync(answer) ? fs.readFileSync(answer, 'utf8') : '';
    let conversation = conversations.get({ projectId: id });
    if (!conversation.messages.length && agentAnswer) { conversations.add(conversation.conversationId, 'assistant', agentAnswer, { migrated: true }); conversation = conversations.get({ projectId: id }); }
    const projectJobs=store.jobs(id),exportJob=db.prepare("SELECT status,candidate_root AS candidateRoot FROM ppt_jobs WHERE project_id=? AND phase='export' AND base_revision=? ORDER BY created_at DESC LIMIT 1").get(id,project.revision);let exportResult;
    if(exportJob?.status==='completed') {const report=path.join(exportJob.candidateRoot,'reports/export-result.json');if(fs.existsSync(report)){const receipt=JSON.parse(fs.readFileSync(report,'utf8')),target=receipt.path || receipt.target,valid=target && fs.existsSync(target) && (receipt.path?hash(fs.readFileSync(target))===receipt.hash:Array.isArray(receipt.files) && receipt.files.length>0 && receipt.files.every(file=>{const image=path.join(target,`${file.slideId}.png`);return fs.existsSync(image) && hash(fs.readFileSync(image))===file.hash;}));if(receipt.revision===project.revision && valid) exportResult={...receipt,folder:receipt.target || path.dirname(target)};}}
    return { ...project, conversation, plan: completePagePlan(project), ownerToken: undefined, pages, agentAnswer, jobs: projectJobs, exportResult, runtime: runtime.status(), history: db.prepare('SELECT revision, created_at AS createdAt FROM ppt_history WHERE project_id = ? ORDER BY revision DESC').all(id) };
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
    const candidate = makeCandidate(project, jobId, ['chat','plan','generate'].includes(phase) ? input.slideIds || [] : null), at = new Date().toISOString();
    db.prepare('INSERT INTO ppt_jobs(job_id, project_id, status, phase, base_revision, candidate_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, project.projectId, 'running', phase, project.revision, candidate, at, at);
    const entry = { controller, jobId, candidate, promise: null }; jobs.set(project.projectId, entry);
    entry.promise = (async () => {
      try { await action({ project, candidate, signal: controller.signal }); if (controller.signal.aborted) throw new Error('任务已取消，原版保留'); db.prepare("UPDATE ppt_jobs SET status = 'completed', updated_at = ? WHERE job_id = ?").run(new Date().toISOString(), jobId); }
      catch (error) { db.prepare('UPDATE ppt_jobs SET status = ?, error = ?, updated_at = ? WHERE job_id = ?').run(controller.signal.aborted ? 'cancelled' : 'failed', error.message, new Date().toISOString(), jobId); }
      finally { db.prepare("UPDATE ppt_questions SET status='interrupted' WHERE job_id=? AND status='pending'").run(jobId); jobs.delete(project.projectId); }
    })();
    return { jobId };
  }
  function importMaterials(input) {
    return startJob(input, 'materials', async ({ project, candidate, signal }) => {
    const results = [], ready = [];
    const conversation = conversations.get({ projectId: project.projectId });
    let applied = false;
    try {
    for (const original of input.paths) {
      if (signal.aborted) throw new Error('资料导入已取消，原版保留');
      const attachment = conversation.attachments.find((item) => item.original === original);
      if (attachment) { Object.assign(attachment,{status:'parsing',jobId:jobs.get(project.projectId).jobId}); conversations.save({ conversationId: conversation.conversationId, attachments: conversation.attachments }); }
      let copy, created = false;
      try {
      const source = fs.realpathSync(original), bytes = fs.statSync(source).size;
      if (bytes > 256 * 1024 ** 2) throw new Error('单份资料超过 256 MB');
      const digest = hash(fs.readFileSync(source)), name = `${digest}${path.extname(source).toLowerCase()}`;
      copy = path.join(candidate, 'materials', name); created = !fs.existsSync(copy); fs.copyFileSync(source, copy);
      let text;
      if (/\.pptx$/i.test(source)) { const report = inspectPptx(copy); text = report.pages.map((page, index) => `## 第 ${index + 1} 页\n${page.elements.map((item) => item.text).filter(Boolean).join('\n')}`).join('\n\n'); fs.writeFileSync(`${copy}.structure.json`, JSON.stringify(report, null, 2), 'utf8'); }
      else if (/\.(png|jpe?g|webp)$/i.test(source)) { await sharp(copy).metadata(); text = '图片资料：只有视觉模型读取后才能解释内容；不得补造图片内文字。'; }
      else text = await parseDocumentWithConfig(app, copy, { ...configStore.load(), file_parser: { ...configStore.load().file_parser, provider: 'local' } }, { preserveImages: false });
      fs.writeFileSync(`${copy}.md`, text, 'utf8'); results.push({ name: path.basename(source), path: `materials/${name}`, hash: digest, bytes });
      if (signal.aborted) throw new Error('资料解析已取消');
      if (attachment) { Object.assign(attachment, { pendingPath:`materials/${name}`,pendingHash:digest }); ready.push(attachment); }
      } catch (error) { if (created) for (const name of [copy,`${copy}.md`,`${copy}.structure.json`]) fs.rmSync(name,{force:true}); if (signal.aborted) throw error; results.push({ name: path.basename(original), status: 'failed', error: error.message }); if (attachment) Object.assign(attachment, { status: 'failed', error: error.message }); }
      conversations.save({ conversationId: conversation.conversationId, attachments: conversation.attachments });
    }
    fs.writeFileSync(path.join(candidate, 'reports', 'material-import.json'), JSON.stringify(results, null, 2), 'utf8');
    if (!results.some((item) => item.hash)) throw new Error('本次资料均解析失败，旧资料和会话保留；请移除或重试失败文件');
    commit(project, candidate, store.pages(project.projectId), project.route, project.resource, signal);
    applied = true;
    } finally {
      for (const item of conversation.attachments.filter(item => item.status === 'parsing')) {
        Object.assign(item,applied && ready.includes(item) ? {status:'ready',path:`${item.pendingPath}.md`,hash:item.pendingHash} : {status:'failed',error:'资料解析中断或候选未应用，可重试；旧资料保留'});
        delete item.pendingPath; delete item.pendingHash; delete item.jobId; if(item.status==='ready') delete item.error;
      }
      conversations.save({conversationId:conversation.conversationId,attachments:conversation.attachments});
    }
    });
  }
  function toolFactory({ project, candidate, signal, operation, selectedSlideIds, conversationId, requestId }) {
    const activeMaterials=()=>conversations.get({conversationId}).attachments.filter(item=>item.status==='ready').flatMap(item=>[item.path,item.path.replace(/\.md$/,''),`${item.path.replace(/\.md$/,'')}.structure.json`]);
    const isQuick = () => store.project(project.projectId).requirements.quick === true;
    const defaultRoute = () => project.route === 'generate' && !isQuick();
    const gate = (phase) => {
      const current = store.project(project.projectId), scope = selectedSlideIds || [];
      if (current.requirements.templateKind) conversations.requireGate(current, conversationId, 'template', scope, requestId);
      else if (defaultRoute()) { conversations.requireGate(current, conversationId, 'phase1', scope); if (phase !== 'phase1') conversations.requireGate(current, conversationId, phase, scope, requestId); }
      else if (project.route === 'edit-native') conversations.requireGate(current, conversationId, 'scope', scope, requestId);
      else conversations.requireGate(current, conversationId, 'route', scope, requestId);
    };
    const safePath = (relative) => {
      const target = path.resolve(candidate, relative);
      if (!target.startsWith(`${candidate}${path.sep}`)) throw new Error('工具路径越出候选');
      let existing = target; while (!fs.existsSync(existing)) existing = path.dirname(existing);
      if (!fs.realpathSync(existing).startsWith(`${fs.realpathSync(candidate)}${path.sep}`) && existing !== candidate) throw new Error('工具路径联接越界');
      return target;
    };
    const materialPath = (relative) => {
      const target = safePath(relative), name = path.relative(candidate,target).replace(/\\/g,'/');
      if (name.toLowerCase().startsWith('materials/') && !activeMaterials().some(file=>file.toLowerCase()===name.toLowerCase())) throw new Error('该资料已移除或尚未就绪，不属于当前有效资料范围；历史文件保留');
      return target;
    };
    const importAttachment = (summary) => {
      if (!['edit-native','beautify'].includes(summary?.route) || !['keep','reflow'].includes(summary?.ratioDecision)) throw new Error('旧稿准备须确认原生编辑或保留原文美化，以及保持画幅或重新布局');
      if (store.pages(project.projectId).length || store.project(project.projectId).requirements.quick || store.project(project.projectId).requirements.templateKind) throw new Error('已有稿件或其他路线保留；整稿替换请使用工作区现有导入确认');
      const attachment = conversations.get({conversationId}).attachments.find(item=>item.attachmentId===summary.attachmentId && item.status==='ready');
      if (!attachment) throw new Error('只能准备当前会话已就绪的旧稿附件');
      const file = materialPath(attachment.path.replace(/\.md$/,'')), structure = inspectPptx(file);
      if (structure.hash!==attachment.hash || (summary.sourceHash && summary.sourceHash!==structure.hash)) throw new Error('旧稿内容已变化，请重新导入并确认');
      if (project.requirements.creationScope==='single' && structure.pageCount!==1) throw new Error('多页旧稿请先在当前页改为整套制作；单页必须严格一页');
      if (summary.route==='edit-native' && (structure.routeCandidate!=='edit-native' || summary.ratioDecision!=='keep')) throw new Error('真实结构不支持此原生编辑路线，请确认保留原文美化或参考重制');
      return {file,structure,attachment};
    };
    return async ({ Type, codingAgent, requestUserQuestion }) => {
      const assertToolReady = () => { if (signal.aborted) throw new Error('任务已取消'); if(jobs.get(project.projectId)?.requestedImport) throw new Error('旧稿准备已接受；本任务结束后宿主真实准备，请在同一会话继续修改指令'); };
      const tool = (name, description, properties, execute) => codingAgent.defineTool({ name, label: description, description,
        parameters: Type.Object(properties), async execute(_id, input) { assertToolReady(); emit(project.projectId, conversationId, { type: 'tool_start', taskId: jobs.get(project.projectId)?.jobId, tool: name }); const value = await execute(input); emit(project.projectId, conversationId, { type: 'tool_end', taskId: jobs.get(project.projectId)?.jobId, tool: name }); return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], details: {} }; } });
      const definitions = [
        tool('ppt_select_route', '仅依据本轮用户明确快速制作指令启用Quick；单页选择不会启用', { intentQuote:Type.String() }, (input) => {
          const instruction = db.prepare('SELECT content FROM ppt_messages WHERE message_id=?').get(requestId)?.content;
          if (!instruction || input.intentQuote !== instruction || !/快速(?:生成|制作)|跳过(?:策略|方案|确认)|\bquick\b|\bfast\b/i.test(instruction) || /(?:不要|不想|不能|别|不需要)\s*(?:快速|跳过|quick|fast)/i.test(instruction)) throw new Error('Quick必须来自本轮用户明确快速制作或跳过确认的原文，不可自行推断');
          if (store.pages(project.projectId).length || ['design_spec.md','spec_lock.md','page_plan.json'].some((name) => fs.existsSync(path.join(candidate,name)))) throw new Error('已有Default稿件保留，请另建快速制作项目');
          db.prepare('UPDATE ppt_projects SET requirements_json=? WHERE project_id=?').run(JSON.stringify({...store.project(project.projectId).requirements,quick:true}),project.projectId);
          const id = crypto.randomUUID(), fingerprint = conversations.fingerprint(store.project(project.projectId),conversations.get({conversationId}),selectedSlideIds || []), job = jobs.get(project.projectId);
          db.prepare('INSERT INTO ppt_questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id,conversationId,job.jobId,job.jobId,id,'route',fingerprint,JSON.stringify({requestId,scope:selectedSlideIds || [],intentQuote:instruction}), 'answered',JSON.stringify({confirmed:true,userOperation:true,source:'本轮用户发送的明确快速指令'}),new Date().toISOString());
          return {route:'quick-generate',message:'不写Default规格、执行锁、计划，不使用finalize；仍须真实检查与导出'};
        }),
        tool('ppt_read', '读取当前候选或选定技能文件', { path: Type.String(), skill: Type.Optional(Type.Boolean()) }, (input) => {
          const target = input.skill ? path.resolve(project.resource?.skillRoot || runtime.skillRoot, input.path) : materialPath(input.path);
          const skillRoot = fs.realpathSync(project.resource?.skillRoot || runtime.skillRoot);
          if (input.skill && (!target.startsWith(`${skillRoot}${path.sep}`) || !fs.realpathSync(target).startsWith(`${skillRoot}${path.sep}`))) throw new Error('技能读取越界');
          if (fs.statSync(target).size > 4 * 1024 ** 2) throw new Error('单次文本读取超限');
          return fs.readFileSync(target, 'utf8');
        }),
        tool('ppt_list', '列出候选目录；资料仅列当前有效引用', { path: Type.String() }, (input) => {const folder=input.path==='.'?candidate:safePath(input.path);return fs.readdirSync(folder).filter(name=>path.relative(candidate,folder).toLowerCase()!=='materials' || activeMaterials().some(file=>path.basename(file)===name));}),
        tool('ppt_ask', '在当前会话询问用户；阶段确认必须带完整方案数据', { question: Type.String(), phase: Type.Optional(Type.Union(['phase1','phase2','scope','execute','template','settings','import'].map((item) => Type.Literal(item)))), summary: Type.Optional(Type.Any()) }, async (input) => {
          if (input.phase==='import') {const {structure,attachment}=importAttachment(input.summary);input.summary={attachmentId:attachment.attachmentId,name:attachment.name,sourceHash:structure.hash,pageCount:structure.pageCount,route:input.summary.route,ratioDecision:input.summary.ratioDecision};}
          if (input.phase === 'template' && (!['brand','style','layout','deck'].includes(input.summary?.kind) || input.summary?.scope !== 'project' || !input.summary?.intent || !input.summary?.sourceBoundary)) throw new Error('创建模板须明确Brand/Style/Layout/Deck、项目内工作区、用途和来源边界；不写受保护全局库');
          if (input.phase === 'settings') {
            const allowed = ['imageGenerationEnabled','imageGenerationLimit','visualModelEnabled','mediaEnabled','secondsPerPage'];
            if (!input.summary || Object.keys(input.summary).some((key) => !allowed.includes(key))) throw new Error('只可确认既有配图、视觉模型与本地媒体设置');
            if (input.summary.imageGenerationEnabled && (!Number.isInteger(input.summary.imageGenerationLimit) || input.summary.imageGenerationLimit < 1 || input.summary.imageGenerationLimit > 20)) throw new Error('启用收费配图须明确1—20次上限');
          }
          if (input.phase === 'phase1') {
            for (const key of ['purpose','audience','goal','language','aspectRatio','template']) if (!input.summary?.[key]) throw new Error(`阶段1缺少${key}，请补齐用途、受众、目标、语言、画幅与模板/自由设计`);
          }
          if (input.phase === 'phase2') {
            gate('phase1');
            const choice = conversations.get({ conversationId }).selection.template;
            if (choice) {
              const file = path.join(candidate, 'reports/template-prepared.json'), phase1 = conversations.confirmed(store.project(project.projectId), conversations.get({ conversationId }), 'phase1');
              const receipt = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
              if (!receipt || receipt.selectionHash !== hash(JSON.stringify(choice)) || receipt.phase1GateId !== phase1?.gateId || !fs.existsSync(safePath(receipt.original)) || hash(fs.readFileSync(safePath(receipt.original))) !== receipt.hash || !fs.existsSync(safePath(receipt.referenceRoot)) || require('./pptSkillService.cjs').directoryHash(safePath(receipt.referenceRoot)) !== receipt.treeHash) throw new Error('所选模板尚未按当前确认真实准备，请先调用 ppt_template_prepare');
            }
            if (!Array.isArray(input.summary?.directions) || input.summary.directions.length !== 3) throw new Error('阶段2需要三个完整方案意图');
            if (new Set(input.summary.directions.map(item=>item.title)).size !== 3) throw new Error('三个方案标题必须唯一');
            for (const [index,direction] of input.summary.directions.entries()) {
              if (typeof direction.title !== 'string' || !direction.title.trim() || !direction.style || !direction.fonts?.title || !direction.fonts?.body || !(direction.bodySize>0 && direction.bodySize<=300) || !direction.imageStrategy || typeof direction.notes !== 'boolean' || !Array.isArray(direction.pages) || !direction.pages.length || direction.pages.some(page=>typeof page.title!=='string' || !page.title.trim())) throw new Error('每种方案必须包含风格、标题/正文字体、正数字号、配图、布尔讲稿设置及页面组织');
              direction.directionId = `direction-${index+1}-${hash(JSON.stringify(direction)).slice(0,12)}`;
              for (const role of ['background','text','primary','secondary','accent','muted']) if (!/^#[\da-f]{6}$/i.test(direction.colors?.[role] || '')) throw new Error(`方案缺少${role}的具体颜色`);
              if (project.requirements.creationScope === 'single' && direction.pages.length !== 1) throw new Error('单页方案必须严格一页');
            }
          }
          if (['scope','execute'].includes(input.phase) && (!input.summary?.scopeDescription || input.summary.instruction !== db.prepare('SELECT content FROM ppt_messages WHERE message_id=?').get(requestId)?.content)) throw new Error('执行确认必须明确本轮完整用户指令和实际页面/对象范围');
          const approved = input.phase === 'execute' ? conversations.requireGate(store.project(project.projectId), conversationId, store.project(project.projectId).requirements.templateKind ? 'template' : defaultRoute() ? 'phase2' : isQuick() ? 'route' : 'scope', selectedSlideIds || []) : null;
          const options = input.phase === 'phase2' ? [...input.summary.directions.map((item) => ({ label: item.title, custom: false })), { label: '调整方案', custom: true }]
            : [{ label: '确认继续', custom: false }, { label: '调整方案', custom: true }];
          if(['scope','execute'].includes(input.phase)) input.summary.actualScope = selectedSlideIds?.length ? store.pages(project.projectId).filter((page) => selectedSlideIds.includes(page.slideId)).map((page) => ({slideId:page.slideId,source:page.sourcePath,sourceHash:page.hash})) : '本项目全部页面';
          const pending = requestUserQuestion({ tool_call_id: crypto.randomUUID(), surface:'ppt', question: input.question, options }, signal);
          const question = agentService.getPendingQuestion();
          if (!question) throw new Error('真实提问通道未产生问题，确认未建立');
          const job = jobs.get(project.projectId), gateId = input.phase ? crypto.randomUUID() : null;
          const questionScope = input.phase === 'phase1' ? [] : selectedSlideIds || [];
          const fingerprint = conversations.fingerprint(store.project(project.projectId), conversations.get({ conversationId }), questionScope);
          db.prepare('INSERT INTO ppt_questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)').run(question.question_id, conversationId, question.task_id, job.jobId, gateId, input.phase || null, fingerprint,
            JSON.stringify({ question: question.question, options: question.options, summary: input.summary, requestFingerprint: fingerprint, summaryFingerprint: hash(JSON.stringify(input.summary || {})), templateReceiptHash:input.phase==='phase2' && conversations.get({conversationId}).selection.template ? hash(fs.readFileSync(path.join(candidate,'reports/template-prepared.json'))) : null, requestId, approvedGateId: approved?.gateId, scope: questionScope }), 'pending', new Date().toISOString());
          db.prepare("UPDATE ppt_jobs SET status='waiting_user' WHERE job_id=?").run(job.jobId);
          conversations.checkpoint(conversationId, { root: candidate, baseRevision: project.revision, fingerprint, scope: selectedSlideIds || [] });
          emit(project.projectId, conversationId, { type: 'question', taskId: question.task_id, questionId: question.question_id, gateId });
          try { return await pending; }
          finally { db.prepare("UPDATE ppt_jobs SET status='running' WHERE job_id=? AND status='waiting_user'").run(job.jobId); }
        }),
        tool('ppt_template_prepare', '确认阶段1后准备已选真实模板；仅在当前受管候选中保存原件和参考页', {}, async () => {
          gate('phase1');
          const selection = conversations.get({ conversationId }).selection.template;
          if (!selection) return { freeDesign: true };
          const item = selection.resourceId ? await resources.getItem(selection.resourceId) : null;
          const asset = item?.assets?.find((entry) => entry.role === 'original');
          const personal=selection.templateId ? personalTemplates().find(item=>item.templateId===selection.templateId) : null;
          const source = selection.filePath ? fs.realpathSync(selection.filePath) : personal ? path.join(personal.root,'template.pptx') : asset ? (await resources.loadAsset({ resourceId: item.resourceId, assetId: asset.assetId })).filePath : null;
          if (!source) throw new Error('所选模板原始文件未就绪，保留选择并等待重试');
          if(personal && (JSON.parse(fs.readFileSync(path.join(personal.root,'.jato-template-owner.json'),'utf8')).templateId!==personal.templateId || hash(fs.readFileSync(source))!==personal.assets.find(asset=>asset.role==='original')?.hash)) throw new Error('个人模板副本归属或hash变化，请重新检查');
          const target = path.join(candidate, 'sources/selected-template.pptx'); fs.copyFileSync(source, target);
          const structure = inspectPptx(target);
          await runtime.run({ script: 'pptx_template_import.py', args: [target, '-o', path.join(candidate, 'template-import'), '--inheritance-mode', 'both'], projectRoot: candidate, signal });
          await runtime.run({ script: 'mirror_template_materialize.py', args: ['--kind', 'deck', path.join(candidate, 'template-import'), path.join(candidate, 'template-reference')], projectRoot: candidate, signal });
          await runtime.run({ script: 'svg_quality_checker.py', args: [path.join(candidate, 'template-reference/templates'), '--template-mode', '--json-output', path.join(candidate,'reports/template-quality.json')], projectRoot: candidate, signal });
          await runtime.run({ script: 'apply_template.py', args: [candidate, '--root', path.join(candidate, 'template-reference'), '--skip-validation'], projectRoot: candidate, signal });
          const receipt = { hash: structure.hash, treeHash: require('./pptSkillService.cjs').directoryHash(path.join(candidate,'template-reference')), installedHash:require('./pptSkillService.cjs').directoryHash(path.join(candidate,'templates')), selectionHash: hash(JSON.stringify(selection)), phase1GateId: conversations.confirmed(store.project(project.projectId), conversations.get({ conversationId }), 'phase1')?.gateId, pages: structure.pageCount, aspectRatio: structure.aspectRatio, referenceRoot: 'template-reference', original: 'sources/selected-template.pptx' };
          fs.writeFileSync(path.join(candidate, 'reports/template-prepared.json'), JSON.stringify(receipt), 'utf8'); return receipt;
        }),
      ];
      definitions.push(tool('ppt_import_attachment','按本轮已确认路线准备当前就绪旧稿；接受后由宿主真实准备，后续在同会话继续',{attachmentId:Type.String()},(input)=>{
        const approval=conversations.requireGate(store.project(project.projectId),conversationId,'import',[],requestId),summary=JSON.parse(approval.dataJson).summary;
        if(summary.attachmentId!==input.attachmentId) throw new Error('旧稿附件与本轮批准不一致');
        importAttachment(summary);jobs.get(project.projectId).requestedImport=summary;
        return {status:'accepted',message:'仅接受旧稿准备；尚未完成编辑或美化，本任务结束后宿主执行真实工具'};
      }));
      definitions.push(tool('ppt_template_asset','复制已存在且获准读取的图片到项目模板工作区；不生成或下载素材',{path:Type.String(),name:Type.String(),skill:Type.Optional(Type.Boolean())},async(input)=>{
        const current=store.project(project.projectId);if(!current.requirements.templateKind) throw new Error('尚未确认创建模板工作区');gate('phase2');
        if(path.basename(input.name)!==input.name || !/\.(png|jpe?g|webp|gif)$/i.test(input.name)) throw new Error('模板素材须使用单个图片文件名');
        let source=input.skill?null:materialPath(input.path);
        if(input.skill) {const root=fs.realpathSync(project.resource?.skillRoot || runtime.skillRoot),templates=fs.realpathSync(path.join(root,'templates'));source=path.resolve(root,input.path);if(!fs.realpathSync(source).startsWith(`${templates}${path.sep}`)) throw new Error('只读取已选固定技能内的模板素材');}
        if(fs.statSync(source).size>20*1024**2) throw new Error('模板图片超过20MB');const metadata=await sharp(source,{limitInputPixels:80_000_000}).metadata();if(!['png','jpeg','webp','gif'].includes(metadata.format) || !new RegExp(metadata.format==='jpeg'?'\\.jpe?g$':`\\.${metadata.format}$`,'i').test(input.name)) throw new Error('模板图片的真实格式与文件名须一致，只支持PNG/JPEG/WebP/GIF');if(signal.aborted) throw new Error('任务已取消');
        const target=safePath(`template-workspace/images/${input.name}`);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);return {path:`template-workspace/images/${input.name}`,hash:hash(fs.readFileSync(target))};
      }));
      definitions.push(codingAgent.defineTool({ name: 'ppt_image_read', label: '读取项目参考图', description: '仅将用户明确启用视觉模型的项目参考图交给当前模型', parameters: Type.Object({ path: Type.String() }), async execute(_id, input) {
        assertToolReady();
        if (!store.project(project.projectId).requirements.visualModelEnabled) throw new Error('尚未确认当前模型支持看图；未读取图片内容');
        if (signal.aborted) throw new Error('任务已取消');
        const file = materialPath(input.path), bytes = await sharp(file, { limitInputPixels: 80_000_000 }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        if (bytes.length > 20 * 1024 ** 2) throw new Error('模型参考图大小超过限制');
        return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }], details: { path: input.path, actualImageProvided: true } };
      } }));
      definitions.push(tool('ppt_plan', '保存同页内部方案，不跳转独立大纲', { plan: Type.Object({pages:Type.Array(Type.Object({title:Type.String(),fileName:Type.String(),slideId:Type.Optional(Type.String()),content:Type.Optional(Type.String())}),{minItems:1})},{additionalProperties:true}) }, (input) => {
        if (isQuick()) throw new Error('Quick不生成Default计划');
        gate('phase2');
        if(store.project(project.projectId).requirements.templateKind) throw new Error('创建模板只写模板工作区，不修改业务计划');
        if (!Array.isArray(input.plan.pages) || !input.plan.pages.length) throw new Error('计划需要实际页面清单');
        if (project.requirements.creationScope === 'single' && !store.pages(project.projectId).length && input.plan.pages.length !== 1) throw new Error('新建单页计划必须严格一页');
        const oldPages=project.plan?.pages || [];
        let incoming=input.plan.pages.map(page=>({...page,slideId:page.slideId || oldPages.find(old=>old.fileName===page.fileName)?.slideId || crypto.randomUUID()}));
        if(selectedSlideIds?.length && incoming.every(page=>selectedSlideIds.includes(page.slideId))) incoming=oldPages.map(page=>incoming.find(next=>next.slideId===page.slideId) || page);
        const plan = { ...project.plan, ...input.plan, pages:incoming };
        if(defaultRoute()) {const approved=conversations.requireGate(store.project(project.projectId),conversationId,'phase2',selectedSlideIds || [],requestId),direction=JSON.parse(approved.answerJson).approvedDesign,scope=JSON.parse(approved.dataJson).scope || [],pages=plan.pages.filter(page=>!scope.length || scope.includes(page.slideId));if(!direction || pages.length!==direction.pages.length || pages.some((page,index)=>page.title!==direction.pages[index].title)) throw new Error('内部计划必须保留已选择方向的页数、顺序与标题');}
        if (new Set(plan.pages.map((page) => page.slideId)).size !== plan.pages.length || new Set(plan.pages.map((page) => page.fileName)).size !== plan.pages.length) throw new Error('内部方案的页面ID和文件名必须唯一');
        fs.writeFileSync(path.join(candidate, 'plan-result.json'), JSON.stringify(plan), 'utf8'); return { status: 'saved' };
      }));
      definitions.push(tool('ppt_font_calibrate','校准指定字体角色；只使用固定text_measure，不执行外部命令',{roles:Type.Array(Type.Object({name:Type.String(),family:Type.String(),size:Type.Number()})),sample:Type.Optional(Type.String())},(input)=>{
        gate('phase2');
        if(!input.roles.length || input.roles.length>20 || input.roles.some((role)=> !/^[a-z][a-z0-9-]{0,31}$/.test(role.name) || /[:\r\n]/.test(role.family) || !role.family.trim() || !(role.size>=1 && role.size<=300)) || (input.sample?.length || 0)>4000) throw new Error('字体角色、字体或字号超出固定校准范围');
        return runtime.run({script:'text_measure.py',args:['calibrate',candidate,...input.roles.flatMap((role)=>['--role',`${role.name}:${role.family}:${role.size}`]),...(input.sample?['--sample',input.sample]:[]),'--json'],projectRoot:candidate,signal});
      }));
      if (operation !== 'plan') definitions.push(
        codingAgent.defineTool({ name: 'ppt_image_generate', label: '项目配图', description: '使用既有生图模型、参考图处理及队列生成单张配图；必须在项目要求中明确授权限额，失败或未知不自动重发', parameters: Type.Object({ prompt: Type.String(), size: Type.String(), references: Type.Optional(Type.Array(Type.Object({ path: Type.String(), role: Type.Union(['主体','风格','构图','色彩'].map((role) => Type.Literal(role))) }))) }), async execute(callId, input) {
          assertToolReady();
          gate('phase2');
          if (signal.aborted) throw new Error('任务已取消');
          const currentRequirements = store.project(project.projectId).requirements, limit = Number(currentRequirements.imageGenerationLimit || 0);
          if (!currentRequirements.imageGenerationEnabled || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('项目尚未明确启用配图及调用上限；未发送收费请求');
          const requestId = `${project.projectId}:${project.revision}:${callId}`;
          const prior = db.prepare('SELECT * FROM ppt_image_requests WHERE request_id=?').get(requestId);
          if (prior) return { content: [{ type: 'text', text: JSON.stringify({ status: prior.status, taskId: prior.task_id, message: '已有请求不重复发送；结果未知须先核对生图任务' }) }], details: {} };
          const references = [];
          for (const reference of input.references || []) { const imported = await imageStudioService.importReferenceFile(materialPath(reference.path)); references.push({ assetId: imported.asset.assetId, role: reference.role }); }
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
          gate('phase2');
          if (project.route !== 'edit-native') throw new Error('当前路线只能按参考重制');
          if (selectedSlideIds?.length && (input.chart ? [input.chart] : input.changes || []).some((item) => !selectedSlideIds.includes(item.slideId))) throw new Error('原生局部编辑只能修改已选稳定页面和对象');
          const source = safePath(project.resource.nativePath), target = safePath('sources/native-agent.pptx');
          const currentHash = hash(fs.readFileSync(source));
          const result = input.chart ? replaceNativeChartData({ ...input.chart, source, target, sourceHash: currentHash }) : replaceNativeText({ source, target, sourceHash: currentHash, changes: (input.changes || []).map(({ expectedText: _expected, ...change }) => change) });
          await updateNativeWorkspace({ candidate, source: target, runtime, signal, changes: input.chart ? [{ ...input.chart, chart: true }] : input.changes || [], pages: store.pages(project.projectId) });
          fs.copyFileSync(target, source);
          project.resource = { ...project.resource, sourceHash: result.hash };
          return result;
        }),
        tool('ppt_write', '写入候选页面、规划和讲稿；不执行代码', { path: Type.String(), content: Type.String() }, (input) => {
          input.path = path.relative(candidate,safePath(input.path)).replace(/\\/g,'/');
          if(store.project(project.projectId).requirements.templateKind && !/^(template-workspace\/(templates|images|icons)|reports|analysis)\//.test(input.path)) throw new Error('创建模板只能写模板工作区与检查报告，既有页面、讲稿和业务规划保留');
          if (!/^(analysis|reports)\//.test(input.path)) gate(/^(templates|template_reference)\//.test(input.path) ? 'phase1' : 'phase2');
          if (/^reports\/(template-prepared|gate|confirmation|quick-early|beautify-original)/.test(input.path)) throw new Error('宿主回执只由真实工具和用户操作产生');
          if (isQuick() && project.route === 'generate' && /^(design_spec|spec_lock)\.md$|^page_plan\.json$/.test(input.path)) throw new Error('Quick 不写 Default 规格、执行锁或替代规划文件');
          if (!/^(svg_output|notes|assets|images|reports|templates|analysis|template-workspace\/(?:templates|images|icons)|authoring-svg-flat|native\/(?:authoring-svg-flat|notes))\/.+\.(svg|md|json|txt)$/.test(input.path) && !/^(design_spec|spec_lock)\.md$|^(page_plan|animations)\.json$/.test(input.path)) throw new Error('不允许的工具写入范围或类型');
          if (selectedSlideIds?.length && input.path.endsWith('.svg')) { const allowed = store.pages(project.projectId).filter((page) => selectedSlideIds.includes(page.slideId)).map((page) => page.sourcePath); if (!allowed.includes(input.path)) throw new Error('局部修改只能写选定页面'); }
          if (selectedSlideIds?.length && /^(native\/)?notes\//.test(input.path)) { const allowed = store.pages(project.projectId).filter((page) => selectedSlideIds.includes(page.slideId)).map((page) => page.notesPath || `${project.route === 'edit-native' ? 'native/' : ''}notes/${path.basename(page.sourcePath, '.svg')}.md`); if (!allowed.includes(input.path)) throw new Error('局部修改不能写未选页讲稿'); }
          const target = safePath(input.path); if (input.path.endsWith('.svg')) validateSvg(input.content, candidate, path.dirname(target));
          fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(`${target}.part`, input.content, 'utf8'); fs.renameSync(`${target}.part`, target); return { saved: input.path };
        }),
        tool('ppt_tool', '运行固定参数的 ppt-master 检查、规格验证、字体校准、讲稿与模板工具', { action: Type.Union(['check', 'check-early', 'finalize', 'export', 'native-import', 'project-validate', 'font-calibrate', 'image-analyze', 'notes-split', 'template-check', 'template-review', 'beautify-inventory', 'beautify-verify'].map((item) => Type.Literal(item))) }, async (input) => {
          gate('phase2');
          const native = project.route === 'edit-native';
          const working = native ? path.join(candidate, 'native') : candidate;
          const controlled = {
            'project-validate': ['project_manager.py', ['validate', candidate]],
            'font-calibrate': ['text_measure.py', ['calibrate', candidate, '--outline', '--json']],
            'image-analyze': ['analyze_images.py', [path.join(candidate, 'images')]],
            'notes-split': ['total_md_split.py', [candidate]],
            'template-check': ['svg_quality_checker.py',[path.join(candidate,store.project(project.projectId).requirements.templateKind?'template-workspace/templates':'template-reference/templates'),'--template-mode','--canonical-authoring','--json-output',path.join(candidate,'reports/template-quality.json')]],
            'template-review': ['template_preview_pptx.py', [path.join(candidate,store.project(project.projectId).requirements.templateKind?'template-workspace':'template-reference'), '-o', path.join(candidate, 'exports/template-review.pptx'), '--force']],
            'beautify-inventory': ['beautify_inventory.py', [path.join(candidate, 'analysis/template.slide_library.json'), ...(fs.existsSync(path.join(candidate,'images/image_manifest.json')) ? ['--images',path.join(candidate,'images/image_manifest.json')] : []), '-o', path.join(candidate, 'analysis/beautify-inventory.json')]],
            'beautify-verify': ['beautify_inventory.py', [path.join(candidate, 'reports/beautify-original-inventory.json'), '--verify', path.join(candidate, 'exports/presentation.pptx')]],
          }[input.action];
          if (controlled) return runtime.run({ script: controlled[0], args: controlled[1], projectRoot: candidate, signal });
          if (input.action === 'native-import') { if (!project.resource?.nativePath) throw new Error('未选择原生模板'); return { alreadyImported: true, objects: nativeObjects(project, candidate), message: '保留当前作者页面和编排；更新原生对象请使用 ppt_native_replace' }; }
          if (input.action === 'check-early') { if(!isQuick() || pageRoster(candidate,project.route).length !== 5) throw new Error('Quick早期检查必须在P05之后、P06之前'); const result = await runtime.run({script:'svg_quality_checker.py',args:[candidate,'--quick-generate','--canonical-authoring','--stage','early','--json'],projectRoot:candidate,signal}); fs.writeFileSync(path.join(candidate,'reports/quick-early.json'),JSON.stringify({jobId:jobs.get(project.projectId).jobId,pages:pageRoster(candidate,project.route).map(page=>({fileName:page.fileName,hash:hash(fs.readFileSync(path.join(candidate,'svg_output',page.fileName)))})),result}),'utf8'); return result; }
          if (input.action === 'check') return runtime.run({ script: 'svg_quality_checker.py', args: [working, ...(native ? ['--roundtrip'] : isQuick() ? ['--quick-generate','--canonical-authoring','--stage','final'] : ['--canonical-authoring']), '--json'], projectRoot: candidate, signal });
          if (input.action === 'finalize') { if (native || isQuick()) throw new Error('原生编辑和Quick不使用普通生成 finalize'); return runtime.run({ script: 'finalize_svg.py', args: [candidate], projectRoot: candidate, signal }); }
          return runtime.run({ script: 'svg_to_pptx.py', args: [working, '-o', path.join(candidate, 'exports', 'presentation.pptx'), ...(native ? ['--roundtrip'] : isQuick() ? ['--quick-generate'] : []), '--native-charts-and-tables'], projectRoot: candidate, signal });
        }),
      );
      return definitions;
    };
  }
  function agent(input) {
    const operation = input.operation === 'plan' ? 'plan' : input.operation === 'chat' ? 'chat' : 'generate';
    const value = store.owned(input.projectId);
    const conversation = conversations.get({ projectId: value.projectId });
    if (input.conversationId && input.conversationId !== conversation.conversationId) throw new Error('项目与会话不一致');
    let quick = value.requirements.quick === true && value.route === 'generate';
    if (quick && operation === 'plan') throw new Error('已明确选择 Quick，请直接制作；此路线不生成 Default 规划文件');
    if (!quick && operation === 'generate' && value.route === 'generate') conversations.requireGate(value, conversation.conversationId, 'phase2', input.slideIds || []);
    if (quick && ['design_spec.md', 'spec_lock.md', 'page_plan.json'].some((name) => fs.existsSync(store.inside(value.projectId, name)))) throw new Error('此项目已有其他路线的规划文件，请保留该路线或另建明确选择 Quick 的项目');
    return startJob(input, operation, async ({ project, candidate, signal }) => {
      const requestId = conversations.add(conversation.conversationId, 'user', input.instruction, { scope: input.slideIds || [] });
      conversations.save({ conversationId: conversation.conversationId, text: '' });
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
      const hostContract = `新项目上传旧PPT后，先用ppt_ask import确认当前ready附件attachmentId、route=edit-native或beautify、ratioDecision=keep或reflow；随后ppt_import_attachment传批准的attachmentId，只接受准备而不宣称已编辑。宿主真实准备结束后，用户在同一会话继续原生scope或美化两阶段，不能把导入准备说成制作完成。当前持久PPT会话：${conversation.conversationId}。用户正在同页多轮沟通。先读取 workflows/routing.md 及唯一选定路线。Default用ppt_ask phase1确认purpose/audience/goal/language/aspectRatio/template；确认后调用ppt_template_prepare准备所选原件，不能再改受批准模板字节。阶段2提供directions恰好三种完整方案：唯一title、style、colors六角色background/text/primary/secondary/accent/muted的hex、fonts.title/body、bodySize正数、imageStrategy、notes布尔、pages标题对象数组。用户选择后，ppt_plan的完整页面清单和产物必须与所选方向一致，spec_lock.colors使用bg/text/primary/secondary/accent/muted，typography用title_family/body_family/body，不能悄悄换色、字体、页数或讲稿设置。普通单页严格1页，不是Quick。已有方案后新指令用ppt_ask execute，summary.instruction精确为本轮完整用户原文并提供scopeDescription，同一会话批准后沿用设计，局部任务保留未选页与内部计划。原生编辑用scope确认实际页面和对象，ppt_native_objects映射后调用ppt_native_replace，不把截图叠字称为原生编辑。用户明确快速制作时先ppt_select_route传本轮完整原文intentQuote，Quick不询问Default策略、不写spec/lock/计划，按真实quick-generate文档校准字体；首次七页以上P05完成后用check-early再写P06，最终检查使用Quick双flags和final，无页数上限、不调用finalize。创建模板用ppt_ask template确认kind=brand/style/layout/deck、scope=project、intent及sourceBoundary，只写template-workspace/templates下带kind与id的完整规格（design_spec.kind.id.md）及相应资源和检查报告；Brand/Style仅完整规格，Layout/Deck完整原型加预览；关联已有素材用ppt_template_asset复制当前候选/有效附件或固定技能templates下图片到template-workspace/images，不生成/下载素材，TODO骨架不算完成。美化读取冻结原始文字、数据及图形清单，保持页数、顺序与全部事实；用beautify-inventory/beautify-verify检验。费用、视觉模型和本地媒体使用settings确认既有参数后方可调用相应工具，不扩大权限。ppt_font_calibrate只接字体角色name/family/size及可选sample。chat可以仅澄清，不捏造页面；确认须来自用户真实操作，等待回答后原任务恢复。`;
      const result = await agentService.runTask({ mode: 'ppt', title: `PPT ${operation === 'plan' ? '规划' : '制作'}`, signal, max_retries: 0, archive_workspace: false,
        onEvent(event) {
          emit(project.projectId, conversation.conversationId, { ...event, taskId: event.task_id });
          if (event.type === 'assistant_end') conversations.add(conversation.conversationId, 'assistant', event.text, { jobId: jobs.get(project.projectId)?.jobId, taskId: event.task_id });
        },
        ppt_tools: toolFactory({ project: { ...project, resource: { ...project.resource, skillRoot } }, candidate, signal, operation, selectedSlideIds: input.slideIds, conversationId: conversation.conversationId, requestId }),
        session_instructions: `你是 Jato PPT 助手，runtime_id=pi。只依据用户材料，不使用模板旧事实。只准宿主 PPT 工具，不准 shell、外部 Skill、MCP、扩权或安装依赖。当前 SKILL_DIR=${skillRoot}。宿主已真实执行 attribution_guard，后续按唯一选定路线的文档顺序执行，遇 blocking gate 必须 ppt_ask 并等待用户，不伪造回执。确认表面以用户指令和 requirements.confirmationSurface 为准；本应用仅提供宿主问答框，未明确选择 chat 时须先用 ppt_ask 让用户选择在此确认，再继续 chat 分支。不能启动额外服务器或伪造 UI 回执；保留两个阶段的合同及三个方案意图。${quick ? '用户已明确选择 Quick；按 quick-generate 的独立合同执行，不伪造 Default 的 spec/lock。' : '普通 Default 不使用 Quick。'}${project.requirements.preserveContent ? '美化路线必须逐页保留原始文字、页数与顺序，不能偷偷改写事实。' : ''}${operation === 'plan' ? '只形成完整计划，不生成后续阶段文件；用 ppt_plan 保存计划。' : '只执行已确认范围；局部修改保留无关文件；工具检查失败不标完成。'}\n${entry}\n宿主控制合同优先：${hostContract}`,
        prompt: JSON.stringify({ operation, instruction: input.instruction, requirements: project.requirements, plan: project.plan, conversation: { messages: conversation.messages, selection: conversation.selection, attachments: conversation.attachments.filter((item) => item.status === 'ready').map(({ original: _original, ...item }) => item), confirmations: conversation.questions.filter((item) => item.status === 'answered') }, route: project.route, selectedSlideIds: input.slideIds || [], materials:conversation.attachments.filter(item=>item.status==='ready').map(item=>item.path),materialBoundary:'仅当前有效附件是本轮资料；已移除条目及其历史谈话不能继续作为新内容事实来源' }) });
      if (signal.aborted) throw new Error('任务已取消');
      const requestedImport = jobs.get(project.projectId).requestedImport;
      if (requestedImport) {
        const attachment=conversations.get({conversationId:conversation.conversationId}).attachments.find(item=>item.attachmentId===requestedImport.attachmentId && item.status==='ready');
        if(!attachment) throw new Error('旧稿附件已失效，候选未应用');
        const file=path.join(candidate,attachment.path.replace(/\.md$/,''));
        if(hash(fs.readFileSync(file))!==requestedImport.sourceHash) throw new Error('旧稿确认后内容已变化，候选未应用');
        const prepared=await prepareTemplateCandidate({project,candidate,signal},{filePath:file,beautify:requestedImport.route==='beautify',preserveContent:requestedImport.route==='beautify',ratioDecision:requestedImport.ratioDecision});
        commit(project,candidate,prepared.pages,prepared.resource.route,prepared.resource,signal,{plan:prepared.plan,requirements:prepared.requirements});
        conversations.add(conversation.conversationId,'assistant','旧稿已按确认路线真实准备。编辑或美化尚未完成，请在同一会话继续本轮修改要求。',{jobId:jobs.get(project.projectId).jobId});
        conversations.checkpoint(conversation.conversationId,null);emit(project.projectId,conversation.conversationId,{type:'chat_complete',taskId:jobs.get(project.projectId).jobId});return;
      }
      const nextResource = project.route === 'edit-native' && project.resource?.nativePath ? { ...project.resource, sourceHash: hash(fs.readFileSync(path.join(candidate, project.resource.nativePath))) } : project.resource;
      fs.writeFileSync(path.join(candidate, 'reports', 'agent-result.md'), result.assistant_text || '', 'utf8');
      if (!conversations.get({ conversationId: conversation.conversationId }).messages.some((item) => item.role === 'assistant' && JSON.parse(item.metadataJson).jobId === jobs.get(project.projectId)?.jobId && item.content === result.assistant_text)) conversations.add(conversation.conversationId, 'assistant', result.assistant_text, { jobId: jobs.get(project.projectId)?.jobId });
      project.requirements = store.project(project.projectId).requirements;
      quick = project.requirements.quick === true && project.route === 'generate';
      if (project.requirements.templateKind && require('./pptSkillService.cjs').directoryHash(path.join(candidate,'template-workspace')) !== (fs.existsSync(path.join(project.root,'template-workspace')) ? require('./pptSkillService.cjs').directoryHash(path.join(project.root,'template-workspace')) : hash('[]'))) {
        conversations.requireGate(project,conversation.conversationId,'template',input.slideIds || [],requestId);
        auditTemplate(path.join(candidate,'template-workspace'),project.requirements.templateKind);
        for(const name of ['svg_output','svg_final','notes','images','assets','native','templates','design_spec.md','spec_lock.md','page_plan.json','animations.json']) {
          const original=path.join(project.root,name),next=path.join(candidate,name), fingerprint=file=>fs.existsSync(file)?fs.statSync(file).isDirectory()?require('./pptSkillService.cjs').directoryHash(file):hash(fs.readFileSync(file)):hash('[]');
          if(fingerprint(original)!==fingerprint(next)) throw new Error('创建模板改动了既有业务页面或关联资源，候选不应用');
        }
        await runtime.run({script:'svg_quality_checker.py',args:[path.join(candidate,'template-workspace/templates'),'--template-mode','--canonical-authoring','--json-output',path.join(candidate,'reports/template-quality.json')],projectRoot:candidate,signal});
        if(['layout','deck'].includes(project.requirements.templateKind)) await runtime.run({script:'template_preview_pptx.py',args:[path.join(candidate,'template-workspace'),'-o',path.join(candidate,'exports/template-review.pptx'),'--force'],projectRoot:candidate,signal});
        commit(project,candidate,store.pages(project.projectId),project.route,project.resource,signal); conversations.checkpoint(conversation.conversationId,null); return;
      }
      const generated = pageRoster(candidate, project.route);
      const existing = store.pages(project.projectId);
      const changedPages = generated.some((entry) => { const relative = `${project.route === 'edit-native' ? 'native/authoring-svg-flat' : 'svg_output'}/${entry.fileName}`; return existing.find((page) => page.sourcePath === relative)?.hash !== hash(fs.readFileSync(path.join(candidate, relative))); }) || generated.length !== existing.length
        || existing.some((page) => page.notesPath && fs.existsSync(path.join(candidate, page.notesPath)) && hash(fs.readFileSync(path.join(candidate, page.notesPath))) !== hash(fs.readFileSync(path.join(project.root, page.notesPath))));
      if (operation === 'chat' && !changedPages) {
        conversations.checkpoint(conversation.conversationId, { root: candidate, baseRevision: project.revision, fingerprint: conversations.fingerprint(project, conversations.get({ conversationId: conversation.conversationId }), input.slideIds || []), scope: input.slideIds || [] });
        emit(project.projectId, conversation.conversationId, { type: 'chat_complete', taskId: jobs.get(project.projectId)?.jobId }); return;
      }
      if (operation === 'plan') {
        conversations.requireGate(project, conversation.conversationId, project.route === 'edit-native' ? 'scope' : 'phase2', input.slideIds || [], requestId);
        const file = path.join(candidate, 'plan-result.json'); if (!fs.existsSync(file)) throw new Error('Agent 未提供完整页面计划');
        const plan = JSON.parse(fs.readFileSync(file, 'utf8')); fs.unlinkSync(file);
        commit(project, candidate, store.pages(project.projectId), project.route, project.resource, signal, { plan, requirements: project.requirements });
      } else {
        const native = project.route === 'edit-native', working = native ? path.join(candidate, 'native') : candidate;
        if (!quick) { if (!native) conversations.requireGate(project, conversation.conversationId, 'phase1', input.slideIds || []); conversations.requireGate(project, conversation.conversationId, native ? 'scope' : 'phase2', input.slideIds || [], requestId); }
        else conversations.requireGate(project, conversation.conversationId, 'route', input.slideIds || [], requestId);
        if (quick && !existing.length && pageRoster(candidate,project.route).length >= 7) {const file=path.join(candidate,'reports/quick-early.json'),receipt=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null,firstFive=pageRoster(candidate,project.route).slice(0,5);if(!receipt || receipt.jobId!==jobs.get(project.projectId).jobId || receipt.result?.exitCode!==0 || !Array.isArray(receipt.pages) || receipt.pages.length!==5 || receipt.pages.some((page,index)=>page.fileName!==firstFive[index].fileName || hash(fs.readFileSync(path.join(candidate,'svg_output',page.fileName)))!==page.hash)) throw new Error('七页以上Quick缺少本次制作的真实P05早期检查，候选未应用');}
        await runtime.run({ script: 'svg_quality_checker.py', args: [working, ...(native ? ['--roundtrip'] : quick ? ['--quick-generate','--canonical-authoring','--stage','final'] : ['--canonical-authoring']), '--json'], projectRoot: candidate, signal });
        const pages = await scanPages(project, candidate, project.route, signal);
        if(beautifyExpected) {const exported=await exporter.build({root:candidate,project,pages,format:'pptx',signal});fs.writeFileSync(path.join(candidate,'reports/beautify-facts-check.json'),JSON.stringify({hash:exported.hash,...require('./pptTemplateService.cjs').auditContentFacts(path.join(candidate,project.resource.nativePath),exported.file)}),'utf8');}
        if (project.requirements.creationScope === 'single' && !existing.length && pages.length !== 1) throw new Error('新建单页必须严格生成一页，不允许封面、目录或总结附加页');
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
        const planFile = path.join(candidate, 'plan-result.json'), nextPlan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : project.plan;
        if(!native && !quick) {
          const approval=conversations.requireGate(project,conversation.conversationId,'phase2',input.slideIds || [],requestId),data=JSON.parse(approval.dataJson),answer=JSON.parse(approval.answerJson);
          if(hash(JSON.stringify(data.summary))!==data.summaryFingerprint || !answer.approvedDesign) throw new Error('完整方案确认记录缺失或变化，请重新选择方案');
          auditDesign({root:candidate,direction:answer.approvedDesign,requirements:project.requirements,plan:nextPlan,actualPages:pages,scope:input.slideIds || [],directionScope:data.scope,oldPlan:project.plan});
          if(conversation.selection.template) {const file=path.join(candidate,'reports/template-prepared.json'),receipt=JSON.parse(fs.readFileSync(file,'utf8'));if(data.templateReceiptHash!==hash(fs.readFileSync(file)) || hash(fs.readFileSync(path.join(candidate,receipt.original)))!==receipt.hash || require('./pptSkillService.cjs').directoryHash(path.join(candidate,'templates'))!==receipt.installedHash) throw new Error('模板批准后的原件或安装文件已变化，请重新准备并确认方案');}
        }
        if (fs.existsSync(planFile)) fs.unlinkSync(planFile);
        commit(project, candidate, pages, project.route, nextResource, signal, { plan: nextPlan, requirements: project.requirements });
        conversations.checkpoint(conversation.conversationId, null);
        if (input.annotationIds?.length) for (const id of input.annotationIds) db.prepare('UPDATE ppt_annotations SET applied_at = ? WHERE annotation_id = ? AND project_id = ?').run(new Date().toISOString(), id, project.projectId);
      }
    });
  }
  function applyAnnotations(input) {
    const project = assertIdle(input.projectId, input.revision), selected = db.prepare('SELECT * FROM ppt_annotations WHERE project_id = ? AND applied_at IS NULL').all(project.projectId).filter((item) => input.annotationIds.includes(item.annotation_id));
    if (!selected.length) throw new Error('没有选择未应用的批注');
    const pages = store.pages(project.projectId);
    for (const item of selected) if (!pages.some((page) => page.slideId === item.slide_id && page.hash === item.source_hash)) throw new Error('批注目标页已变化，请重新审阅后保存批注');
    return agent({ ...input, operation: 'chat', slideIds: [...new Set(selected.map((item) => item.slide_id))], instruction: `仅应用已选批注，保持其他页面；请在当前会话确认执行范围后修改：\n${selected.map((item) => JSON.stringify({ slideId: item.slide_id, elementId: item.element_id, instruction: item.instruction })).join('\n')}` });
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
        fs.writeFileSync(path.join(candidate, 'reports', 'export-result.json'), JSON.stringify({ format: input.format, target, revision: project.revision, pages: pages.map((page) => page.slideId),files:pages.map(page=>({slideId:page.slideId,hash:hash(fs.readFileSync(path.join(target,`${page.slideId}.png`)))})) }), 'utf8');
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
      const prepared = await prepareTemplateCandidate({project,candidate,signal},input);
      commit(project,candidate,prepared.pages,prepared.resource.route,prepared.resource,signal,{plan:prepared.plan,requirements:prepared.requirements});
    });
  }
  async function prepareTemplateCandidate({project,candidate,signal},input) {
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
      if (input.beautify) {
        await runtime.run({script:'pptx_intake.py',args:[target,'-o',path.join(candidate,'analysis')],projectRoot:candidate,signal});
        await runtime.run({script:'source_to_md/ppt_to_md.py',args:[target,'-o',path.join(candidate,'sources/template.md')],projectRoot:candidate,signal});
        const images = path.join(candidate,'sources/template_files');
        if(fs.existsSync(images)) fs.cpSync(images,path.join(candidate,'images'),{recursive:true});
        await runtime.run({script:'beautify_inventory.py',args:[path.join(candidate,'analysis/template.slide_library.json'),...(fs.existsSync(path.join(candidate,'images/image_manifest.json'))?['--images',path.join(candidate,'images/image_manifest.json')]:[]),'-o',path.join(candidate,'reports/beautify-original-inventory.json')],projectRoot:candidate,signal});
        fs.writeFileSync(path.join(candidate, 'reports/beautify-source.json'), JSON.stringify({ sourceHash: structure.hash, pages: originalText }), 'utf8');
      }
      else fs.rmSync(path.join(candidate, 'reports/beautify-source.json'), { force: true });
      const plan = pages.length ? { pages: pages.map((page, index) => ({ slideId: page.slideId, fileName: path.basename(page.sourcePath), title: `第 ${index + 1} 页`, content: input.preserveContent ? originalText[index] : '' })) } : input.beautify ? { pages: originalText.map((content, index) => ({ slideId: crypto.randomUUID(), fileName: `slide_${String(index + 1).padStart(4, '0')}.svg`, title: `第 ${index + 1} 页`, content })) } : null;
      return {pages,resource,plan,requirements:{ ...project.requirements, preserveContent: Boolean(input.preserveContent), aspectRatio: input.ratioDecision === 'reflow' ? project.requirements.aspectRatio : structure.aspectRatio }};
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
      const native = project.route === 'edit-native', previous = store.pages(project.projectId), previousPlan = completePagePlan(project), slideId = crypto.randomUUID();
      const after = input.afterSlideId ? previous.findIndex(page=>page.slideId===input.afterSlideId) : previous.length-1;
      if(input.afterSlideId && after<0) throw new Error('插入位置的当前页面已变化，请重新选择');
      const position=after+1,fileName=native ? `new_${slideId}.svg` : `slide_${String(position+1).padStart(4,'0')}_${slideId}.svg`,relative=`${native ? 'native/authoring-svg-flat' : 'svg_output'}/${fileName}`;
      let content;
      if (previous.length) { const file = path.join(candidate, previous[0].sourcePath), doc = validateSvg(fs.readFileSync(file, 'utf8'), candidate, path.dirname(file)); doc('svg').children().filter((_, node) => node.name !== 'defs' && !doc(node).attr('data-pptx-inherited')).remove(); content = doc.xml(); }
      else { const [width, height] = project.requirements.aspectRatio === '4:3' ? [1200,900] : [1280,720]; content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`; }
      let existingPlan = previousPlan?.pages || [];
      if (!native && previous.length) {
        const directory = path.join(candidate, 'svg_output'), notes = path.join(candidate, 'notes'), animationFile = path.join(candidate, 'animations.json'), animations = fs.existsSync(animationFile) ? JSON.parse(fs.readFileSync(animationFile, 'utf8')) : null, renamedAnimations = {};
        const names = previous.map((page, index) => ({ page, fileName: `slide_${String(index+(index>=position?2:1)).padStart(4, '0')}_${page.slideId}.svg` }));
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
      if (native) { const roster = pageRoster(candidate, project.route).filter((page) => page.fileName !== fileName),pages=roster.map((page) => ({ source_slide: page.sourceSlide, svg: page.fileName }));pages.splice(position,0,{source_slide:roster[0].sourceSlide,svg:fileName});fs.writeFileSync(path.join(candidate, 'native/page_plan.json'), JSON.stringify({ schema: 'ppt-master.roundtrip-page-plan.v1', pages }, null, 2), 'utf8'); }
      const nextPlan=[...existingPlan];nextPlan.splice(position,0,{ slideId, fileName, title: `按${item.title}制作新页`, content: '', level: 1, sourceRefs: reference, expression: '按单页视觉参考生成独立新对象；未套用', materialNeeds: '依据用户确认内容制作，不能沿用模板旧事实' });const plan={...previousPlan,pages:nextPlan};
      if(!native) for(const page of existingPlan) {const file=path.join(candidate,'svg_output',page.fileName),text=fs.readFileSync(file,'utf8');if([...text.matchAll(/(?:href|data-pptx-shape-hyperlink)\s*=\s*["']#slide-([1-9]\d*)["']/g)].some(match=>plan.pages.findIndex(item=>item.slideId===previous[Number(match[1])-1]?.slideId)!==Number(match[1])-1)) fs.writeFileSync(file,remapLinks(text,previous,plan.pages),'utf8');}
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
    conversation(input = {}) { if (input.projectId) store.project(input.projectId); return conversations.get(input); },
    saveConversation(input) {
      const value = conversations.get({ conversationId: input.conversationId });
      if (input.selection && value.projectId) assertIdle(value.projectId);
      const changed = input.selection && JSON.stringify(input.selection) !== JSON.stringify(value.selection);
      const next = conversations.save(input);
      if (changed && value.projectId) {
        const project = store.project(value.projectId);
        db.prepare('UPDATE ppt_projects SET requirements_json=?,revision=revision+1,confirmed_revision=NULL WHERE project_id=?').run(JSON.stringify({ ...project.requirements, creationScope: next.selection.creationScope }), value.projectId);
        conversations.checkpoint(value.conversationId, null);
      }
      return next;
    },
    attachConversation(input) { const value = conversations.get({ conversationId: input.conversationId }); if (value.projectId) assertIdle(value.projectId); return conversations.attach(input); },
    answer(input) {
      const value = conversations.get({ conversationId: input.conversationId });
      if (value.projectId !== input.projectId) throw new Error('回答与项目会话不一致');
      const question = value.questions.find((item) => item.questionId === input.questionId);
      if (!question || question.gateId !== (input.gateId || null) || question.phase !== (input.phase || null) || (question.fingerprint !== input.fingerprint && !(question.status === 'answered' && JSON.parse(question.dataJson).requestFingerprint === input.fingerprint)) || question.taskId !== input.taskId) throw new Error('问题或方案范围已变化，请读取当前问题');
      const data = JSON.parse(question.dataJson), option = data.options.find((item) => item.id === input.optionId);
      if (!option || option.custom && !input.text?.trim()) throw new Error('请选择选项或填写调整要求');
      const answer = { optionId: option.id, text: option.custom ? input.text.trim() : option.label, confirmed: !option.custom, answeredAt: new Date().toISOString(), userOperation: true };
      if(question.phase==='phase2' && answer.confirmed) {if(hash(JSON.stringify(data.summary))!==data.summaryFingerprint) throw new Error('待确认方案已变化');answer.approvedDesign=data.summary.directions[data.options.findIndex(item=>item.id===option.id)];}
      if (question.status === 'answered') { const prior = JSON.parse(question.answerJson); if (prior.optionId !== answer.optionId || prior.text !== answer.text) throw new Error('问题已经回答'); return { answered: true, duplicate: true }; }
      const project = store.project(input.projectId), job = jobs.get(input.projectId);
      if (question.status !== 'pending' || !job || job.jobId !== question.jobId || job.controller.signal.aborted || conversations.fingerprint(project, value, data.scope) !== question.fingerprint) throw new Error('旧问题不能回答；请从保存的检查点继续新的任务');
      db.transaction(() => {
        if (question.phase === 'phase1' && answer.confirmed) {
          const requirements = { ...project.requirements };
          delete requirements.templateKind;
          for (const key of ['purpose','audience','goal','language','aspectRatio']) requirements[key] = data.summary[key];
          db.prepare('UPDATE ppt_projects SET requirements_json=? WHERE project_id=?').run(JSON.stringify(requirements), project.projectId);
        }
        if (['template','settings'].includes(question.phase) && answer.confirmed) db.prepare('UPDATE ppt_projects SET requirements_json=? WHERE project_id=?').run(JSON.stringify({ ...project.requirements, ...(question.phase === 'template' ? {templateKind:data.summary.kind} : data.summary) }), project.projectId);
        const fingerprint = conversations.fingerprint(store.project(project.projectId), value, data.scope);
        if (value.checkpoint?.baseRevision === project.revision) conversations.checkpoint(value.conversationId, { ...value.checkpoint, fingerprint:conversations.fingerprint(store.project(project.projectId),value,value.checkpoint.scope) });
        db.prepare("UPDATE ppt_questions SET status='answered',answer_json=?,fingerprint=? WHERE question_id=?").run(JSON.stringify(answer), fingerprint, input.questionId);
        conversations.add(value.conversationId, 'user', answer.text, { questionId: input.questionId, gateId: input.gateId, phase: input.phase });
        agentService.answerQuestion({ question_id: input.questionId, option_id: input.optionId, custom_answer: input.text });
      })();
      emit(project.projectId, value.conversationId, { type: 'answer', taskId: question.taskId, questionId: input.questionId });
      return { answered: true };
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
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
    create(input) { const project = store.create(input); if (input.conversationId) conversations.bind(input.conversationId, project.projectId); return get(project.projectId); }, setPlan, confirm: (input) => { assertIdle(input.projectId, input.revision); return store.confirm(input); },
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
