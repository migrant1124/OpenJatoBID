import { useEffect, useRef, useState } from 'react';
import { Download, Heart, ImagePlus, Layers3, Lightbulb, Paintbrush, RotateCcw, Save, Sparkles, WandSparkles } from 'lucide-react';
import type { ImageStudioAsset, ImageStudioOptimizationCase, ImageStudioOptimizationCaseSummary, ImageStudioState, ImageStudioWork } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';
import { ImageStudioViewer, type StudioViewerImage } from './ImageStudioViewer';
import { ImageStudioRegionEditor, type StudioEditRegion } from './ImageStudioRegionEditor';
import { ImageStudioLayers } from './ImageStudioLayers';
import { ImageStudioOptimizationDialog } from './ImageStudioOptimizationDialog';
import { ImageStudioCaseDialog } from './ImageStudioCaseDialog';

export type StudioReference = { assetId?: string; workId?: string; role: string; assetUrl: string };

const roles = ['主体', '风格', '构图', '色彩'];
const imageSizes = [
  ['1024x1024', '1:1'], ['1024x2048', '1:2'], ['2048x1024', '2:1'],
  ['1536x2048', '3:4'], ['2048x1536', '4:3'], ['2048x1152', '16:9'],
  ['1152x2048', '9:16'], ['1536x1024', '3:2'],
] as const;

interface Props {
  state: ImageStudioState;
  prompt: string;
  setPrompt: (value: string) => void;
  newDraft: () => void;
  applyPrompt: (value: string) => void;
  undoAppliedPrompt: () => void;
  canUndoAppliedPrompt: boolean;
  count: number;
  setCount: (value: number) => void;
  size: string;
  setSize: (value: string) => void;
  modelKey: string;
  setModelKey: (value: string) => void;
  references: StudioReference[];
  setReferences: (value: StudioReference[]) => void;
  selectedWork: ImageStudioWork | null;
  selectWork: (id: string) => void;
  newResult: boolean;
  showLatest: () => void;
  start: () => Promise<string | void>;
  edit: (regions: StudioEditRegion[], sourceWorkId: string, sourceSha256: string, requestId: string) => Promise<string | void>;
  savePrompt: (text: string, originKind?: string, meta?: { sourceId: string; itemId: string; version: string; note: string; coverUrl: string }) => Promise<void>;
  canApplyToDraft: () => Promise<boolean>;
  startBusy: boolean;
}

