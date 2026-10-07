import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { ManagedResource, PptConversation, PptProject, PptSkill } from '../../shared/types/ipc';
import { ResourceThumbnail } from '../../shared/ui/ResourceThumbnail';
import { useToast } from '../../shared/ui';

const summaryLabels: Record<string,string> = { purpose:'用途',audience:'受众',goal:'目标',language:'语言',aspectRatio:'画幅',template:'模板或自由设计',directions:'三个方案',title:'标题',style:'风格',colors:'配色',fonts:'字体',body:'正文',bodySize:'正文字号',imageStrategy:'配图方式',notes:'讲稿',pages:'页面组织',content:'内容',background:'背景',text:'文字',primary:'主色',secondary:'辅助色',accent:'强调色',muted:'弱化色',scopeDescription:'本次修改范围',instruction:'您的完整指令',actualScope:'实际页面范围',slideId:'页面标识',source:'源文件',sourceHash:'内容指纹',directionId:'方案标识',kind:'模板类型',scope:'工作区范围',intent:'模板用途',sourceBoundary:'来源边界',route:'制作路线',attachmentId:'旧稿附件',name:'文件',ratioDecision:'画幅处理',pageCount:'页数',imageGenerationEnabled:'启用收费配图',imageGenerationLimit:'最大调用次数',visualModelEnabled:'使用视觉模型',mediaEnabled:'本地媒体导出',secondsPerPage:'每页秒数' };
function SummaryValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <div>{value.map((item,index) => <details key={index}><summary>{typeof item === 'object' && item && 'title' in item ? String(item.title) : `第${index+1}项`}</summary><SummaryValue value={item} /></details>)}</div>;
  if (value && typeof value === 'object') return <dl>{Object.entries(value).map(([key,item]) => <div key={key}><dt>{summaryLabels[key] || key}</dt><dd><SummaryValue value={item} /></dd></div>)}</dl>;
  return <span>{typeof value === 'boolean' ? value ? '启用' : '不启用' : ({ 'edit-native':'保留设计原生编辑',beautify:'保留原文美化',keep:'保持原画幅',reflow:'按当前画幅重新布局' } as Record<string,string>)[String(value)] || String(value ?? '未设置')}</span>;
}

