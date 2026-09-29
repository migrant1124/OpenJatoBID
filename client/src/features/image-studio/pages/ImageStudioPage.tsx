import { useEffect, useRef, useState } from 'react';
import type { SectionId } from '../../../shared/types/navigation';
import type { ImageStudioStartInput, ImageStudioState, ImageStudioStyle, ImageStudioWork } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';
import { ImageStudioCreate, type StudioReference } from './ImageStudioCreate';
import { ImageStudioPrompts } from './ImageStudioPrompts';
import { ImageStudioWorks } from './ImageStudioWorks';
import type { StudioEditRegion } from './ImageStudioRegionEditor';

const sections: Array<{ id: SectionId; label: string }> = [
  { id: 'image-studio-create', label: 'AI 生图' },
  { id: 'image-studio-prompts', label: '提示词中心' },
  { id: 'image-studio-works', label: '我的作品' },
];

function ImageStudioPage({ section, onSectionChange }: { section: SectionId; onSectionChange: (section: SectionId) => void }) {
  const { showToast } = useToast();
  const [state, setState] = useState<ImageStudioState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [size, setSize] = useState('');
  const [modelKey, setModelKey] = useState('gpt2');
  const [references, setReferences] = useState<StudioReference[]>([]);
  const [parentWorkId, setParentWorkId] = useState<string | null>(null);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [newResult, setNewResult] = useState(false);
  const [appliedPrompt, setAppliedPrompt] = useState<{ before: string; after: string } | null>(null);
  const [appliedStyle, setAppliedStyle] = useState<{ styleId: string; version: string; body: string; before?: string; after: string } | null>(null);
  const [conflictDraft, setConflictDraft] = useState<ImageStudioState['draft'] | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const revisionRef = useRef(0);
  const lastSavedRef = useRef('');
  const saveQueueRef = useRef(Promise.resolve());
  const readyRef = useRef(false);
  const manuallySelectedRef = useRef(false);
  const conflictRef = useRef(false);
  const startLockRef = useRef(false);
  const view = section === 'image-studio-prompts' ? 'prompts' : section === 'image-studio-works' ? 'works' : 'create';

  async function refresh() { setState(await window.yibiao!.imageStudio.getState()); }

  useEffect(() => {
    let live = true;
    void window.yibiao!.imageStudio.getState().then((loaded) => {
      if (!live) return;
      setState(loaded);
      setPrompt(loaded.draft.prompt);
      const saved = loaded.draft.state || {};
      setCount([1, 2, 4].includes(Number(saved.count)) ? Number(saved.count) : 1);
      setSize(typeof saved.size === 'string' ? saved.size : loaded.imageModel.size || '1024x1024');
      setModelKey(loaded.selectedModelKey);
      setReferences(Array.isArray(saved.references) ? saved.references as StudioReference[] : []);
      setParentWorkId(typeof saved.parentWorkId === 'string' ? saved.parentWorkId : null);
      setAppliedStyle(saved.appliedStyle && typeof saved.appliedStyle === 'object' ? saved.appliedStyle as typeof appliedStyle : null);
      revisionRef.current = loaded.draft.revision;
      lastSavedRef.current = JSON.stringify({ prompt: loaded.draft.prompt,
        count: saved.count || 1, size: saved.size || loaded.imageModel.size || '1024x1024', modelKey: loaded.selectedModelKey,
        references: saved.references || [], parentWorkId: saved.parentWorkId || null, appliedStyle: saved.appliedStyle || null });
      readyRef.current = true;
    }).catch((error) => showToast(String(error), 'error'));
    const unsubscribe = window.yibiao!.imageStudio.onEvent((event) => {
      setState((current) => {
        if (!current) return current;
        if (manuallySelectedRef.current && event.works[0]?.workId !== current.works[0]?.workId) setNewResult(true);
        return { ...current, tasks: event.tasks, works: event.works };
      });
    });
    return () => { live = false; unsubscribe(); };
  }, [showToast]);

  useEffect(() => {
    if (!readyRef.current || conflictRef.current) return;
    const value = JSON.stringify({ prompt, count, size, modelKey, references, parentWorkId, appliedStyle });
    if (value === lastSavedRef.current) return;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (conflictRef.current || value === lastSavedRef.current) return;
      const data = JSON.parse(value) as { prompt: string; count: number; size: string; modelKey: string; references: StudioReference[]; parentWorkId: string | null; appliedStyle: typeof appliedStyle };
      const result = await window.yibiao!.imageStudio.saveDraft({ prompt: data.prompt, revision: revisionRef.current,
        state: { count: data.count, size: data.size, modelKey: data.modelKey, references: data.references, parentWorkId: data.parentWorkId, appliedStyle: data.appliedStyle } });
      if (result.conflict) {
        conflictRef.current = true;
        setConflictDraft(result.draft);
        return;
      }
      revisionRef.current = result.draft.revision;
      lastSavedRef.current = value;
    }).catch((error) => { showToast(`保存草稿失败：${String(error)}`, 'error'); });
  }, [prompt, count, size, modelKey, references, parentWorkId, appliedStyle, showToast]);

  const selectedWork = state?.works.find((work) => work.workId === selectedWorkId) || state?.works[0] || null;

  async function start(regions?: StudioEditRegion[], sourceWorkId?: string, sourceSha256?: string, requestId?: string): Promise<string | void> {
    if (startLockRef.current) return;
    startLockRef.current = true;
    setStartBusy(true);
    try {
      const editWork = regions ? state?.works.find((work) => work.workId === sourceWorkId) : null;
      if (regions && !editWork) throw new Error('原图已不存在，请重新打开局部修改。');
      const submittedReferences = editWork ? [{ workId: editWork.workId, role: '主体' }] : references;
      const requestSize = editWork ? `${editWork.width}x${editWork.height}` : size;
      const [width, height] = requestSize.split('x').map(Number);
      const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
      const divisor = gcd(width, height) || 1;
      const input: ImageStudioStartInput = { prompt: regions ? regions.map((region) => region.prompt).join('；') : prompt, count: regions ? 1 : count, size: requestSize,
        ratio: `${width / divisor}:${height / divisor}`, references: submittedReferences,
        kind: regions ? 'edit' : undefined, regions, requestId: requestId || crypto.randomUUID(), modelKey,
        expectedSourceSha256: regions ? sourceSha256 : undefined,
        parentWorkId: editWork?.workId || parentWorkId || undefined };
      const result = await window.yibiao!.imageStudio.start(input);
      showToast('已提交生图任务', 'success');
      return result.taskId;
    } catch (error) { showToast(String(error), 'error'); if (regions) throw error; }
    finally { startLockRef.current = false; setStartBusy(false); }
  }

  async function savePrompt(text: string, originKind = 'manual') {
    if (!text.trim()) return;
    try {
      await window.yibiao!.imageStudio.saveMyPrompt({ title: text.trim().slice(0, 24), contentMarkdown: text, originKind });
      showToast('已保存到我的提示词', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  function applyPrompt(text: string) {
    setAppliedPrompt({ before: prompt, after: text });
    setAppliedStyle(null);
    setPrompt(text);
    onSectionChange('image-studio-create');
    showToast('已应用到创作输入', 'success');
  }
  function undoAppliedPrompt() {
    if (!appliedPrompt || prompt !== appliedPrompt.after) return;
    setPrompt(appliedPrompt.before);
    setAppliedPrompt(null);
    setAppliedStyle(null);
  }
  function undoAppliedStyle() {
    if (!appliedStyle || typeof appliedStyle.before !== 'string' || !prompt.startsWith(appliedStyle.after)) return;
    setPrompt(appliedStyle.before + prompt.slice(appliedStyle.after.length));
    setAppliedPrompt(null);
    setAppliedStyle(null);
  }
  function applyStyle(style: ImageStudioStyle) {
    if (prompt.includes(style.body.trim())) { showToast('该风格已应用', 'info'); return; }
    const after = `${prompt.trim()}\n${style.body.trim()}`.trim();
    setAppliedPrompt({ before: prompt, after });
    setAppliedStyle({ styleId: style.styleId, version: style.updatedAt, body: style.body.trim(), before: prompt, after });
    setPrompt(after);
    onSectionChange('image-studio-create');
    showToast('已应用风格，可撤销', 'success');
  }
  async function resolveDraftConflict(useCurrent: boolean) {
    if (!conflictDraft) return;
    if (useCurrent) {
      try {
        const value = JSON.stringify({ prompt, count, size, modelKey, references, parentWorkId, appliedStyle });
        const result = await window.yibiao!.imageStudio.saveDraft({ prompt, revision: conflictDraft.revision,
          state: { count, size, modelKey, references, parentWorkId, appliedStyle } });
        if (result.conflict) { setConflictDraft(result.draft); return; }
        revisionRef.current = result.draft.revision;
        lastSavedRef.current = value;
      } catch (error) { showToast(String(error), 'error'); return; }
    } else {
      const saved = conflictDraft.state || {};
      setPrompt(conflictDraft.prompt);
      setCount([1, 2, 4].includes(Number(saved.count)) ? Number(saved.count) : 1);
      setSize(typeof saved.size === 'string' ? saved.size : state?.imageModel.size || '1024x1024');
      setModelKey(typeof saved.modelKey === 'string' ? saved.modelKey : state?.selectedModelKey || 'gpt2');
      setReferences(Array.isArray(saved.references) ? saved.references as StudioReference[] : []);
      setParentWorkId(typeof saved.parentWorkId === 'string' ? saved.parentWorkId : null);
      setAppliedStyle(saved.appliedStyle && typeof saved.appliedStyle === 'object' ? saved.appliedStyle as typeof appliedStyle : null);
      revisionRef.current = conflictDraft.revision;
      lastSavedRef.current = JSON.stringify({ prompt: conflictDraft.prompt,
        count: saved.count || 1, size: saved.size || state?.imageModel.size || '1024x1024', modelKey: saved.modelKey || state?.selectedModelKey || 'gpt2',
        references: saved.references || [], parentWorkId: saved.parentWorkId || null, appliedStyle: saved.appliedStyle || null });
    }
    conflictRef.current = false;
    setConflictDraft(null);
  }
  function openWork(work: ImageStudioWork) { setSelectedWorkId(work.workId); manuallySelectedRef.current = true; onSectionChange('image-studio-create'); }
  function continueWork(work: ImageStudioWork) {
    setPrompt(work.prompt); setParentWorkId(work.workId);
    if (work.generation.size) setSize(work.generation.size);
    setReferences([{ workId: work.workId, assetUrl: work.assetUrl, role: '主体' }]);
    openWork(work);
  }

  return <div className="image-studio-page">
    <header className="image-studio-head"><div><h1>生图模式</h1><p>从想法到图片，简单创作与修改</p></div><nav aria-label="生图模式页面" className="image-studio-tabs">{sections.map((item) => <button key={item.id} type="button" aria-current={(section === item.id || (section === 'image-studio' && item.id === 'image-studio-create')) ? 'page' : undefined} onClick={() => onSectionChange(item.id)}>{item.label}</button>)}</nav></header>
    {!state && <div className="image-studio-empty">正在读取生图工作区…</div>}
    {state && view === 'create' && <ImageStudioCreate state={state} prompt={prompt} setPrompt={setPrompt} applyPrompt={applyPrompt} undoAppliedPrompt={undoAppliedPrompt} canUndoAppliedPrompt={Boolean(appliedPrompt && prompt === appliedPrompt.after)} count={count} setCount={setCount} size={size} setSize={setSize} modelKey={modelKey} setModelKey={setModelKey} references={references} setReferences={setReferences} selectedWork={selectedWork} selectWork={(id) => { setSelectedWorkId(id); manuallySelectedRef.current = true; }} newResult={newResult} showLatest={() => { setSelectedWorkId(null); manuallySelectedRef.current = false; setNewResult(false); }} start={() => start()} edit={(regions, sourceWorkId, sourceSha256, requestId) => start(regions, sourceWorkId, sourceSha256, requestId)} savePrompt={savePrompt} startBusy={startBusy} refresh={refresh} />}
    {state && view === 'prompts' && <ImageStudioPrompts applyPrompt={applyPrompt} applyStyle={applyStyle} undoStyle={undoAppliedStyle}
      canUndoStyle={Boolean(appliedStyle && typeof appliedStyle.before === 'string' && prompt.startsWith(appliedStyle.after))} appliedStyleId={appliedStyle?.styleId || ''} currentPrompt={prompt} />}
    {state && view === 'works' && <ImageStudioWorks works={state.works} refresh={refresh} openWork={openWork} continueWork={continueWork} />}
    {conflictDraft && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="草稿冲突" className="image-studio-dialog"><h2>草稿有新版本</h2><p>当前输入和已保存草稿都已保留。请选择要继续使用的一份。</p><div className="image-studio-compare"><div><strong>当前输入</strong><p>{prompt}</p></div><div><strong>已保存草稿</strong><p>{conflictDraft.prompt}</p></div></div><footer><button type="button" onClick={() => void resolveDraftConflict(false)}>载入已存草稿</button><button type="button" className="image-studio-primary" onClick={() => void resolveDraftConflict(true)}>保留当前输入</button></footer></section></div>}
  </div>;
}

export default ImageStudioPage;