export function ImageStudioCreate(props: Props) {
  const { showToast } = useToast();
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [busy, setBusy] = useState<'optimize' | 'invert' | 'import' | null>(null);
  const [candidate, setCandidate] = useState<{ kind: 'optimize' | 'invert'; original: string; sourceKey: string; snapshotKey: string;
    complete: boolean; status: string; sourceStatus: string; sources: ImageStudioOptimizationCaseSummary[];
    cacheHit: boolean; sessionId: string; modelName: string; completedMode: string; optimized: string;
    sentStatus: 'pending' | 'submitted' | 'historical' | 'unknown' } | null>(null);
  const [candidateText, setCandidateText] = useState('');
  const [shelved, setShelved] = useState<{ value: NonNullable<typeof candidate>; text: string; mode: string; selected: number } | null>(null);
  const [mode, setMode] = useState('');
  const [caseOpen, setCaseOpen] = useState(false);
  const [caseEverOpened, setCaseEverOpened] = useState(false);
  const [caseSelected, setCaseSelected] = useState(0);
  const [caseApply, setCaseApply] = useState<{ text: string; detail: ImageStudioOptimizationCase; language: 'zh' | 'original' } | null>(null);
  const [viewer, setViewer] = useState<{ images: StudioViewerImage[]; index: number } | null>(null);
  const [editingSource, setEditingSource] = useState<{ workId: string; width: number; height: number } | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const caseConfirmRef = useRef<HTMLElement>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [modelHelp, setModelHelp] = useState(false);
  const requestSerial = useRef(0);
  const optimizationRef = useRef<{ requestId: string; unsubscribe: () => void; cancelled: boolean } | null>(null);
  const selectedSourceKey = props.references[0]?.assetId || props.references[0]?.workId || props.selectedWork?.workId || '';
  const latestSourceKey = useRef(selectedSourceKey);
  latestSourceKey.current = selectedSourceKey;
  const running = props.state.tasks.some((task) => ['queued', 'running', 'sent', 'downloading'].includes(task.status));
  const latestTask = props.state.tasks[0];
  const selectedModel = props.state.models.find((model) => model.key === props.modelKey);
  const action = props.references.length ? 'reference' : 'generate';
  const canGenerate = Boolean(props.state.connection.configured && selectedModel?.actions.includes(action));

  useEffect(() => () => {
    requestSerial.current += 1;
    if (optimizationRef.current) {
      void window.yibiao!.imageStudio.cancelOptimization(optimizationRef.current.requestId);
      optimizationRef.current.unsubscribe();
      optimizationRef.current = null;
    }
  }, []);
  useEffect(() => {
    let live = true;
    void window.yibiao!.imageStudio.latestOptimization().then((last) => {
      if (!live || !last) return;
      const value: NonNullable<typeof candidate> = { kind: 'optimize', original: last.original,
        sourceKey: '', snapshotKey: last.snapshotKey, complete: ['completed', 'needs_review'].includes(last.status),
        status: last.status, sourceStatus: last.sourceStatus, sources: last.sources, cacheHit: last.cacheHit,
        sessionId: last.sessionId, modelName: last.modelName, completedMode: last.completedMode,
        optimized: last.optimized, sentStatus: last.sentStatus };
      setShelved((current) => current || { value, text: last.edited, mode: last.mode, selected: 0 });
    }).catch((error) => { if (live) showToast(String(error), 'error'); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (caseApply) caseConfirmRef.current?.querySelector('button')?.focus(); }, [caseApply]);

  function caseConfirmKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); setCaseApply(null); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...(caseConfirmRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])];
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus(); }
  }

  async function importImage() {
    if (props.references.length >= 4) return;
    setBusy('import');
    try {
      const result = await window.yibiao!.imageStudio.importAsset();
      if (!result.canceled && result.asset) {
        const asset: ImageStudioAsset = result.asset;
        props.setReferences([...props.references, { assetId: asset.assetId, assetUrl: asset.assetUrl, role: '主体' }]);
      }
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(null); }
  }

  const snapshotKey = JSON.stringify({ modelKey: props.modelKey, size: props.size,
    references: props.references.map(({ assetId, workId, role }) => ({ assetId, workId, role })) });

  function closeCandidate(recoverable = true) {
    if (candidate?.kind === 'optimize' && candidate.sessionId) persistOptimizationEdit(candidate.sessionId, candidateText, recoverable);
    if (candidate?.kind === 'optimize' && candidate.sessionId && recoverable) setShelved({ value: ['searching', 'queued', 'dispatching', 'streaming'].includes(candidate.status)
      ? { ...candidate, status: 'cancelled' } : candidate, text: candidateText, mode, selected: caseSelected });
    else if (!recoverable) setShelved(null);
    setCaseOpen(false); setCaseApply(null);
    requestSerial.current += 1;
    if (optimizationRef.current) {
      void window.yibiao!.imageStudio.cancelOptimization(optimizationRef.current.requestId);
      optimizationRef.current.unsubscribe();
      optimizationRef.current = null;
    }
    setCandidate(null);
    setBusy(null);
  }

  function openOptimization() {
    if (!props.prompt.trim()) return;
    setMode('');
    setCaseEverOpened(false);
    setCandidate({ kind: 'optimize', original: props.prompt, sourceKey: '', snapshotKey,
      complete: false, status: 'selecting', sourceStatus: '', sources: [], cacheHit: false,
      sessionId: '', modelName: selectedModel?.name || props.modelKey, completedMode: '', optimized: '', sentStatus: 'pending' });
    setCandidateText('');
  }

  async function optimize(force = false) {
    if (!props.prompt.trim() || !mode) return;
    if (optimizationRef.current) closeCandidate();
    setCaseEverOpened(false);
    const serial = ++requestSerial.current;
    const original = props.prompt;
    const requestId = crypto.randomUUID();
    let lastSequence = 0;
    const unsubscribe = window.yibiao!.imageStudio.onOptimizationEvent((event) => {
      if (event.requestId !== requestId || event.sequence <= lastSequence || serial !== requestSerial.current) return;
      lastSequence = event.sequence;
      if (event.delta) setCandidateText((text) => text + event.delta);
      setCandidate((current) => current?.kind === 'optimize' ? { ...current, status: event.status } : current);
    });
    optimizationRef.current = { requestId, unsubscribe, cancelled: false };
    setCandidate({ kind: 'optimize', original, sourceKey: '', snapshotKey,
      complete: false, status: 'searching', sourceStatus: 'searching', sources: [], cacheHit: false,
      sessionId: requestId, modelName: selectedModel?.name || props.modelKey, completedMode: '', optimized: '', sentStatus: 'pending' });
    setCandidateText('');
    setBusy('optimize');
    try {
      const result = await window.yibiao!.imageStudio.optimizePrompt({ prompt: original, mode,
        modelKey: props.modelKey, size: props.size,
        references: props.references.map(({ assetId, workId, role }) => ({ assetId, workId, role })),
        useKnowledge: true, force, requestId });
      if (serial !== requestSerial.current) return;
      if (optimizationRef.current?.cancelled) {
        setCandidate((current) => current?.kind === 'optimize' ? { ...current, status: 'cancelled' } : current);
        return;
      }
      setCandidate({ kind: 'optimize', original, sourceKey: '', snapshotKey,
        complete: result.complete, status: result.complete ? 'completed' : 'needs_review', sourceStatus: result.sourceStatus,
        sources: result.sources, cacheHit: result.cacheHit, sessionId: result.sessionId,
        modelName: selectedModel?.name || props.modelKey, completedMode: mode, optimized: result.optimized,
        sentStatus: result.cacheHit ? 'historical' : 'submitted' });
      setCandidateText(result.optimized);
    } catch (error) {
      if (serial === requestSerial.current) {
        const cancelled = optimizationRef.current?.requestId === requestId && optimizationRef.current.cancelled;
        setCandidate((current) => current?.kind === 'optimize' ? { ...current, status: cancelled ? 'cancelled' : 'failed' } : current);
        try {
          const cases = await window.yibiao!.imageStudio.optimizationCases(requestId);
          if (serial === requestSerial.current) setCandidate((current) => current?.kind === 'optimize'
            ? { ...current, sources: cases.sources, sourceStatus: cases.sourceStatus,
              sentStatus: cases.sentStatus as 'pending' | 'submitted' | 'historical' | 'unknown' } : current);
        } catch { /* 检索前取消时还没有会话快照。 */ }
        if (!cancelled) showToast(String(error), 'error');
      }
    } finally {
      unsubscribe();
      if (optimizationRef.current?.requestId === requestId) optimizationRef.current = null;
      if (serial === requestSerial.current) setBusy(null);
    }
  }

  async function invert() {
    const target = props.references[0] || (props.selectedWork ? { workId: props.selectedWork.workId } : null);
    if (!target) { showToast('请先上传参考图或选择作品。', 'info'); return; }
    const serial = ++requestSerial.current;
    const sourceKey = 'assetId' in target ? target.assetId || '' : target.workId || '';
    setBusy('invert');
    try {
      const result = await window.yibiao!.imageStudio.invertImage({
        assetId: 'assetId' in target ? target.assetId : undefined,
        workId: 'workId' in target ? target.workId : undefined,
      });
      if (serial !== requestSerial.current || latestSourceKey.current !== sourceKey) return;
      setCandidate({ kind: 'invert', original: props.prompt, sourceKey, snapshotKey: '',
        complete: true, status: 'completed', sourceStatus: '', sources: [], cacheHit: false,
        sessionId: '', modelName: '', completedMode: '', optimized: result.prompt, sentStatus: 'pending' });
      setCandidateText(result.prompt);
    } catch (error) { showToast(String(error), 'error'); }
    finally { if (serial === requestSerial.current) setBusy(null); }
  }

  async function exportWork() {
    if (!props.selectedWork) return;
    try {
      const result = await window.yibiao!.imageStudio.exportImage({ workId: props.selectedWork.workId, format });
      if (!result.canceled) showToast('图片已导出', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  const requiredLiterals = candidate ? [...candidate.original.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]) : [];
  const requiredVariables = candidate ? [...candidate.original.matchAll(/\{[^{}]+\}/g)].map((match) => match[0]) : [];
  const missingLiterals = requiredLiterals.filter((value) => !candidateText.includes(value));
  const missingVariables = requiredVariables.filter((value) => !candidateText.includes(value));
  const candidateValid = Boolean(candidateText.trim()) && !missingLiterals.length && !missingVariables.length;
  const applyAllowed = Boolean(candidate && props.prompt === candidate.original &&
    (candidate.status === 'completed' || candidate.status === 'cached' || candidate.status === 'needs_review') &&
    (candidate.status !== 'needs_review' || candidateText !== candidate.optimized) &&
    candidateValid && candidateText.length <= 10000 &&
    (candidate.kind === 'optimize' ? snapshotKey === candidate.snapshotKey : selectedSourceKey === candidate.sourceKey));
  const saveAllowed = Boolean(candidate && candidateText.trim() && candidateText.length <= 10000 && candidateValid &&
    (candidate.status === 'completed' || candidate.status === 'cached' ||
      (candidate.status === 'needs_review' && candidateText !== candidate.optimized)));
  const applyReason = !candidate || applyAllowed ? ''
    : props.prompt !== candidate.original ? '创作输入已变化，请核对后重新优化。'
      : snapshotKey !== candidate.snapshotKey ? '生图模型、画幅或参考图已变化，请重新优化。'
        : candidateText.length > 10000 ? '优化稿超过 10,000 字，请缩短后应用。'
          : missingLiterals.length || missingVariables.length
            ? `当前稿件缺少原文中的${missingLiterals.length ? `${missingLiterals.length} 处指定文字` : ''}${missingLiterals.length && missingVariables.length ? '和' : ''}${missingVariables.length ? `${missingVariables.length} 个模板变量` : ''}；补齐后可应用。`
            : candidate.status === 'needs_review' ? '模型优化稿未通过完整性检查，请补齐原文必留内容后应用。'
              : '本次优化尚未完成，不能应用。';

  async function applyOptimizedPrompt() {
    if (!applyAllowed || !candidate || !(await props.canApplyToDraft())) {
      showToast('创作输入已有新版本，请先核对后再应用。', 'error'); return;
    }
    props.applyPrompt(candidateText);
    closeCandidate(false);
  }

  function persistOptimizationEdit(sessionId: string, text: string, recoverable?: boolean) {
    if (!sessionId) return;
    void window.yibiao!.imageStudio.saveOptimizationEdit({ sessionId, text, recoverable }).catch((error) => showToast(String(error), 'error'));
  }

  function restoreOptimization() {
    if (!shelved) return;
    setCandidate(shelved.value); setCandidateText(shelved.text); setMode(shelved.mode);
    setCaseSelected(shelved.selected); setCaseOpen(false); setCaseEverOpened(false); setShelved(null);
  }

  async function newDraft() {
    if (shelved?.value.sessionId) {
      try { await window.yibiao!.imageStudio.saveOptimizationEdit({ sessionId: shelved.value.sessionId, text: shelved.text, recoverable: false }); }
      catch (error) { showToast(String(error), 'error'); }
    }
    setShelved(null);
    props.newDraft();
  }

  async function confirmCaseApply() {
    if (!caseApply || !candidate || props.prompt !== candidate.original || !(await props.canApplyToDraft())) {
      showToast('创作输入已有新版本，请先核对后再应用。', 'error'); setCaseApply(null); return;
    }
    if (caseApply.text.length > 10000 || !caseApply.text.trim()) return;
    props.applyPrompt(caseApply.text);
    closeCandidate(false);
  }

  return <div className="image-studio-create-shell">
    <div className="image-studio-model-line">文本：{props.state.textModelName || '未配置'} <span>生图连接：金龙中转站 · {props.state.connection.configured ? '已配置 Key' : '未配置 Key'}</span></div>
    <div className="image-studio-workspace">
      <section className="image-studio-compose" aria-label="创作输入">
        <div className="image-studio-compose-fields">
        <div className="image-studio-panel-head"><h2>创作输入</h2><div className="image-studio-compose-head-actions"><button type="button" className="image-studio-new-draft" onClick={() => void newDraft()}>新建</button><small>自动保存草稿</small></div></div>
        <label htmlFor="image-studio-prompt">图片需求</label>
        <textarea id="image-studio-prompt" maxLength={10001} value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} placeholder="用中文描述主体、场景、光线与希望保留的细节" />
        <div className="image-studio-field-foot"><span>{props.prompt.length.toLocaleString()} / 10,000</span></div>
        <div className="image-studio-tool-row">
          <button type="button" onClick={() => void invert()} disabled={Boolean(busy)} title="根据图片生成参考描述"><ImagePlus size={16} /> 反推提示词</button>
          <button type="button" onClick={() => void props.savePrompt(props.prompt)} disabled={!props.prompt.trim()} title="保存到我的提示词"><Save size={16} /> 保存</button>
          {props.canUndoAppliedPrompt && <button type="button" onClick={props.undoAppliedPrompt} title="撤销刚应用的提示词"><RotateCcw size={16} /> 撤销应用</button>}
        </div>
        <div className="image-studio-field-title"><label>参考图片 <span>可选</span></label><small>{props.references.length} / 4</small></div>
        <div className="image-studio-reference-list">
          {props.references.map((reference, index) => <div className="image-studio-reference" key={reference.assetId || reference.workId}>
            <button type="button" className="image-studio-reference-preview-button" title={`放大参考图片 ${index + 1}`} aria-label={`放大参考图片 ${index + 1}`} onClick={() => setViewer({ images: props.references.map((item, position) => ({ url: item.assetUrl, label: `参考图片 ${position + 1}` })), index })}><img src={reference.assetUrl} alt="" /></button>
            <select aria-label={`参考图片 ${index + 1} 用途`} value={reference.role} onChange={(event) => props.setReferences(props.references.map((item, position) => position === index ? { ...item, role: event.target.value } : item))}>{roles.map((role) => <option key={role}>{role}</option>)}</select>
            <button type="button" className="image-studio-reference-remove" aria-label={`移除参考图片 ${index + 1}`} title="移除参考图片" onClick={() => props.setReferences(props.references.filter((_, position) => position !== index))}>×</button>
          </div>)}
          {props.references.length < 4 && <button type="button" className="image-studio-add-reference" onClick={() => void importImage()} disabled={busy === 'import'} title="添加参考图片"><ImagePlus size={20} /><span>添加</span></button>}
        </div>
        <div className="image-studio-model-action"><label>本次生图模型<select value={props.modelKey} onChange={(event) => props.setModelKey(event.target.value)}>{props.state.models.map((model) => <option value={model.key} key={model.key}>{model.requestModelId}</option>)}</select></label><button type="button" onClick={openOptimization} disabled={!props.prompt.trim() || Boolean(busy)}><WandSparkles size={16} /> 优化提示词</button>{shelved && <button type="button" onClick={restoreOptimization}>恢复上次优化稿</button>}</div>
        <div className="image-studio-model-rule"><small>已自动匹配模型优化规则</small><button type="button" onClick={() => setModelHelp(true)}>模型选择说明</button></div>
        <div className="image-studio-two-fields"><label>生成张数<select value={props.count} onChange={(event) => props.setCount(Number(event.target.value))}><option value={1}>1 张</option><option value={2}>2 张</option><option value={4}>4 张</option></select></label><label>图片画幅<select value={props.size} onChange={(event) => props.setSize(event.target.value)}>
          {!imageSizes.some(([value]) => value === props.size) && props.size && <option value={props.size}>{props.size.replace('x', ' × ')} · 当前设置</option>}
          {imageSizes.map(([value, ratio]) => <option key={value} value={value}>{value.replace('x', ' × ')} · {ratio}</option>)}
        </select></label></div>
        {!props.state.connection.configured && <p className="image-studio-warning">请先在设置中填写金龙中转站的生图模型 API Key。</p>}
        </div>
        <button type="button" className="image-studio-primary image-studio-generate" onClick={() => void props.start()} disabled={!canGenerate || !props.prompt.trim() || props.prompt.length > 10000 || running || props.startBusy}><Sparkles size={17} /> {running || props.startBusy ? '生成中' : '生成图片'}</button>
      </section>
      <section className="image-studio-result" aria-label="生成结果">
        <div className="image-studio-panel-head"><h2>生成结果</h2><div className="image-studio-task-head">{latestTask && <small>{latestTask.status} · {latestTask.completedCount}/{latestTask.requestedCount}</small>}{running && latestTask && <button type="button" onClick={() => void window.yibiao!.imageStudio.cancelTask({ taskId: latestTask.taskId }).catch((error) => showToast(String(error), 'error'))}>停止等待</button>}</div></div>
        <div className="image-studio-image-stage">{props.selectedWork ? <button type="button" title="放大当前作品" onClick={() => setViewer({ images: props.state.works.map((work) => ({ url: work.assetUrl, label: `作品 ${work.createdAt}` })), index: props.state.works.findIndex((work) => work.workId === props.selectedWork?.workId) })}><img src={props.selectedWork.assetUrl} alt="当前生成作品" /></button> : <div className="image-studio-empty"><Lightbulb size={30} /><span>作品将在这里显示</span></div>}</div>
        {props.newResult && <button type="button" className="image-studio-new-result" onClick={props.showLatest}>新结果已就绪，点击查看</button>}
        {latestTask && ['unknown', 'paused', 'failed', 'partial'].includes(latestTask.status) && <p className="image-studio-task-warning">{latestTask.status === 'unknown' ? '结果待确认，不会自动重新计费。' : latestTask.error || '任务未完整完成。'}</p>}
        <div className="image-studio-filmstrip">{props.state.works.slice(0, 12).map((work) => <button type="button" key={work.workId} className={work.workId === props.selectedWork?.workId ? 'active' : ''} onClick={() => props.selectWork(work.workId)} title={`查看作品 ${work.createdAt}`}><img src={work.assetUrl} alt="" loading="lazy" /></button>)}</div>
        <div className="image-studio-result-bar">
          <span>{props.selectedWork ? `${props.selectedWork.width} × ${props.selectedWork.height}` : ''}</span>
          <select aria-label="下载格式" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WEBP</option></select>
          <button type="button" disabled={!props.selectedWork} onClick={() => void exportWork()} title="下载图片"><Download size={16} /> 下载</button>
          <button ref={editTriggerRef} type="button" disabled={!props.selectedWork} onClick={() => {
            if (!selectedModel?.actions.includes('edit')) { showToast('当前模型未开放局部修改，请切换到支持的模型。', 'info'); return; }
            if (props.selectedWork) setEditingSource({ workId: props.selectedWork.workId, width: props.selectedWork.width, height: props.selectedWork.height });
          }} title="局部修改"><Paintbrush size={16} /> 局部修改</button>
          <button type="button" disabled={!props.selectedWork} onClick={() => setLayersOpen(true)} title="分层 PSD"><Layers3 size={16} /> 分层 PSD</button>
        </div>
      </section>
      <aside className="image-studio-inspector">
        <div className="image-studio-panel-head"><h2>当前图片信息</h2><Heart size={16} /></div>
        {props.selectedWork ? <><strong>本次生成提示词</strong><p className="image-studio-inspector-prompt">{props.selectedWork.prompt}</p><dl><dt>图片模型</dt><dd>{props.selectedWork.modelName}</dd><dt>输出尺寸</dt><dd>{props.selectedWork.width} × {props.selectedWork.height}</dd><dt>生成方式</dt><dd>{props.selectedWork.kind === 'edit' ? '局部修改' : props.selectedWork.kind === 'reference' ? '参考图生成' : '文生图'}</dd></dl><strong>版本记录</strong><p>{props.selectedWork.parentWorkId ? '由上一版本创作' : '初始作品'}</p></> : <p className="image-studio-muted">选择图片后显示详情。</p>}
      </aside>
    </div>
    {candidate?.kind === 'optimize' && <ImageStudioOptimizationDialog active={!caseOpen} modelName={candidate.modelName} status={candidate.cacheHit ? 'cached' : candidate.status} sourceStatus={candidate.sourceStatus} sentStatus={candidate.sentStatus} sources={candidate.sources} original={candidate.original} originalResultText={candidate.optimized} text={candidateText} setText={setCandidateText} mode={mode} completedMode={candidate.completedMode} setMode={setMode} canApply={applyAllowed} canSave={saveAllowed} applyReason={applyReason} onRestoreResult={() => { setCandidateText(candidate.optimized); persistOptimizationEdit(candidate.sessionId, candidate.optimized); }} onClose={closeCandidate} onStop={() => { if (optimizationRef.current) { optimizationRef.current.cancelled = true; void window.yibiao!.imageStudio.cancelOptimization(optimizationRef.current.requestId).catch((error) => showToast(String(error), 'error')); } }} onRetry={() => { persistOptimizationEdit(candidate.sessionId, candidateText); setCaseOpen(false); void optimize(candidate.status !== 'selecting'); }} onSave={() => void props.savePrompt(candidateText, 'optimize')} onApply={() => void applyOptimizedPrompt()} onCases={() => { if (candidate.sources.length) { setCaseEverOpened(true); setCaseOpen(true); } }} onEditBlur={() => persistOptimizationEdit(candidate.sessionId, candidateText)} hasReferences={props.references.length > 0} />}
    {candidate?.kind === 'optimize' && caseEverOpened && <ImageStudioCaseDialog active={caseOpen && !caseApply} sessionId={candidate.sessionId} cases={candidate.sources} sentStatus={candidate.sentStatus} initialSelected={caseSelected} onSelected={setCaseSelected} onClose={() => setCaseOpen(false)} onSave={(text, detail, language) => void props.savePrompt(text, 'optimization-case', { sourceId: detail.sourceId, itemId: detail.itemId, version: detail.contentHash, note: language === 'zh' ? '案例中文提示词' : '案例原文', coverUrl: detail.media[0] || '' })} onApply={(text, detail, language) => setCaseApply({ text, detail, language })} />}
    {caseApply && <div className="image-studio-overlay image-studio-overlay-top"><section ref={caseConfirmRef} className="image-studio-dialog" role="dialog" aria-modal="true" aria-label="确认应用案例" onKeyDown={caseConfirmKeyDown}><h2>确认应用案例提示词</h2><p>将当前{caseApply.language === 'zh' ? '案例中文提示词' : '案例原文'}替换创作输入，不会添加案例图片，也不会生成图片。</p><footer><button type="button" onClick={() => setCaseApply(null)}>取消</button><button type="button" className="image-studio-primary" onClick={() => void confirmCaseApply()}>确认替换</button></footer></section></div>}
    {candidate?.kind === 'invert' && <div className="image-studio-overlay" role="presentation"><section role="dialog" aria-modal="true" aria-label="图片反推提示词" className="image-studio-dialog"><div className="image-studio-panel-head"><h2>图片反推提示词</h2><button type="button" aria-label="关闭" onClick={() => closeCandidate()}>×</button></div><p className="image-studio-muted">根据图片生成参考描述，不代表原始提示词。</p><textarea value={candidateText} onChange={(event) => setCandidateText(event.target.value)} /><footer><button type="button" onClick={() => closeCandidate()}>取消</button><button type="button" disabled={!applyAllowed} onClick={() => void props.savePrompt(candidateText, 'invert')}>保存到我的提示词</button><button type="button" className="image-studio-primary" disabled={!applyAllowed} onClick={() => { props.applyPrompt(candidateText); closeCandidate(); }}>应用到输入框</button></footer></section></div>}    {modelHelp && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="模型选择说明" className="image-studio-dialog"><div className="image-studio-panel-head"><h2>模型选择说明</h2><button type="button" onClick={() => setModelHelp(false)}>×</button></div><div className="image-studio-model-comparison">{props.state.models.map((model) => <div key={model.key}><strong>{model.name}</strong><small>{model.key === 'banana2' ? '上一版生图模型' : model.requestModelId}</small><p>{model.key === 'sunburst' ? '高精度视觉画面生成。' : model.key === 'flare' ? '日常快速生图与迭代。' : model.key === 'banana_pro' ? '复杂图文、多图和品牌一致性。' : model.key === 'banana2' ? '日常配图与快速迭代。' : model.key === 'gpt2_1k' ? '价格便宜速度快。' : '通用图像生成与编辑。'}</p><small>{model.actions.includes('edit') ? '当前客户端支持局部修改' : '当前客户端未开放局部修改'}</small></div>)}</div><p>资料核实日期：2026-09-29。来源：<button type="button" onClick={() => void window.yibiao?.openExternal('https://developers.openai.com/api/docs/guides/image-generation')}>OpenAI</button>、<button type="button" onClick={() => void window.yibiao?.openExternal('https://ai.google.dev/gemini-api/docs/image-generation')}>Google</button>。</p><footer><button type="button" onClick={() => setModelHelp(false)}>返回创作</button></footer></section></div>}
    {viewer && <ImageStudioViewer images={viewer.images} initialIndex={viewer.index} onClose={() => setViewer(null)} />}
    {editingSource && <ImageStudioRegionEditor source={editingSource} onClose={() => { setEditingSource(null); requestAnimationFrame(() => editTriggerRef.current?.focus()); }} onComplete={(workId) => { props.selectWork(workId); showToast('局部修改完成，已显示新版本并保存到我的作品。', 'success'); }} onSubmit={props.edit} />}
    {layersOpen && props.selectedWork && <ImageStudioLayers source={{ workId: props.selectedWork.workId }} modelKey={props.modelKey} onClose={() => setLayersOpen(false)} />}
  </div>;
}
