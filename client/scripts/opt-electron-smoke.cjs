const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app, BrowserWindow, nativeImage, session } = require('electron');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../.tmp/v184-opt/electron'));
fs.mkdirSync(root, { recursive: true }); app.setPath('userData', fs.mkdtempSync(path.join(root, '隔离数据-'))); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const results = []; let service, agent, fixture, sqlite, materialPause, releaseMaterial, imageImports=0; const steps = [], replies = [];
async function check(name, action) { try { await action(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate) { for (let i=0; i<2400; i++) { const value=await predicate(); if(value) return value; await pause(50); } throw new Error('隔离回归等待超时'); }
async function main() {
  await app.whenReady();
  await check('真实Electron解码PNG/JPEG/GIF/WebP，损坏图拒绝；保留原始hash协议', async () => {
    const sharp = require('sharp'), decode = require('../../management/electron/services/resourcePreviewService.cjs').createResourceImageDecoder({ BrowserWindow,nativeImage,session });
    const facts=[];
    for (const format of ['png','jpeg','gif','webp']) { const buffer = await sharp({ create:{width:40,height:30,channels:3,background:'#cc3344'} }).toFormat(format).toBuffer(); facts.push({format,nativeReadable:!nativeImage.createFromBuffer(buffer).isEmpty(),decoded:await decode(buffer)}); assert.deepEqual(facts.at(-1).decoded,{width:40,height:30}); }
    await assert.rejects(decode(Buffer.from('GIF89a-invalid')), /解码失败/); fs.writeFileSync(path.join(root,'image-decoder.json'),JSON.stringify(facts,null,2),'utf8');
  });
  sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  const store = require('../electron/services/pptProjectStore.cjs').createPptProjectStore({db:sqlite.db});
  const { createFixture,call } = require('./pi-upgrade-fixture.cjs');
  fixture=await createFixture({electronApp:app,parentDir:root,handler(body) { const last=body.messages.at(-1); if(last?.role==='tool') {replies.push(last.content);fs.writeFileSync(path.join(root,'sdk-replies.json'),JSON.stringify(replies,null,2),'utf8');} return steps.length?{calls:[steps.shift()]}:{text:'仅模拟供应商；真实工具结果以回归报告为准。'}; }});
  agent=require('../electron/services/agentService.cjs').createAgentService({app,configStore:fixture.configStore,aiService:{},analyticsService:{trackEvent(){}}});
  const runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({app});
  const parser=require('../electron/services/fileService.cjs'),parse=parser.parseDocumentWithConfig;
  parser.parseDocumentWithConfig=async(...args)=>{if(materialPause && /\.txt$/i.test(args[1]) && fs.readFileSync(args[1],'utf8')==='资料中断专用') await materialPause;return parse(...args);};
  service=require('../electron/services/pptService.cjs').createPptService({app,store,runtime,agentService:agent,resources:{},skills:{},imageStudioService:{importReferenceFile(){imageImports++;throw Error('不应读取已移除图片');},submit(){throw Error('本夹具禁止收费请求');}},configStore:fixture.configStore,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[root]}),showSaveDialog:async(options)=>({canceled:false,filePath:path.join(root,`成品.${options.filters[0].extensions[0]}`)})},shell:{},exporter:require('../electron/services/pptExportService.cjs').createPptExportService({runtime,BrowserWindow})});
  let conversation=service.conversation(), project=service.create({parent:root,title:'OPT真实SDK单页',conversationId:conversation.conversationId,requirements:{brief:'只使用合成主题',creationScope:'single',aspectRatio:'16:9',quick:false}});
  const colors={background:'#FFFFFF',text:'#333333',primary:'#1677FF',secondary:'#555555',accent:'#AA3333',muted:'#888888'};
  const phase1={purpose:'验证真实链路',audience:'测试人员',goal:'只核对合成资料',language:'zh-CN',aspectRatio:'16:9',template:'free_design'};
  const directions=['清晰汇报','技术说明','行动提案'].map(title=>({title,style:'swiss-minimal',colors,fonts:{title:'Microsoft YaHei',body:'Microsoft YaHei'},bodySize:24,imageStrategy:'无配图',notes:false,pages:[{title:'合成主题',content:'只含合成资料'}]}));
  const input=(instruction)=>({projectId:project.projectId,revision:project.revision,conversationId:conversation.conversationId,operation:'chat',instruction});
  async function settle(started) { await wait(()=>!['running','waiting_user','queued'].includes(store.jobs(project.projectId).find(item=>item.jobId===started.jobId)?.status)); project=service.get(project.projectId); const job=project.jobs.find(item=>item.jobId===started.jobId); assert.equal(job.status,'completed',job.error); return job; }
  async function answer(phase, custom=false) {
    const question=await wait(()=>service.get(project.projectId).conversation.questions.findLast(item=>item.status==='pending'&&item.phase===phase));
    assert.equal(store.jobs(project.projectId).find(item=>item.jobId===question.jobId).status,'waiting_user');
    const options=JSON.parse(question.dataJson).options, option=custom?options.at(-1):options[0];
    const payload={projectId:project.projectId,conversationId:conversation.conversationId,questionId:question.questionId,taskId:question.taskId,gateId:question.gateId,phase:question.phase,fingerprint:question.fingerprint,optionId:option.id,text:custom?'请调整方案，不授权后续制作':undefined};
    assert.throws(()=>service.answer({...payload,projectId:'其他项目'}),/不一致/);
    service.answer(payload); assert.equal(service.answer(payload).duplicate,true); return question;
  }
  await check('真实SDK、Proxy、Agent问答、SQLite：两阶段门禁与waiting_user精确恢复',async()=>{
    steps.push(call('ppt_write',{path:'svg_output/blocked.svg',content:'<svg/>'},'未确认拒写'),call('ppt_write',{path:'analysis/../svg_output/traversal.svg',content:'<svg/>'},'规范化路径仍须确认'),call('ppt_write',{path:'analysis/../reports/quick-early.json',content:'{"pages":[]}'},'禁止伪造宿主回执'),call('ppt_ask',{question:'确认用途、受众、目标及自由设计？',phase:'phase1',summary:phase1},'阶段1'),call('ppt_ask',{question:'请选择完整方案，讲稿明确关闭。',phase:'phase2',summary:{directions}},'阶段2'));
    const started=service.agent(input('制作合成主题单页'));
    const first=await answer('phase1'); const second=await answer('phase2'); await settle(started);
    assert(replies.filter(item=>String(item).includes('请先在当前会话确认')).length>=2);assert(replies.some(item=>String(item).includes('宿主回执只由真实工具')));assert(!fs.existsSync(path.join(project.conversation.checkpoint.root,'svg_output/traversal.svg')));assert(!fs.existsSync(path.join(project.conversation.checkpoint.root,'reports/quick-early.json'))); assert.equal(project.pages.length,0);
    assert.equal(project.conversation.questions.filter(item=>item.status==='answered').length,2);
    assert.equal(first.phase,'phase1'); assert.equal(second.phase,'phase2');
    const gates=require('../electron/services/pptConversationStore.cjs').createPptConversationStore(sqlite.db); assert(gates.confirmed(store.project(project.projectId),project.conversation,'phase2'));
  });
  await check('最新阶段2待回答/调整不能复用旧批准；新指令须确认执行范围',async()=>{
    steps.push(call('ppt_write',{path:'svg_output/blocked-new.svg',content:'<svg/>'},'新请求拒写'),call('ppt_ask',{question:'调整后的完整方案？',phase:'phase2',summary:{directions}},'新版阶段2'),call('ppt_write',{path:'svg_output/blocked-adjust.svg',content:'<svg/>'},'否决后拒写'));
    const started=service.agent(input('修改制作目标'));
    const pending=await wait(()=>service.get(project.projectId).conversation.questions.findLast(item=>item.status==='pending'));
    const gates=require('../electron/services/pptConversationStore.cjs').createPptConversationStore(sqlite.db);
    assert.equal(gates.confirmed(store.project(project.projectId),service.get(project.projectId).conversation,'phase2'),null);
    await answer('phase2',true); await settle(started);
    assert.equal(gates.confirmed(store.project(project.projectId),project.conversation,'phase2'),null);
    assert.equal(project.pages.length,0); assert(replies.some(item=>String(item).includes('新指令尚未确认')));
  });
  await check('持久草稿/附件分项；重开同一会话，选择变化使旧确认失效',async()=>{
    const original=path.join(root,'原始资料.txt');fs.writeFileSync(original,'仅合成资料','utf8');
    service.saveConversation({conversationId:conversation.conversationId,text:'未发送的草稿'}); service.attachConversation({conversationId:conversation.conversationId,paths:[original]});
    const restored=service.conversation({projectId:project.projectId});assert.equal(restored.conversationId,conversation.conversationId);assert.equal(restored.text,'未发送的草稿');assert.equal(restored.attachments[0].status,'selected');
    service.attachConversation({conversationId:conversation.conversationId,removeId:restored.attachments[0].attachmentId});assert(fs.existsSync(original));
    assert.throws(()=>service.answer({projectId:project.projectId,conversationId:conversation.conversationId,questionId:'旧问题'}),/变化/);
  });
  await check('真实SDK单页Default：明确三方向选择、内部计划、spec/lock、原生SVG、检查与预览',async()=>{
    const {specification,lock,pageSvg}=require('./opt-ppt-fixture.cjs');
    const page={slideId:crypto.randomUUID(),title:'合成主题',content:'只含隔离测试资料',fileName:'slide_01.svg'};
    steps.push(call('ppt_ask',{question:'请确认单页制作方案',phase:'phase2',summary:{directions:directions.map(item=>({...item,notes:true}))}},'制作方案'),call('ppt_plan',{plan:{pages:[page]}},'单页计划'),call('ppt_write',{path:'design_spec.md',content:specification([page])},'规格'),call('ppt_write',{path:'spec_lock.md',content:lock([page])},'锁'),call('ppt_write',{path:'svg_output/slide_01.svg',content:pageSvg(page)},'单页源'),call('ppt_write',{path:'notes/slide_01.md',content:page.content},'讲稿'),call('ppt_tool',{action:'check'},'真实检查'));
    const started=service.agent(input('确认生成这一页'));await answer('phase2');await settle(started);
    assert.equal(project.pages.length,1);assert.equal(project.pages[0].slideId,page.slideId);assert(project.pages[0].previewUrl);assert.equal(project.plan.pages.length,1);
  });
  await check('真实PPTX导出与重新解析；只恢复Agent检查点，导出不混入候选讲稿',async()=>{
    await settle(await service.exportProject({projectId:project.projectId,revision:project.revision,format:'pptx'}));
    const file=path.join(root,'成品.pptx'), inspected=require('../electron/services/pptTemplateService.cjs').inspectPptx(file);assert.equal(inspected.pageCount,1);assert(inspected.pages[0].sourceText.includes('只含隔离测试资料'));
    const checkpoint=path.join(project.root,'candidates',crypto.randomUUID());fs.mkdirSync(checkpoint);fs.cpSync(path.join(project.root,'notes'),path.join(checkpoint,'notes'),{recursive:true});
    fs.writeFileSync(path.join(checkpoint,'notes/slide_01.md'),'未提交讲稿，不准导出','utf8');
    const conversations=require('../electron/services/pptConversationStore.cjs').createPptConversationStore(sqlite.db);conversations.checkpoint(conversation.conversationId,{root:checkpoint,baseRevision:project.revision,fingerprint:conversations.fingerprint(store.project(project.projectId),project.conversation),scope:[]});
    await settle(await service.exportProject({projectId:project.projectId,revision:project.revision,format:'notes'}));assert(!fs.readFileSync(path.join(root,'成品.md'),'utf8').includes('未提交讲稿'));
    conversations.checkpoint(conversation.conversationId,null);
  });
  await check('真实SDK局部修改沿用设计，只确认本轮范围；改变选定颜色时拒绝提交',async()=>{
    const {pageSvg,lock}=require('./opt-ppt-fixture.cjs'),instruction='仅修改当前页合成正文，保持设计与讲稿';
    const page=project.plan.pages[0],updated={...page,content:'局部修改仍只含合成资料'};
    steps.push(call('ppt_ask',{phase:'execute',question:'确认仅修改当前页？',summary:{instruction,scopeDescription:'当前一页SVG，其他文件保留'}}),call('ppt_write',{path:project.pages[0].sourcePath,content:pageSvg(updated)}));
    const started=service.agent({...input(instruction),slideIds:[page.slideId]});await answer('execute');await settle(started);assert.equal(project.pages.length,1);assert.equal(project.plan.pages[0].content,page.content);
    const before=project.pages[0].hash,wrongInstruction='再次修改当前页的合成正文，仍保留蓝色方案';
    steps.push(call('ppt_ask',{phase:'execute',question:'确认保持所选设计修改正文？',summary:{instruction:wrongInstruction,scopeDescription:'同一页，蓝色设计保留'}}),call('ppt_write',{path:'spec_lock.md',content:lock([page]).replace('#1677FF','#CC0000')}),call('ppt_write',{path:project.pages[0].sourcePath,content:pageSvg({...page,content:'不得覆盖旧版的错误候选'})}));
    const rejected=service.agent({...input(wrongInstruction),slideIds:[page.slideId]});await answer('execute');await wait(()=>store.jobs(project.projectId).find(item=>item.jobId===rejected.jobId)?.status==='failed');project=service.get(project.projectId);assert.match(project.jobs.find(item=>item.jobId===rejected.jobId).error,/所选方案.*颜色/);assert.equal(project.pages[0].hash,before);
  });
  await check('真实SDK创建Style：拒绝修改已有SVG、拒绝Brand伪装；完整Style检查后保留业务索引',async()=>{
    const existingHash=project.pages[0].hash,templateRoot=path.join(runtime.skillRoot,'templates');
    const summary={kind:'style',scope:'project',intent:'隔离项目内的方法规格',sourceBoundary:'固定6.6.0参考，仅验证工具，不注册全局库'};
    steps.push(call('ppt_ask',{phase:'template',question:'确认创建项目内Style？',summary}),call('ppt_write',{path:project.pages[0].sourcePath,content:'<svg/>'}),call('ppt_write',{path:'template-workspace/templates/design_spec.style.technical-deepdive.md',content:fs.readFileSync(path.join(templateRoot,'brands/中汽研/templates/design_spec.md'),'utf8')}));
    let started=service.agent(input('创建项目内Style，保留已有页面'));await answer('template');await wait(()=>store.jobs(project.projectId).find(item=>item.jobId===started.jobId)?.status==='failed');project=service.get(project.projectId);assert.match(project.jobs.find(item=>item.jobId===started.jobId).error,/模板类型/);assert.equal(project.pages[0].hash,existingHash);assert(replies.some(item=>String(item).includes('创建模板只能写模板工作区')));
    steps.push(call('ppt_ask',{phase:'template',question:'确认用完整方法规格创建Style？',summary}),call('ppt_write',{path:'template-workspace/templates/design_spec.style.technical-deepdive.md',content:fs.readFileSync(path.join(templateRoot,'styles/technical-deepdive/templates/design_spec.md'),'utf8')}));
    started=service.agent(input('继续创建完整Style，保留业务页面'));await answer('template');await settle(started);assert.equal(project.pages[0].hash,existingHash);assert(fs.existsSync(path.join(project.root,'template-workspace/templates/design_spec.style.technical-deepdive.md')));
  });
  await check('真实Electron资料状态：两份解析中取消不产生假ready；重试后移除不进入模型材料范围',async()=>{
    const first=path.join(root,'第一份取消资料.txt'),second=path.join(root,'第二份取消资料.txt');fs.writeFileSync(first,'第一份合成资料');fs.writeFileSync(second,'资料中断专用');
    service.attachConversation({conversationId:conversation.conversationId,paths:[first,second]});materialPause=new Promise(resolve=>{releaseMaterial=resolve;});let started=service.importMaterials({projectId:project.projectId,revision:project.revision,paths:[first,second]});
    const parsing=await wait(()=>{const items=service.conversation({projectId:project.projectId}).attachments;return items.filter(item=>item.status==='parsing').length===2 && items.some(item=>item.pendingHash)?items:null;});assert(!parsing.some(item=>item.status==='ready'));service.cancel(project.projectId);releaseMaterial();materialPause=null;
    await wait(()=>store.jobs(project.projectId).find(item=>item.jobId===started.jobId)?.status==='cancelled');project=service.get(project.projectId);assert(project.conversation.attachments.every(item=>item.status==='failed'));assert(!fs.existsSync(path.join(project.root,parsing[0].pendingPath || '不存在.txt')));
    const item=project.conversation.attachments[0];service.attachConversation({conversationId:conversation.conversationId,retryId:item.attachmentId});await settle(service.importMaterials({projectId:project.projectId,revision:project.revision,paths:[first]}));const ready=project.conversation.attachments.find(item=>item.status==='ready');assert(fs.existsSync(path.join(project.root,ready.path)));
    service.attachConversation({conversationId:conversation.conversationId,removeId:ready.attachmentId});steps.push(call('ppt_list',{path:'materials'}),call('ppt_read',{path:ready.path}));await settle(service.agent(input('只作澄清，不使用已移除资料')));assert(replies.some(item=>String(item).includes('不属于当前有效资料范围')));assert(fs.existsSync(path.join(project.root,ready.path)));
  });
  await check('真实SDK Quick七页：明确用户指令、字体校准、P05早期门禁、最终检查与PPTX',async()=>{
    const {pageSvg}=require('./opt-ppt-fixture.cjs');conversation=service.conversation();project=service.create({parent:root,title:'OPT真实Quick七页',conversationId:conversation.conversationId,requirements:{creationScope:'deck',aspectRatio:'16:9',language:'zh-CN',quick:false}});
    const instruction='快速制作七页合成资料演示，跳过策略确认，不使用收费模型或图片';
    steps.push(call('ppt_select_route',{intentQuote:instruction}),call('ppt_font_calibrate',{roles:[{name:'title',family:'Microsoft YaHei',size:40},{name:'body',family:'Microsoft YaHei',size:24}]}));
    for(let index=1;index<=7;index++) {steps.push(call('ppt_write',{path:`svg_output/slide_${String(index).padStart(2,'0')}.svg`,content:pageSvg({title:`合成第${index}页`,content:`第${index}份隔离说明`}).replace('<svg ','<svg lang="zh-CN" data-pptx-page-role="content" ')}));if(index===5) steps.push(call('ppt_tool',{action:'check-early'}));}
    await settle(service.agent(input(instruction)));assert.equal(project.pages.length,7);assert(!fs.existsSync(path.join(project.root,'design_spec.md')));assert(!fs.existsSync(path.join(project.root,'spec_lock.md')));assert.equal(store.project(project.projectId).plan,null);service.confirm({projectId:project.projectId,revision:project.revision});assert.equal(service.get(project.projectId).confirmedRevision,project.revision);await settle(await service.exportProject({projectId:project.projectId,revision:project.revision,format:'pptx'}));assert.equal(require('../electron/services/pptTemplateService.cjs').inspectPptx(path.join(root,'成品.pptx')).pageCount,7);fs.copyFileSync(path.join(root,'成品.pptx'),path.join(root,'Quick七页.pptx'));const exported=path.join(root,'成品.pptx'),bytes=fs.readFileSync(exported);assert(service.get(project.projectId).exportResult);fs.writeFileSync(exported,'已被其他稿件覆盖');assert(!service.get(project.projectId).exportResult);fs.writeFileSync(exported,bytes);assert(service.get(project.projectId).exportResult);await settle(await service.exportProject({projectId:project.projectId,revision:project.revision,format:'images'}));const images=service.get(project.projectId).exportResult,png=path.join(images.target,project.pages[0].slideId+'.png'),image=fs.readFileSync(png);fs.writeFileSync(png,'图片已变化');assert(!service.get(project.projectId).exportResult);fs.writeFileSync(png,image);assert(service.get(project.projectId).exportResult);
  });
  await check('已移除PNG：真实SDK视觉读取与生图参考同时拒绝，旧文件保留且零图片调用',async()=>{
    conversation=service.conversation();project=service.create({parent:root,title:'OPT图片引用边界',conversationId:conversation.conversationId,requirements:{creationScope:'single',aspectRatio:'16:9',language:'zh-CN',quick:false,visualModelEnabled:true,imageGenerationEnabled:true,imageGenerationLimit:1}});
    const original=path.join(root,'已移除图片.png');await require('sharp')({create:{width:40,height:30,channels:3,background:'#cc3344'}}).png().toFile(original);service.attachConversation({conversationId:conversation.conversationId,paths:[original]});await settle(service.importMaterials({projectId:project.projectId,revision:project.revision,paths:[original]}));const ready=project.conversation.attachments[0],raw=ready.path.replace(/\.md$/,'');service.attachConversation({conversationId:conversation.conversationId,removeId:ready.attachmentId});const before=replies.length;
    steps.push(call('ppt_ask',{phase:'phase1',question:'确认隔离图片边界测试？',summary:phase1}),call('ppt_ask',{phase:'phase2',question:'选择测试方案？',summary:{directions}}),call('ppt_image_read',{path:raw}),call('ppt_image_generate',{prompt:'仅隔离负例，不能发出调用',size:'1024x1024',references:[{path:raw,role:'主体'}]}));const started=service.agent(input('测试移除后的图片读取，不能调用外部模型'));await answer('phase1');await answer('phase2');await settle(started);assert.equal(replies.slice(before).filter(item=>String(item).includes('不属于当前有效资料范围')).length,2);assert.equal(imageImports,0);assert(fs.existsSync(path.join(project.root,raw)));assert(fs.existsSync(original));
  });
  await check('真实模板选择：固定import/mirror/apply工具与安装字节回执；未授权不下载',async()=>{
    const source=path.join(root,'Quick七页.pptx');conversation=service.conversation();project=service.create({parent:root,title:'OPT原件准备',conversationId:conversation.conversationId,requirements:{creationScope:'deck',aspectRatio:'16:9',language:'zh-CN',quick:false}});
    service.saveConversation({conversationId:conversation.conversationId,selection:{creationScope:'deck',skillHash:'',template:{filePath:source,title:'真实隔离原件'}}});project=service.get(project.projectId);assert(!fs.existsSync(path.join(project.root,'sources/selected-template.pptx')));
    steps.push(call('ppt_ask',{phase:'phase1',question:'确认仅准备所选真实原件？',summary:{...phase1,template:'所选真实隔离原件'}}),call('ppt_template_prepare',{}));const started=service.agent(input('准备真实原件并在同一会话继续澄清'));await answer('phase1');await settle(started);
    const checkpoint=project.conversation.checkpoint,receipt=JSON.parse(fs.readFileSync(path.join(checkpoint.root,'reports/template-prepared.json'),'utf8'));assert.equal(receipt.pages,7);assert(receipt.installedHash);assert.equal(receipt.hash,require('../electron/services/pptTemplateService.cjs').inspectPptx(source).hash);assert.equal(project.pages.length,0);
    const options=directions.map(option=>({...option,pages:Array.from({length:7},(_,index)=>({title:`合成第${index+1}页`}))}));steps.push(call('ppt_ask',{phase:'phase2',question:'确认下一候选的七页方案？',summary:{directions:options}}),call('ppt_tool',{action:'template-check'}),call('ppt_ask',{phase:'phase2',question:'重新检查未改变模板事实，确认继续？',summary:{directions:options}}));const following=service.agent(input('仅在下一候选重新检查模板并确认方案'));await answer('phase2');await answer('phase2');await settle(following);const next=project.conversation.checkpoint.root;assert.notEqual(next,checkpoint.root);assert.equal(require('../electron/services/pptSkillService.cjs').directoryHash(path.join(next,'template-reference')),receipt.treeHash);assert(fs.existsSync(path.join(next,'reports/template-quality.json')));assert(!fs.existsSync(path.join(next,'template-reference/templates/svg_quality_report.json')));
  });
  await check('P07真实解析两份资料一损坏一成功；可用材料独立保留且模型不可读取失败项',async()=>{
    conversation=service.conversation();project=service.create({parent:root,title:'OPT分项资料回归',conversationId:conversation.conversationId,requirements:{creationScope:'single',quick:false}});const good=path.join(root,'有效资料.txt'),bad=path.join(root,'损坏资料.docx');fs.writeFileSync(good,'只能使用这一份真实解析后的合成资料','utf8');fs.writeFileSync(bad,'不是有效DOCX压缩结构','utf8');const before=[good,bad].map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    service.attachConversation({conversationId:conversation.conversationId,paths:[good,bad]});await settle(service.importMaterials({projectId:project.projectId,revision:project.revision,paths:[good,bad]}));const attachments=project.conversation.attachments,ready=attachments.find(a=>a.original===good),failed=attachments.find(a=>a.original===bad);assert.equal(ready.status,'ready');assert.equal(failed.status,'failed');assert(failed.error);assert(!failed.path);assert(fs.existsSync(path.join(project.root,ready.path)));assert.equal(fs.readFileSync(path.join(project.root,ready.path),'utf8'),'只能使用这一份真实解析后的合成资料');assert.deepEqual([good,bad].map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')),before);
    const replyCount=replies.length;steps.push(call('ppt_read',{path:ready.path}));await settle(service.agent(input('只读取可用材料并继续同页沟通')));assert(replies.slice(replyCount).some(reply=>String(reply).includes('只能使用这一份真实解析后的合成资料')));fs.writeFileSync(path.join(root,'material-partial-proof.json'),JSON.stringify({attachments,externalHashes:before,jobStatus:'completed'},null,2),'utf8');
  });
  fs.writeFileSync(path.join(root,'sdk-replies.json'),JSON.stringify(replies,null,2),'utf8');
}
const timeout=setTimeout(()=>app.exit(1),600000);
main().then(()=>{fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify({status:'PASS',layer:'真实SDK+本地模拟供应商+真实Electron+实际AppContainer',externalModel:'NOT_RUN',installer:'NOT_RUN',results},null,2),'utf8');return service?.close();}).then(()=>agent?.close()).then(()=>fixture?.close()).then(()=>{sqlite?.close();clearTimeout(timeout);app.exit(0);}).catch(async(error)=>{console.error(error.stack);fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify({status:'FAIL',error:error.stack,results},null,2),'utf8');try{await service?.close();await agent?.close();await fixture?.close();sqlite?.close();}catch{}clearTimeout(timeout);app.exit(1);});
