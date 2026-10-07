const test = require('node:test'), assert = require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const Database=require('../../management/node_modules/better-sqlite3');
const { createPptProjectStore }=require('../electron/services/pptProjectStore.cjs');
const { createPptConversationStore }=require('../electron/services/pptConversationStore.cjs');
test('OPT持久会话、最新否决/待回答阻止旧批准，方案与本轮请求分别授权', (t)=>{
  const db=new Database(':memory:');t.after(()=>db.close()); const store=createPptProjectStore({db}), conversations=createPptConversationStore(db);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'Jato-OPT-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const value=conversations.get(), project=store.create({parent:root,title:'合成测试',requirements:{creationScope:'single'}});conversations.bind(value.conversationId,project.projectId);
  let current=conversations.get({projectId:project.projectId}); const fingerprint=conversations.fingerprint(project,current);
  function question(id,status,confirmed,phase='phase2',requestId='请求甲') {db.prepare('INSERT INTO ppt_questions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,value.conversationId,'任务', 'job',id,phase,fingerprint,JSON.stringify({requestId,summary:{title:id},scope:[]}),status,JSON.stringify({confirmed}),new Date().toISOString());}
  question('旧批准','answered',true); assert(conversations.confirmed(project,conversations.get({projectId:project.projectId}),'phase2'));
  question('新待答','pending',false);assert.equal(conversations.confirmed(project,conversations.get({projectId:project.projectId}),'phase2'),null);
  db.prepare("UPDATE ppt_questions SET status='answered' WHERE question_id='新待答'").run();assert.equal(conversations.confirmed(project,conversations.get({projectId:project.projectId}),'phase2'),null);
  question('新批准','answered',true);assert.throws(()=>conversations.requireGate(project,value.conversationId,'phase2',[],'请求乙'),/本轮新指令/);
  conversations.add(value.conversationId,'user','普通澄清');assert(conversations.confirmed(project,conversations.get({projectId:project.projectId}),'phase2'));
  conversations.save({conversationId:value.conversationId,selection:{...current.selection,creationScope:'single'}});assert.equal(conversations.confirmed(project,conversations.get({projectId:project.projectId}),'phase2'),null);
  conversations.save({conversationId:value.conversationId,text:'尚未发送的草稿'});assert.equal(conversations.get({projectId:project.projectId}).text,'尚未发送的草稿');
});
test('OPT方案和模板产物审计：换色/加页/更改未选计划/类型伪装/TODO均拒绝',(t)=>{
  const {auditDesign,auditTemplate}=require('../electron/services/pptContractAudit.cjs'),{specification,lock}=require('./opt-ppt-fixture.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'Jato-OPT-合同-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pages=[{slideId:'a',title:'合成主题',fileName:'slide_01.svg'}],direction={colors:{background:'#FFFFFF',text:'#333333',primary:'#1677FF',secondary:'#555555',accent:'#AA3333',muted:'#888888'},fonts:{title:'Microsoft YaHei',body:'Microsoft YaHei'},bodySize:24,style:'swiss-minimal',notes:true,pages};
  fs.writeFileSync(path.join(root,'design_spec.md'),specification(pages));fs.writeFileSync(path.join(root,'spec_lock.md'),lock(pages));
  const payload={root,direction,requirements:{language:'zh-CN',aspectRatio:'16:9'},plan:{pages},actualPages:[{slideId:'a',sourcePath:'svg_output/slide_01.svg'}]};
  assert.throws(()=>auditDesign({...payload,actualPages:[...payload.actualPages,{slideId:'b',sourcePath:'svg_output/slide_02.svg'}]}),/实际页面/);
  auditDesign(payload);assert.throws(()=>auditDesign({...payload,direction:{...direction,colors:{...direction.colors,primary:'#CC0000'}}}),/颜色/);assert.throws(()=>auditDesign({...payload,plan:{pages:[...pages,{slideId:'b',title:'额外页'}]}}),/页数/);
  assert.throws(()=>auditDesign({...payload,scope:['b'],oldPlan:{pages:[{slideId:'a',title:'原题'}]}}),/未选页内部规划/);
  fs.mkdirSync(path.join(root,'templates'));const file=path.join(root,'templates/design_spec.md');fs.writeFileSync(file,'---\nkind: deck\ndeck_id: fake\n---\n完整规格');assert.throws(()=>auditTemplate(root,'brand'),/类型/);
  fs.writeFileSync(file,'---\nkind: style\nstyle_id: TODO\n---\n<!-- TODO -->');assert.throws(()=>auditTemplate(root,'style'),/未完成/);
  fs.writeFileSync(file,'---\nkind: style\nstyle_id: opt\n---\n完整规格');assert.equal(auditTemplate(root,'style').id,'opt');
});
test('OPT附件重启恢复以正式文件为准，候选就绪不能冒充已提交资料',(t)=>{
  const db=new Database(':memory:');t.after(()=>db.close());const store=createPptProjectStore({db}),conversations=createPptConversationStore(db),root=fs.mkdtempSync(path.join(os.tmpdir(),'Jato-OPT-资料-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const project=store.create({parent:root,title:'资料恢复',requirements:{creationScope:'single'}}),conversation=conversations.get({projectId:project.projectId}),raw=path.join(project.root,'materials/已提交.txt');fs.writeFileSync(raw,'合成内容');fs.writeFileSync(`${raw}.md`,'合成内容');
  const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(raw)).digest('hex');
  conversations.save({conversationId:conversation.conversationId,attachments:[{attachmentId:'a',name:'已提交',status:'parsing',pendingPath:'materials/已提交.txt',pendingHash:hash},{attachmentId:'b',name:'候选',status:'parsing',pendingPath:'materials/只有候选.txt',pendingHash:hash}]});
  const restored=createPptConversationStore(db).get({projectId:project.projectId});assert.equal(restored.attachments[0].status,'ready');assert.equal(restored.attachments[1].status,'failed');assert(!restored.attachments[1].path);assert.equal(conversations.attach({conversationId:conversation.conversationId,retryId:'b'}).attachments[1].status,'selected');
});

test('OPT旧批注不能错套新hash；Quick审阅只接受真实页面与当前修订',(t)=>{
  const db=new Database(':memory:');t.after(()=>db.close());const store=createPptProjectStore({db}),root=fs.mkdtempSync(path.join(os.tmpdir(),'Jato-OPT-批注-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const service=require('../electron/services/pptService.cjs').createPptService({app:{},store,runtime:{status:()=>({complete:false})},resources:{},skills:{},agentService:{},configStore:{load:()=>({})},dialog:{},shell:{}});
  const project=store.create({parent:root,title:'旧批注保留',requirements:{quick:true}}),conversations=createPptConversationStore(db),conversation=conversations.get({projectId:project.projectId}),relative='svg_output/slide_01.svg',file=path.join(project.root,relative),hash=require('../electron/services/pptTemplateService.cjs').hash;
  assert.throws(()=>service.confirm({projectId:project.projectId,revision:0}),/计划不存在/);fs.writeFileSync(file,'<svg>旧标题</svg>');store.replacePages(project.projectId,[{slideId:'a',sourcePath:relative,hash:hash(fs.readFileSync(file)),kind:'generate'}]);
  const annotation=service.saveAnnotation({projectId:project.projectId,revision:0,slideId:'a',instruction:'仅改旧标题'});conversations.save({conversationId:conversation.conversationId,text:'保留未发送草稿'});
  fs.writeFileSync(file,'<svg>已经更新的标题</svg>');store.replacePages(project.projectId,[{slideId:'a',sourcePath:relative,hash:hash(fs.readFileSync(file)),kind:'generate'}]);
  assert.throws(()=>service.applyAnnotations({projectId:project.projectId,revision:0,annotationIds:[annotation.annotationId]}),/批注目标页已变化/);assert.equal(service.annotations({projectId:project.projectId})[0].appliedAt,null);assert.equal(conversations.get({projectId:project.projectId}).text,'保留未发送草稿');assert.equal(fs.readFileSync(file,'utf8'),'<svg>已经更新的标题</svg>');assert.equal(store.jobs(project.projectId).length,0);
  service.confirm({projectId:project.projectId,revision:0});assert.equal(store.project(project.projectId).confirmedRevision,0);assert.throws(()=>service.confirm({projectId:project.projectId,revision:1}),/修订已变化/);
});

test('OPT缺失与篡改固定组件均在启动进程前拒绝，不走系统PATH且草稿保留',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'Jato-OPT-运行组件-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const draft=path.join(root,'未发送草稿.md');fs.writeFileSync(draft,'合成草稿保留');
  const runtime=require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({app:{},rootOverride:root});t.after(()=>runtime.close());const payload={script:'svg_quality_checker.py',projectRoot:root};assert.equal(runtime.status().complete,false);await assert.rejects(runtime.run(payload),/不会使用系统 PATH/);
  for(const name of ['host-tools/pptSandbox.exe','host-tools/pptTrustedTool.py','python/python.exe','ppt-master/SKILL.md']){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'隔离负例，不能执行');}
  const member='ppt-master/SKILL.md',hash=require('node:crypto').createHash('sha256').update('批准字节').digest('hex');fs.writeFileSync(path.join(root,'files-manifest.json'),JSON.stringify({files:[{path:member,hash}]}));assert.equal(runtime.status().complete,true);await assert.rejects(runtime.run(payload),/运行组件校验失败/);assert.equal(fs.readFileSync(draft,'utf8'),'合成草稿保留');assert(!fs.readdirSync(root).some(name=>name.startsWith('.runtime-')));
});
