// 真实 Pi/Proxy、Electron/SQLite、PPT 工具和 AppContainer；仅最外层供应商与用户答复为合成夹具。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { createFixture, call } = require('./pi-upgrade-fixture.cjs');
const evidenceRoot = path.resolve(__dirname, '../.tmp/ppt184-resource-center/sdk-business'); fs.mkdirSync(evidenceRoot, { recursive: true });
const root = fs.mkdtempSync(path.join(evidenceRoot, '隔离-')); app.setPath('userData', path.join(root, '客户端数据')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const results = []; let service, sqlite, fixture; let steps = [], replies = [], questions = [];
async function check(name, action) { try { await action(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
function specification(pages) {
  return `<!-- ppt-master-schema: design-spec/v1 -->
# 隔离资料汇报 - Design Spec
## I. Project Information
| Item | Value |
| --- | --- |
| Page Count | ${pages.length} |
| Primary Language | zh-CN |
| Target Audience | 测试人员 |
| Communication Intent | 核对合成资料原文 |
| Desired Audience Outcome | 确认工具链与导出 |
| Core Message / Ask / Action | 所有内容仅用于隔离测试 |
| Delivery Context | 内部屏幕审阅 |
| Artifact Afterlife | 回归证据 |
| Reading Mode | balanced |
| Design Spec Depth | complete |
| Speaker Notes | enabled |
| Custom Animations | disabled |
| Narration Audio | disabled |
## II. Canvas Specification
1280 × 720，viewBox 0 0 1280 720。
## III. Visual Theme
### Theme Style
白底蓝色标题，合成资料核验。
## IV. Typography System
标题和正文均为 Microsoft YaHei，分别 40 px 与 24 px。
## V. Layout Principles
同一边距，标题与正文纵向分隔。
## VI. Icon Usage Specification
不使用图标。
## VIII. Image Resource List
不使用图片。
## IX. Content Outline
${pages.map((page, index) => `#### Slide ${String(index + 1).padStart(2, '0')} - ${page.title}\n- **Audience move**: 从原文到可核对的页面。\n- **Relationships**: none\n- **Title**: ${page.title}\n- **Content**: ${page.content}`).join('\n')}
## X. Speaker Notes Requirements
- **Generation**: enabled
- **Filename**: 与页面 SVG 同名。
- **Content**: 仅重述本页合成资料。
`;
}
function lock(pages) { return `<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock
## canvas
- viewBox: 0 0 1280 720
- format: ppt169
## communication
- primary_language: zh-CN
- audience: 测试人员
- objective: 核对合成资料
- core_message: 测试不含真实业务
- consumption_mode: balanced
## mode
- mode: briefing
## visual_style
- visual_style: swiss-minimal
## colors
- bg: #FFFFFF
- primary: #1677FF
- accent: #1677FF
- text: #333333
## typography
- font_family: Microsoft YaHei
- body: 24
- title: 40
## icons
- library: none
- inventory: none
## page_rhythm
${pages.map((_, index) => `- P${String(index + 1).padStart(2, '0')}: anchor`).join('\n')}
## pptx_structure
- mode: flat
## forbidden
- 禁止脚本、外部样式和外部网络。
`; }
function pageSvg(page) { return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" font-family="Microsoft YaHei"><rect id="背景" x="0" y="0" width="1280" height="720" fill="#FFFFFF"/><text id="标题" x="80" y="120" font-size="40" fill="#1677FF">${page.title}</text><text id="正文" x="80" y="260" font-size="24" fill="#333333">${page.content}</text></svg>`; }
async function main() {
  await app.whenReady(); sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  const store = require('../electron/services/pptProjectStore.cjs').createPptProjectStore({ db: sqlite.db });
  const runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({ app });
  fixture = await createFixture({ electronApp: app, parentDir: root, handler(body) {
    const last = body.messages.at(-1); if (last?.role === 'tool') replies.push({ id: last.tool_call_id, content: last.content });
    return steps.length ? { calls: [steps.shift()] } : { text: '合成供应商已完成预设步骤；质量以实际工具报告为准。' };
  } });
  const pi = fixture.runtime({ requestUserQuestion: async (request) => { questions.push(request); return { question_id: request.question_id, selected_option: '确认继续', answer: '隔离回归夹具批准合成方案' }; } });
  const imageEvents = [];
  const imageAi = require('../electron/services/aiService.cjs').createAiService({ app, configStore: fixture.configStore, analyticsService: { track(event) { imageEvents.push(event); } } });
  fixture.config.image_model_profiles = { jinlong: { api_key: '隔离生图假凭据' } }; fixture.config.image_model = { provider: 'jinlong', model_name: 'gpt-image-2', image_size: '1024x1024' };
  const studio = require('../electron/services/imageStudioService.cjs').createImageStudioService({ app, db: sqlite.db, configStore: fixture.configStore, aiService: imageAi, resourceClient: { loadCover: async () => { throw new Error('夹具不请求公网图片'); } } });
  service = require('../electron/services/pptService.cjs').createPptService({ app, store, runtime, exporter: require('../electron/services/pptExportService.cjs').createPptExportService({ runtime, BrowserWindow }), resources: { getItem: async () => ({resourceId:'固定wuhua',kind:'layout',title:'单页真实参考',assets:[{role:'original',assetId:'wuhua',hash:require('../electron/services/pptTemplateService.cjs').inspectPptx(path.join(evidenceRoot,'../baseline/wuhua-original.pptx')).hash}]}), loadAsset: async()=>({filePath:path.join(evidenceRoot,'../baseline/wuhua-original.pptx')}) }, skills: {}, agentService: pi.runtime, configStore: fixture.configStore, imageStudioService: studio, shell: {}, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, 'Default真实链路.pptx') }) } });
  let project = service.create({ parent: root, title: 'SDK 合成资料两页', requirements: { brief: '仅使用合成输入', audience: '测试人员', aspectRatio: '16:9', visualModelEnabled: false, quick: false } });
  const pages = [{ slideId: require('node:crypto').randomUUID(), title: '合成资料甲', content: '甲只表示隔离测试事实', fileName: 'slide_01.svg' }, { slideId: require('node:crypto').randomUUID(), title: '合成资料乙', content: '乙只表示隔离测试事实', fileName: 'slide_02.svg' }];
  async function wait(result, expected = 'completed') {
    result = await result; for (let index = 0; index < 6000; index++) { const job = store.jobs(project.projectId).find((item) => item.jobId === result.jobId); if (job && job.status !== 'running') { assert.equal(job.status, expected, job.error); project = service.get(project.projectId); return job; } await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('真实 SDK 业务任务未结算');
  }
  await check('真实 Pi1.0/Proxy/SQLite 保存页面计划，未确认不得制作', async () => {
    steps = [call('ppt_ask', { question: '合成 Stage-1：测试受众、两页、免费设计，是否继续？' }, 'Stage1'), call('ppt_plan', { plan: { summary: '仅合成资料两页；方案甲白底蓝字、乙灰底蓝字、丙白底黑字，选甲用于易核验', pages } }, '计划')];
    await wait(service.agent({ projectId: project.projectId, revision: project.revision, operation: 'plan', instruction: '在本应用问答框确认：仅使用合成资料，保留两个标题与原文。' }));
    assert.equal(project.plan.pages.length, 2); assert.equal(project.confirmedRevision, null); assert.equal(questions.length, 1);
    assert.throws(() => service.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '' }), /确认/);
    service.confirm({ projectId: project.projectId, revision: project.revision }); project = service.get(project.projectId);
  });
  await check('Default 真实宿主写入完整 spec/lock/原生文字/讲稿，经真实沙箱检查并提交', async () => {
    steps = [call('ppt_write', { path: 'design_spec.md', content: specification(pages) }, '设计规格'), call('ppt_write', { path: 'spec_lock.md', content: lock(pages) }, '执行锁')];
    for (const page of pages) { steps.push(call('ppt_write', { path: `svg_output/${page.fileName}`, content: pageSvg(page) }, page.slideId)); steps.push(call('ppt_write', { path: `notes/${path.basename(page.fileName, '.svg')}.md`, content: page.content }, `讲稿-${page.slideId}`)); }
    steps.push(call('ppt_tool', { action: 'check' }, '质量检查'));
    await wait(service.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '确认完整方案：自由设计、白底蓝字、仅提供的两页原文，讲稿启用，图像/动画/音频关闭。在本应用问答框执行；禁止切换 Quick。' }));
    assert.deepEqual(project.pages.map((page) => page.slideId), pages.map((page) => page.slideId)); assert(fs.existsSync(path.join(project.root, 'spec_lock.md')));
    assert(!project.requirements.quick); assert(project.pages.every((page) => fs.existsSync(path.join(project.root, page.notesPath))));
    assert(fixture.requests.every(({ body }) => !body.tools?.some((tool) => ['bash', 'write', 'edit', 'read', 'find', 'ls'].includes(tool.function.name))));
  });
  await check('Default 真实导出 PPTX，两页中文原生对象及讲稿重解析', async () => {
    await wait(service.exportProject({ projectId: project.projectId, revision: project.revision, format: 'pptx' }));
    const report = require('../electron/services/pptTemplateService.cjs').inspectPptx(path.join(root, 'Default真实链路.pptx')); assert.equal(report.pageCount, 2); for (let index = 0; index < 2; index++) assert(report.pages[index].elements.some((element) => element.text === pages[index].content));
    const zip = new (require('adm-zip'))(path.join(root, 'Default真实链路.pptx')); assert(zip.readAsText('ppt/notesSlides/notesSlide1.xml').includes(pages[0].content));
  });
  await check('真实 SDK 局部修改只改选页，未选页 hash/稳定ID/讲稿保持', async () => {
    const untouched = project.pages[1]; service.confirm({ projectId: project.projectId, revision: project.revision }); project = service.get(project.projectId);
    steps = [call('ppt_write', { path: project.pages[0].sourcePath, content: pageSvg({ ...pages[0], content: '仅修改甲页的合成原文' }) }, '局部'), call('ppt_write', { path: project.pages[1].notesPath, content: '故意误写未选页讲稿，宿主必须阻止' }, '未选页拒写')];
    await wait(service.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '仅改甲页，乙页保护', slideIds: [pages[0].slideId] }));
    assert(replies.some(reply=>String(reply.content).includes('局部修改不能写未选页讲稿'))); assert.equal(project.pages[1].hash, untouched.hash); assert.equal(project.pages[1].slideId, untouched.slideId); assert.equal(fs.readFileSync(path.join(project.root, untouched.notesPath), 'utf8'), pages[1].content);
  });
  await check('取消真实 Pi 问答等待，候选不应用，原页 hash 保持', async () => {
    const before = project.pages.map((page) => page.hash); service.confirm({ projectId: project.projectId, revision: project.revision }); project = service.get(project.projectId);
    let entered; const waiting = new Promise((resolve) => { entered = resolve; });
    const abortPi = fixture.runtime({ requestUserQuestion: async (_request, signal) => { entered(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('合成取消')), { once: true })); } });
    const temporary = require('../electron/services/pptService.cjs').createPptService({ app, store, runtime, exporter: {}, resources: {}, skills: {}, agentService: abortPi.runtime, configStore: fixture.configStore, imageStudioService: {}, shell: {}, dialog: {} });
    steps = [call('ppt_ask', { question: '取消夹具中的等待' }, '取消等待')]; const started = temporary.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '只等待，不写文件' }); await waiting; temporary.cancel(project.projectId); await wait(started, 'cancelled'); assert.deepEqual(project.pages.map((page) => page.hash), before);
  });
  await check('项目配图复用真实生图服务/AI队列/统计；只模拟供应商HTTP，调用上限阻止重发', async () => {
    project = await service.setPlan({ projectId: project.projectId, revision: project.revision, plan: project.plan, requirements: { ...project.requirements, imageGenerationEnabled: true, imageGenerationLimit: 1 } });
    service.confirm({ projectId: project.projectId, revision: project.revision }); project = service.get(project.projectId);
    let imageCalls = 0; const originalFetch = global.fetch;
    const bytes = await require('sharp')({ create: { width: 1024, height: 1024, channels: 3, background: '#1677ff' } }).png().toBuffer();
    global.fetch = async (url, options) => { if (String(url).startsWith('https://img-api.jlaudeapi.com/v1/images/')) { imageCalls += 1; return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } return originalFetch(url, options); };
    try {
      steps = [call('ppt_image_generate', { prompt: '合成蓝色测试图，不含业务内容', size: '1024x1024' }, '配图一'), call('ppt_image_generate', { prompt: '超过明确限额不准再发送', size: '1024x1024' }, '配图二')];
      await wait(service.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '本修订仅批准一张合成配图，重复请求用于验证限额' }));
      assert.equal(imageCalls, 1); assert.equal(studio.getState().works.length, 1); assert(fs.readdirSync(path.join(project.root, 'images')).some((file) => file.startsWith('image-')));
      assert(replies.some((reply) => String(reply.content).includes('已达明确上限'))); assert.equal(imageEvents.length, 1);
      const page = project.pages[0], image = fs.readdirSync(path.join(project.root, 'images')).find((file) => file.startsWith('image-'));
      const svg = fs.readFileSync(path.join(project.root, page.sourcePath), 'utf8').replace('</svg>', `<image id="项目配图" x="860" y="330" width="200" height="200" href="../images/${image}"/></svg>`);
      service.confirm({ projectId: project.projectId, revision: project.revision }); project = service.get(project.projectId);
      const imageSpec = fs.readFileSync(path.join(project.root, 'design_spec.md'), 'utf8').replace('不使用图片。', `| Filename | Dimensions | Ratio | Purpose | Type | Image pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| ${image} | 1024x1024 | 1:1 | 合成回归配图 | Photo | inset | no-crop | ai | Generated | 本次隔离生图成品，供应商HTTP合成 | none | local |`);
      const imageLock = fs.readFileSync(path.join(project.root, 'spec_lock.md'), 'utf8') + `\n## images\n- test: images/${image} | source=ai | crop=no-crop\n`;
      steps = [call('ppt_write', { path: 'design_spec.md', content: imageSpec }, '登记配图'), call('ppt_write', { path: 'spec_lock.md', content: imageLock }, '锁定配图'), call('ppt_write', { path: page.sourcePath, content: svg }, '配图装页')];
      await wait(service.agent({ projectId: project.projectId, revision: project.revision, slideIds: [page.slideId], operation: 'generate', instruction: '将已生成的同项目配图加入选页，不再生图，不改其他页' }));
      assert(service.page({ projectId: project.projectId, slideId: page.slideId }).elements.some((element) => element.type === 'image' && element.attributes.href === `../images/${image}`));
      assert(project.pages.find((item) => item.slideId === page.slideId).previewUrl);
      await wait(service.exportProject({ projectId: project.projectId, revision: project.revision, format: 'pptx' }));
      const media = new (require('adm-zip'))(path.join(root, 'Default真实链路.pptx')).getEntries().filter((entry) => /^ppt\/media\/.+\.png$/.test(entry.entryName));
      assert(media.length > 0); assert(media.some((entry) => entry.getData().equals(fs.readFileSync(path.join(project.root, 'images', image)))));
    } finally { global.fetch = originalFetch; }
  });
  await check('真实讲稿保存与页面排序联动spec/lock/动画/稳定ID，计划历史可恢复', async () => {
    const historyRevision = project.revision, before = project.pages.map((page) => ({ ...page }));
    await wait(service.saveNotes({ projectId: project.projectId, revision: project.revision, slideId: before[0].slideId, content: '真实保存的甲页讲稿' }));
    const reversed = { ...project.plan, pages: [...project.plan.pages].reverse() };
    project = await service.setPlan({ projectId: project.projectId, revision: project.revision, plan: reversed });
    assert.deepEqual(project.pages.map((page) => page.slideId), before.map((page) => page.slideId).reverse());
    assert.equal(fs.readFileSync(path.join(project.root, project.pages[1].notesPath), 'utf8'), '真实保存的甲页讲稿');
    const spec = fs.readFileSync(path.join(project.root, 'design_spec.md'), 'utf8'); assert(spec.indexOf('Slide 01 - 合成资料乙') < spec.indexOf('Slide 02 - 合成资料甲'));
    await wait(service.exportProject({ projectId: project.projectId, revision: project.revision, format: 'pptx' }));
    const report = require('../electron/services/pptTemplateService.cjs').inspectPptx(path.join(root, 'Default真实链路.pptx')); assert(report.pages[0].elements.some((element) => element.text === pages[1].content));
    await wait(service.restore({ projectId: project.projectId, revision: project.revision, historyRevision })); assert.deepEqual(project.pages.map((page) => page.slideId), before.map((page) => page.slideId));
  });
  await check('明确选择 Quick 直接制作：真实SDK/沙箱检查/导出，禁止伪造Default规格锁', async () => {
    project = service.create({ parent: root, title: 'Quick隔离资料', requirements: { quick: true, brief: '一页合成资料', aspectRatio: '16:9', confirmationSurface: 'chat' } });
    assert.throws(() => service.agent({ projectId: project.projectId, revision: project.revision, operation: 'plan' }), /Quick/);
    const quickPage = { title: 'Quick合成页', content: '只用于无规格路线检查', fileName: 'slide_01.svg' };
    steps = [call('ppt_write', { path: 'design_spec.md', content: '不应写入' }, '禁止伪造'), call('ppt_write', { path: 'svg_output/slide_01.svg', content: pageSvg(quickPage) }, 'Quick页'), call('ppt_tool', { action: 'check' }, 'Quick质量检查')];
    await wait(service.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '明确使用Quick，仅制作合成页，不生成Default文件。' }));
    for (const name of ['design_spec.md', 'spec_lock.md', 'page_plan.json']) assert(!fs.existsSync(path.join(project.root, name)));
    assert(replies.some((reply) => String(reply.content).includes('Quick 不写')));
    assert.equal(project.plan.pages.length,1); const original=project.pages[0]; await wait(service.insertLayout({projectId:project.projectId,revision:project.revision,resourceId:'固定wuhua'})); assert.equal(project.plan.pages.length,2); assert.equal(project.pages[0].slideId,original.slideId); assert.equal(project.pages[0].hash,original.hash); project=await service.setPlan({projectId:project.projectId,revision:project.revision,plan:project.plan}); assert.equal(project.pages[0].slideId,original.slideId); for(const name of ['design_spec.md','spec_lock.md','page_plan.json'])assert(!fs.existsSync(path.join(project.root,name))); 
    await wait(service.exportProject({ projectId: project.projectId, revision: project.revision, format: 'pptx' }));
    assert(require('../electron/services/pptTemplateService.cjs').inspectPptx(path.join(root, 'Default真实链路.pptx')).pages[0].sourceText.includes(quickPage.content));
  });
  await check('美化用宿主原文件冻结文字基线；改写候选报告不能绕过事实保护', async () => {
    const source = path.join(evidenceRoot, '../baseline/wuhua-original.pptx');
    project = service.create({ parent: root, title: '美化原文保护', requirements: { aspectRatio: '4:3', confirmationSurface: 'chat' } });
    await wait(service.prepareTemplate({ projectId: project.projectId, revision: project.revision, filePath: source, beautify: true, preserveContent: true, ratioDecision: 'reflow' }));
    const page = { slideId: require('node:crypto').randomUUID(), title: '原文美化', content: '不允许替换的虚构事实', fileName: 'slide_01.svg' };
    project = await service.setPlan({ projectId: project.projectId, revision: project.revision, plan: { summary: '原文保护', pages: [page] } }); service.confirm({ projectId: project.projectId, revision: project.revision }); project = service.get(project.projectId);
    const revision = project.revision;
    steps = [call('ppt_write', { path: 'design_spec.md', content: specification([page]) }, '规格'), call('ppt_write', { path: 'spec_lock.md', content: lock([page]) }, '锁'), call('ppt_write', { path: 'reports/beautify-source.json', content: JSON.stringify({ pages: [{ text: page.content }] }) }, '篡改报告'), call('ppt_write', { path: 'svg_output/slide_01.svg', content: pageSvg(page) }, '篡改原文')];
    const job = await wait(service.agent({ projectId: project.projectId, revision: project.revision, operation: 'generate', instruction: '回归夹具故意篡改候选报告，宿主必须拒绝应用。' }), 'failed'); assert.match(job.error, /改变了原始文字/); assert.equal(project.revision, revision); assert.equal(project.pages.length, 0);
  });
  await check('原生Agent修改后恢复历史仍保留原始资源hash，并可再次修改', async()=>{
    project=service.create({parent:root,title:'原生Agent历史',requirements:{aspectRatio:'4:3'}}); await wait(service.prepareTemplate({projectId:project.projectId,revision:project.revision,filePath:path.join(evidenceRoot,'../baseline/wuhua-original.pptx'),ratioDecision:'keep'}));
    const before=project.revision, originalHash=project.resource.sourceHash, shape=service.nativeObjects({projectId:project.projectId}).pages[0].elements.find(x=>x.type==='p:sp'&&x.text); service.confirm({projectId:project.projectId,revision:project.revision});project=service.get(project.projectId);
    steps=[call('ppt_native_replace',{changes:[{page:0,slideId:project.pages[0].slideId,elementId:shape.elementId,text:'Agent隔离改字'}]},'原生Agent')]; await wait(service.agent({projectId:project.projectId,revision:project.revision,operation:'generate',instruction:'仅替换选定原生对象'}));assert.notEqual(project.resource.sourceHash,originalHash);
    await wait(service.restore({projectId:project.projectId,revision:project.revision,historyRevision:before})); assert.equal(project.resource.sourceHash,originalHash);
    await wait(service.nativeReplace({projectId:project.projectId,revision:project.revision,changes:[{page:0,slideId:project.pages[0].slideId,elementId:shape.elementId,text:'恢复后再次修改'}]})); assert(service.nativeObjects({projectId:project.projectId}).pages[0].elements.some(x=>x.text==='恢复后再次修改'));
  });
  fs.writeFileSync(path.join(root, '工具回复.json'), JSON.stringify({ questions, replies }, null, 2), 'utf8');
}
main().catch((error) => { console.error(error.stack); if (!results.some((item) => item.status === 'FAIL')) results.push({ status: 'FAIL', error: error.stack }); }).finally(async () => { await service?.close(); await fixture?.close(); sqlite?.close(); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ layer: '真实SDK+真实Electron业务+真实固定工具；模拟供应商/合成用户回答，非模型质量验收', results }, null, 2), 'utf8'); console.log(JSON.stringify({ root, results })); app.exit(results.some((item) => item.status === 'FAIL') ? 1 : 0); });