export function PptAgentConversation({ project, onProject, onWorkspace, compact = false, slideId }: { project: PptProject | null; onProject: (value: PptProject) => void; onWorkspace: () => void; compact?: boolean; slideId?: string }) {
  const api = window.yibiao!.ppt, { showToast } = useToast();
  const [conversation, setConversation] = useState<PptConversation | null>(project?.conversation || null);
  const [text, setText] = useState(project?.conversation.text || ''), [stream, setStream] = useState(''), [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false), [answerText, setAnswerText] = useState(''), [localScope, setLocalScope] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false), [parent, setParent] = useState(''), [title, setTitle] = useState(''), [defaultParent, setDefaultParent] = useState(false);
  const [volume, setVolume] = useState<{ path: string; freeBytes: number; systemVolume: boolean } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false), [templates, setTemplates] = useState<ManagedResource[]>([]), [version, setVersion] = useState(0), [query, setQuery] = useState('');
  const [templateKind,setTemplateKind] = useState('deck'), [templateRatio,setTemplateRatio] = useState(''), [templateOffset,setTemplateOffset] = useState(0), [templateTotal,setTemplateTotal] = useState(0);
  const [personal,setPersonal] = useState<Awaited<ReturnType<typeof api.personalTemplates>>>([]), [personalPreview,setPersonalPreview] = useState<(typeof personal)[number] | null>(null);
  const [scopeChoice,setScopeChoice] = useState(false), [cancelOpen,setCancelOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false), [skills, setSkills] = useState<PptSkill[]>([]);
  const draft = useRef({ conversationId: '', text: '', dirty: false }), sequence = useRef(0), live = useRef(true);
  const running = project?.jobs.some((item) => ['queued', 'running', 'waiting_user'].includes(item.status)) || false;
  async function act(action: () => Promise<unknown>) { setBusy(true); try { await action(); } catch (error) { showToast(String(error), 'error'); } finally { if (live.current) setBusy(false); } }
  async function refresh(id = project?.projectId) { if (id) { const value = await api.get(id); if (live.current) { onProject(value); setConversation(value.conversation); } return value; } }
  useEffect(() => {
    live.current = true;
    if (project) { setConversation(project.conversation); draft.current = { conversationId: project.conversation.conversationId, text: project.conversation.text, dirty: false }; setText(project.conversation.text); }
    else void api.conversation().then((value) => { if (live.current) { setConversation(value); setText(value.text); draft.current = { conversationId: value.conversationId, text: value.text, dirty: false }; } }).catch((error) => showToast(String(error), 'error'));
    void api.preferences().then((value) => setParent(value.parent || '')).catch((error) => showToast(String(error), 'error'));
    return () => { live.current = false; if (draft.current.dirty && draft.current.conversationId) void api.saveConversation(draft.current).catch((error) => showToast(String(error), 'error')); };
  }, [project?.projectId]);
  useEffect(() => { if (project?.conversation) setConversation(project.conversation); }, [project?.conversation]);
  useEffect(() => {
    if (!conversation) return;
    sequence.current = 0;
    return api.onEvent(conversation.conversationId, (event) => {
      if (event.sequence <= sequence.current || event.projectId !== project?.projectId) return;
      sequence.current = event.sequence;
      if (event.type === 'assistant_delta') setStream((value) => value + (event.delta || ''));
      if (event.type === 'assistant_end') { setStream(''); void refresh(); }
      if (event.type === 'tool_start') setProgress(`正在执行：${({ ppt_ask: '等待您的回答', ppt_template_prepare: '准备模板', ppt_plan: '保存内部方案', ppt_write: '保存制作候选', ppt_tool: '检查与转换' } as Record<string, string>)[event.tool || ''] || '处理项目资料'}`);
      if (['question', 'answer', 'task_end', 'task_error', 'chat_complete'].includes(event.type)) { setStream(''); void refresh(); }
    });
  }, [conversation?.conversationId, project?.projectId]);
  useEffect(() => {
    if (!conversation || !draft.current.dirty) return;
    const timer = window.setTimeout(() => { const current = { ...draft.current }; void api.saveConversation(current).then(() => { if (draft.current.text === current.text) draft.current.dirty = false; }).catch((error) => showToast(String(error), 'error')); }, 500);
    return () => window.clearTimeout(timer);
  }, [text, conversation?.conversationId]);
  useEffect(() => {
    if (!templatesOpen) return;
    let active = true;
    if(templateKind==='mine') void api.personalTemplates().then(value=>{if(active)setPersonal(value);}).catch(error=>showToast(String(error),'error'));
    else void window.yibiao!.resources.list({ center: 'templates', query, kind: templateKind, aspectRatio:templateRatio, offset:templateOffset, limit:40 }).then((value) => { if (active) { setTemplates(value.items); setVersion(value.version); setTemplateTotal(value.total); } }).catch((error) => showToast(String(error), 'error'));
    return () => { active = false; };
  }, [templatesOpen, query, templateKind,templateRatio,templateOffset]);
  async function select(selection: PptConversation['selection']) {
    const value = await api.saveConversation({ conversationId: conversation!.conversationId, selection }); setConversation(value);
    if (project) { if (selection.skillHash !== (project.resource?.skillHash || '')) await api.selectSkillVersion({ projectId: project.projectId, revision: (await api.get(project.projectId)).revision, contentHash: selection.skillHash }); await refresh(); }
    showToast(project ? '制作选择已更新；受影响的阶段需要在会话中重新确认' : '选择已保存，确认后才准备模板', 'info');
  }
  async function attach(paths?: string[]) { const selected = paths || await api.selectMaterials(); if (selected.length) setConversation(await api.attachConversation({ conversationId: conversation!.conversationId, paths: selected })); }
  async function send(value = project) {
    if (!conversation || !text.trim()) return;
    await api.saveConversation({ conversationId: conversation.conversationId, text });
    if (!value) {
      if (!parent) { setTitle(text.trim().split('\n')[0].slice(0, 40)); setSaveOpen(true); return; }
      try { value = await api.create({ parent, title: title.trim() || text.trim().split('\n')[0].slice(0, 40), conversationId: conversation.conversationId, requirements: { brief: text, creationScope: conversation.selection.creationScope, aspectRatio: '16:9', language: 'zh-CN', materialsOnly: true, confirmationSurface: 'chat', imageGenerationEnabled: false, quick: false } }); }
      catch (error) { setSaveOpen(true); throw error; }
      if (conversation.selection.skillHash) value = await api.selectSkillVersion({ projectId: value.projectId, revision: value.revision, contentHash: conversation.selection.skillHash });
      onProject(value); setSaveOpen(false); if (defaultParent) await api.setPreferences({ parent });
    }
    const pending = (await api.conversation({ conversationId: conversation.conversationId })).attachments.filter((item) => item.status === 'selected');
    if (pending.length) {
      const task = await api.importMaterials({ projectId: value.projectId, revision: value.revision, paths: pending.map((item) => item.original) });
      do { await new Promise((resolve) => window.setTimeout(resolve, 500)); value = (await refresh(value.projectId))!; } while (live.current && ['queued','running'].includes(value.jobs.find((item) => item.jobId === task.jobId)?.status || ''));
      if (!live.current) return;
      if (value.jobs.find((item) => item.jobId === task.jobId)?.status !== 'completed') throw new Error('资料解析未完成，已保留输入与逐项失败记录；核对资料后再发送');
    }
    await api.agent({ projectId: value.projectId, revision: value.revision, conversationId: conversation.conversationId, operation: 'chat', instruction: text, slideIds: localScope && slideId ? [slideId] : undefined });
    draft.current = { conversationId: conversation.conversationId, text: '', dirty: false }; setText(''); await refresh(value.projectId); setProgress('已受理，正在沟通与处理');
  }
  const pending = conversation?.questions.slice().reverse().find((item) => item.status === 'pending');
  const question = pending ? JSON.parse(pending.dataJson) as { question: string; options: Array<{ id: string; label: string; custom: boolean }>; summary?: Record<string, unknown> } : null;
  return <section className={`ppt-conversation ${compact ? 'is-compact' : ''}`}>
    {!compact && <div className="ppt-agent-welcome"><h1>让你的演示与时代同频共振</h1><p>让你的演示惊艳、制作高效</p></div>}
    {compact && <h3>Jato Agent <small>PPT 模式</small></h3>}
    <div className="ppt-conversation-messages" role="log" aria-label="PPT项目会话">
      {conversation?.messages.map((item) => <article className={`ppt-message is-${item.role}`} key={item.messageId}><small>{JSON.parse(item.metadataJson).migrated ? '历史任务摘要' : item.role === 'user' ? '你' : 'Jato Agent'}</small><p>{item.content}</p></article>)}
      {stream && <article className="ppt-message"><small>Jato Agent · 正在回复</small><p>{stream}</p></article>}
      {question && pending && <article className="ppt-question"><strong>{pending.phase === 'phase1' ? '确认用途与制作方向' : pending.phase === 'phase2' ? '选择完整制作方案' : '需要您的回答'}</strong><p>{question.question}</p>{question.summary && <details open><summary>本次确认内容</summary><div className="ppt-confirm-summary"><SummaryValue value={question.summary} /></div></details>}
        <textarea aria-label="调整方案或回答" value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="选择调整时填写具体要求" />
        <div className="ppt-actions">{question.options.map((option) => <button disabled={busy || option.custom && !answerText.trim()} key={option.id} onClick={() => void act(async () => { await api.answer({ projectId: project!.projectId, conversationId: conversation!.conversationId, questionId: pending.questionId, taskId: pending.taskId, gateId: pending.gateId, phase: pending.phase, fingerprint: pending.fingerprint, optionId: option.id, text: answerText }); setAnswerText(''); await refresh(); })}>{option.label}</button>)}</div>
      </article>}
      {project?.jobs.slice(0, 3).map((job) => <p className="ppt-task-state" key={job.jobId}>{({ waiting_user:'等待您的回答', running: progress || '正在处理', queued:'已排队', completed: job.phase === 'chat' ? '本轮会话完成' : '工具任务完成', failed:'任务失败，原版保留', cancelled:'已取消，原版保留', interrupted:'上次任务中断，检查点已保留' } as Record<string,string>)[job.status] || job.status}{job.error && `：${job.error}`}</p>)}
      {project?.pages.length && !compact && !running ? <div className="ppt-result"><strong>当前已检查版本 · {project.pages.length}页</strong>{project.pages[0].previewUrl && <img src={project.pages[0].previewUrl} alt="当前已检查版本首页" />}<button className="image-studio-primary" onClick={onWorkspace}>查看已检查页面</button></div> : null}
    </div>
    <div className="ppt-conversation-composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!running && conversation) void act(() => attach(Array.from(event.dataTransfer.files).map((file) => api.droppedPath(file)).filter(Boolean))); }}>
      <div className="ppt-attachments">{conversation?.attachments.map((item) => <span key={item.attachmentId} title={item.error}>{item.name} · {({ selected:'已添加', parsing:'解析中', ready:'可用于本次', failed:'解析失败' })[item.status]}{item.status === 'failed' && <button disabled={busy || running} onClick={() => void act(async () => setConversation(await api.attachConversation({ conversationId: conversation.conversationId, retryId: item.attachmentId })))}>重试此资料</button>}<button aria-label={`移除附件 ${item.name}`} disabled={busy || running} onClick={() => void act(async () => setConversation(await api.attachConversation({ conversationId: conversation.conversationId, removeId: item.attachmentId })))}>×</button></span>)}</div>
      <textarea aria-label="PPT需求或修改指令" value={text} onChange={(event) => { setText(event.target.value); draft.current = { conversationId: conversation?.conversationId || '', text: event.target.value, dirty: true }; }} placeholder="描述主题、用途与受众，或拖入资料。我们在这里一起完成演示。" />
      <div className="ppt-composer-actions"><button disabled={busy || running || !conversation} onClick={() => void act(() => attach())}>上传资料</button><button disabled={busy || running || !conversation} onClick={() => void act(async () => { setSkills(await api.skills.list()); setSkillsOpen(true); })}>技能 · {skills.find((item) => item.contentHash === conversation?.selection.skillHash)?.name || 'ppt-master'}</button><button disabled={busy || running || !conversation} onClick={() => {setTemplateKind(conversation?.selection.creationScope==='single'?'layout':'deck');setTemplateOffset(0);setTemplatesOpen(true);}}>{conversation?.selection.template?.title || '选择模板'}</button>
        <select aria-label="制作范围" disabled={busy || running || !conversation} value={conversation?.selection.creationScope || 'deck'} onChange={(event) => {if(event.target.value==='single' && project?.pages.length) setScopeChoice(true);else void act(() => select({ ...conversation!.selection, creationScope: event.target.value as 'deck' | 'single' }));}}><option value="deck">整套PPT</option><option value="single">单页PPT</option></select>
        {compact && slideId && <label><input type="checkbox" checked={localScope} disabled={running} onChange={(event) => setLocalScope(event.target.checked)} />仅修改当前页</label>}
        {running ? <button onClick={() => setCancelOpen(true)}>取消任务</button> : <button className="image-studio-primary" aria-label="发送PPT需求" disabled={busy || !conversation || !text.trim()} onClick={() => void act(() => send())}>{busy ? '正在处理…' : '发送'}</button>}
      </div>
      <small>资料支持 Word、PDF、TXT、Markdown、PPTX、图片及现有表格解析；单份256 MB，总量1 GB。选择模板后不会立即下载或执行。</small>
    </div>
    <Dialog.Root open={saveOpen} onOpenChange={setSaveOpen}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><header><Dialog.Title>保存本次演示</Dialog.Title><Dialog.Close aria-label="取消保存位置">×</Dialog.Close></header><Dialog.Description>首次发送或导入资料时创建独立项目子目录；取消会保留输入和待添加资料。</Dialog.Description><label>项目名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>父目录<input readOnly value={parent} /><button disabled={busy} onClick={() => void act(async () => { const value = await api.selectDirectory(); if (value?.systemVolume) setVolume(value); else if (value) setParent(value.path); })}>选择保存位置</button></label><label><input type="checkbox" checked={defaultParent} onChange={(event) => setDefaultParent(event.target.checked)} />作为以后新项目的默认位置</label><button className="image-studio-primary" disabled={busy || !parent || !title.trim()} onClick={() => void act(() => send())}>保存并继续本次发送</button></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={Boolean(volume)} onOpenChange={(open) => { if (!open) setVolume(null); }}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>所选目录位于系统盘</Dialog.Title><Dialog.Description>项目资料和历史可能持续占用空间，建议选择非系统盘。</Dialog.Description><p>{volume?.path} · 可用 {((volume?.freeBytes || 0)/1024**3).toFixed(1)} GB</p><div className="ppt-actions"><button onClick={() => setVolume(null)}>重新选择（推荐）</button><button onClick={() => { setParent(volume!.path); setVolume(null); }}>仍然使用</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={templatesOpen} onOpenChange={setTemplatesOpen}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog ppt-template-picker"><header><Dialog.Title>选择模板候选</Dialog.Title><Dialog.Close aria-label="关闭模板选择">×</Dialog.Close></header><Dialog.Description>确认制作方向后才准备；选择只保存候选，不替换当前稿。</Dialog.Description><div className="ppt-actions"><input aria-label="搜索制作模板" value={query} onChange={(event) => {setQuery(event.target.value);setTemplateOffset(0);}} placeholder="搜索模板" /><select aria-label="制作模板分类" value={templateKind} onChange={event=>{setTemplateKind(event.target.value);setTemplateOffset(0);}}><option value="deck">整套模板</option><option value="layout">单页版式</option><option value="mine">个人模板</option></select><select aria-label="制作模板画幅" value={templateRatio} onChange={event=>{setTemplateRatio(event.target.value);setTemplateOffset(0);}}><option value="">全部画幅</option><option>4:3</option><option>16:9</option></select></div><div className="ppt-actions"><button onClick={() => void act(async () => { await select({ ...conversation!.selection, template: null }); setTemplatesOpen(false); })}>自由设计</button><button onClick={() => void act(async () => { const filePath = await api.selectPpt(); if (filePath) { const info = await api.inspectTemplate(filePath); await select({ ...conversation!.selection, template: { filePath, hash: info.hash, title: filePath.split(/[\\/]/).pop() || '本地模板' } }); setTemplatesOpen(false); } })}>选择本地PPTX</button></div>
      {templateKind==='mine' ? <div className="ppt-template-grid">{personal.filter(item=>item.title.includes(query) && (!templateRatio || item.aspectRatio===templateRatio)).map(item=><article key={item.templateId}><button onClick={()=>setPersonalPreview(item)} aria-label={`预览个人模板 ${item.title}`}>{item.coverUrl && <img src={item.coverUrl} alt={item.title} style={{width:'100%',aspectRatio:item.aspectRatio==='4:3'?'4/3':'16/9',objectFit:'contain'}} />}</button><strong>{item.title}</strong><p>{item.aspectRatio} · {item.pageCount}页 · 用户自存，套用仍需检查</p><button disabled={busy} onClick={()=>void act(async()=>{await select({...conversation!.selection,template:{templateId:item.templateId,title:item.title}});setTemplatesOpen(false);})}>选择此候选</button></article>)}</div> : <><div className="ppt-template-grid">{templates.map((item) => <article key={item.resourceId}><ResourceThumbnail item={item} version={version} /><strong>{item.title}</strong><p>{item.aspectRatio} · {item.capability==='native_reuse_verified'?'可直接套用：详见验证范围':item.capability==='mixed_reuse_verified'?'部分可编辑':item.capability==='visual_reference_verified'?'按此风格制作':'套用能力待验证'}</p><button disabled={!item.assets.some((asset) => asset.role === 'original') || busy} onClick={() => void act(async () => { await select({ ...conversation!.selection, template: { resourceId: item.resourceId, title: item.title } }); setTemplatesOpen(false); })}>选择此候选</button></article>)}</div><div className="ppt-actions"><button disabled={!templateOffset} onClick={()=>setTemplateOffset(Math.max(0,templateOffset-40))}>上一页</button><span>{templateTotal}项</span><button disabled={templateOffset+40>=templateTotal} onClick={()=>setTemplateOffset(templateOffset+40)}>下一页</button></div></>}
      {!(templateKind==='mine'?personal.length:templates.length) && <p>当前没有可用候选；可自由设计或选择自己的PPTX。</p>}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={Boolean(personalPreview)} onOpenChange={open=>{if(!open)setPersonalPreview(null);}}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>{personalPreview?.title}</Dialog.Title><Dialog.Description>个人模板真实首页 · {personalPreview?.aspectRatio} · {personalPreview?.pageCount}页</Dialog.Description><Dialog.Close>关闭预览</Dialog.Close>{personalPreview?.coverUrl && <img src={personalPreview.coverUrl} alt={personalPreview.title} style={{width:'100%',objectFit:'contain'}} />}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={scopeChoice} onOpenChange={setScopeChoice}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>保留已有页面并修改单页？</Dialog.Title><Dialog.Description>现有{project?.pages.length}页与历史保留。请在工作区选定目标页，仅修改该页；若要独立新稿，请从首页新建单页项目。</Dialog.Description><Dialog.Close>取消</Dialog.Close><button disabled={!slideId || busy} onClick={()=>void act(async()=>{await select({...conversation!.selection,creationScope:'single'});setLocalScope(true);setScopeChoice(false);})}>确认仅修改当前页</button><button onClick={()=>{setScopeChoice(false);onWorkspace();}}>进入工作区选择目标页</button></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={skillsOpen} onOpenChange={setSkillsOpen}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><header><Dialog.Title>制作技能</Dialog.Title><Dialog.Close aria-label="关闭技能选择">×</Dialog.Close></header><Dialog.Description>仅选择已安装技能。方法参考不会执行第三方脚本；所有制作仍使用固定工具。</Dialog.Description><button onClick={() => void act(async () => { await select({ ...conversation!.selection, skillHash: '' }); setSkillsOpen(false); })}>ppt-master · 内置默认</button>{skills.map((item) => <button key={item.contentHash} disabled={!item.enabled || !['ready','workflow_only'].includes(item.status)} onClick={() => void act(async () => { await select({ ...conversation!.selection, skillHash: item.contentHash }); setSkillsOpen(false); })}>{item.name} · {item.status === 'workflow_only' ? '方法参考' : item.enabled ? '已启用' : '未启用'}</button>)}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={cancelOpen} onOpenChange={setCancelOpen}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>取消本次制作？</Dialog.Title><Dialog.Description>停止本次任务，保留会话、输入草稿、原有成品与可验证检查点。取消后不会自动重新发起；已发生的模型调用仍可能计费。</Dialog.Description><Dialog.Close>继续本次任务</Dialog.Close><button disabled={!running} onClick={() => { setCancelOpen(false); void act(async () => { await api.cancel(project!.projectId); await refresh(); }); }}>停止本次任务</button></Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
