import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptGroup, PromptImportItem, PromptItem } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

function api() {
  if (!window.yibiao?.promptLibrary) throw new Error('提示词服务尚未就绪，请稍后重试。');
  return window.yibiao.promptLibrary;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || '操作失败'))
    .replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function PromptLibraryDialog({ open, onOpenChange, onInsert }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (content: string) => void;
}) {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupIcon, setGroupIcon] = useState('blue');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<PromptImportItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pick<PromptItem, 'promptId' | 'title'> | null>(null);
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef({ promptId: '', title: '', content: '' });
  const savedRef = useRef({ promptId: '', title: '', content: '' });
  draftRef.current = { promptId: selectedPromptId, title, content };

  const selectPromptDraft = useCallback((prompt: PromptItem | undefined) => {
    const next = prompt || { promptId: '', title: '', contentMarkdown: '' };
    setSelectedPromptId(next.promptId);
    setSelectedGroupId((current) => prompt?.groupId || current);
    setTitle(next.title);
    setContent(next.contentMarkdown);
    setPast([]);
    setFuture([]);
    setSaveStatus('saved');
    savedRef.current = { promptId: next.promptId, title: next.title, content: next.contentMarkdown };
  }, []);

  const loadLibrary = useCallback(async (preferredPromptId = '', preferredGroupId = '') => {
    const [nextGroups, nextPrompts] = await Promise.all([api().listGroups(), api().listPrompts({ query })]);
    setGroups(nextGroups);
    setPrompts(nextPrompts);
    const nextGroupId = preferredGroupId || selectedGroupId || nextGroups[0]?.groupId || '';
    setSelectedGroupId(nextGroupId);
    selectPromptDraft(nextPrompts.find((item) => item.promptId === preferredPromptId)
      || nextPrompts.find((item) => item.groupId === nextGroupId)
      || nextPrompts[0]);
  }, [query, selectPromptDraft, selectedGroupId]);

  const saveCurrent = useCallback(() => {
    const draft = draftRef.current;
    if (!draft.promptId) return Promise.resolve(true);
    if (draft.promptId === savedRef.current.promptId && draft.title === savedRef.current.title && draft.content === savedRef.current.content) return Promise.resolve(true);
    const task = saveChainRef.current.catch(() => undefined).then(async () => {
      setSaveStatus('saving');
      try {
        const saved = await api().updatePrompt({ promptId: draft.promptId, title: draft.title, contentMarkdown: draft.content });
        if (draftRef.current.promptId === draft.promptId && draftRef.current.title === draft.title && draftRef.current.content === draft.content) {
          savedRef.current = { promptId: saved.promptId, title: saved.title, content: saved.contentMarkdown };
          setSaveStatus('saved');
          setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        }
        setPrompts((items) => items.map((item) => item.promptId === saved.promptId ? saved : item));
        return true;
      } catch {
        setSaveStatus('error');
        showToast('提示词保存失败，请重试', 'error');
        return false;
      }
    });
    saveChainRef.current = task.then(() => undefined);
    return task;
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    void loadLibrary().catch((error) => showToast(errorMessage(error), 'error'));
  }, [open]);

  useEffect(() => {
    if (!open || !selectedPromptId) return;
    const saved = savedRef.current;
    if (saved.promptId === selectedPromptId && saved.title === title && saved.content === content) return;
    setSaveStatus('dirty');
    const timer = window.setTimeout(() => { void saveCurrent(); }, 800);
    return () => window.clearTimeout(timer);
  }, [content, open, saveCurrent, selectedPromptId, title]);

  useEffect(() => {
    if (!open) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [open]);

  const choosePrompt = async (prompt: PromptItem) => {
    if (prompt.promptId === selectedPromptId || !(await saveCurrent())) return;
    selectPromptDraft(prompt);
  };

  const chooseGroup = async (groupId: string) => {
    if (!(await saveCurrent())) return;
    setSelectedGroupId(groupId);
    selectPromptDraft(prompts.find((item) => item.groupId === groupId));
  };

  const closeLibrary = async () => {
    if (importing || inserting) { showToast('正在处理提示词，请稍候。', 'info'); return; }
    if (!(await saveCurrent())) return;
    onOpenChange(false);
  };

  const createGroup = async () => {
    try {
      const group = await api().createGroup({ groupName, description: groupDescription, iconKey: groupIcon });
      setGroups((items) => [...items, group]);
      setSelectedGroupId(group.groupId);
      selectPromptDraft(undefined);
      setGroupName(''); setGroupDescription(''); setGroupIcon('blue'); setCreateGroupOpen(false);
      showToast('分组创建成功', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const deleteGroup = async (group: PromptGroup) => {
    try {
      await api().deleteGroup({ groupId: group.groupId });
      await loadLibrary('', groups.find((item) => item.groupId !== group.groupId)?.groupId);
      showToast('分组已删除', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const createPrompt = async () => {
    if (!selectedGroupId || !(await saveCurrent())) return;
    try {
      const prompt = await api().createPrompt({ groupId: selectedGroupId });
      setPrompts((items) => [prompt, ...items]);
      setGroups((items) => items.map((group) => group.groupId === selectedGroupId ? { ...group, promptCount: group.promptCount + 1 } : group));
      selectPromptDraft(prompt);
      window.setTimeout(() => editorRef.current?.focus(), 0);
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const removePrompt = async () => {
    if (!deleteTarget) return;
    try {
      await api().deletePrompt({ promptId: deleteTarget.promptId });
      setDeleteTarget(null);
      await loadLibrary('', selectedGroupId);
      showToast('提示词已删除', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const importSingle = async () => {
    if (!selectedGroupId || importing) return;
    setImporting(true);
    try {
      const result = await api().importSingle({ groupId: selectedGroupId });
      if (result.prompt) { await loadLibrary(result.prompt.promptId, selectedGroupId); showToast('提示词导入成功', 'success'); }
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setImporting(false); }
  };

  const prepareBatch = async () => {
    if (!selectedGroupId || importing) return;
    setImporting(true);
    try {
      const result = await api().prepareBatchImport({ groupId: selectedGroupId });
      if (!result.canceled) { setBatchItems(result.items); setBatchOpen(true); }
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setImporting(false); }
  };

  const commitBatch = async () => {
    const ready = batchItems.filter((item) => item.status === 'ready');
    if (!ready.length) return;
    setImporting(true);
    try {
      const result = await api().commitBatchImport({ items: ready.map(({ importId, title: itemTitle, groupId }) => ({ importId, title: itemTitle, groupId })) });
      showToast(result.failedCount ? `批量导入已完成，${result.failedCount} 条失败` : `成功导入 ${result.successCount} 条提示词`, result.failedCount ? 'info' : 'success');
      setBatchOpen(false); setBatchItems([]); await loadLibrary('', selectedGroupId);
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setImporting(false); }
  };

  const updateContent = (value: string) => {
    setPast((items) => [...items.slice(-99), content]);
    setFuture([]);
    setContent(value);
  };

  const undo = () => {
    const previous = past[past.length - 1];
    if (previous === undefined) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [content, ...items].slice(0, 100));
    setContent(previous);
  };

  const redo = () => {
    const next = future[0];
    if (next === undefined) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-99), content]);
    setContent(next);
  };

  const statusText = saveStatus === 'saving' ? '正在保存...' : saveStatus === 'error' ? '保存失败' : saveStatus === 'dirty' ? '等待保存' : lastSavedAt ? `最后保存于 ${lastSavedAt}` : '已保存';
  const insertDisabled = !selectedPromptId || !content.trim() || importing || inserting;

  return <>
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) void closeLibrary(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="prompt-library-overlay" />
        <Dialog.Content className="prompt-library-dialog" onEscapeKeyDown={(event) => { event.preventDefault(); void closeLibrary(); }} onPointerDownOutside={(event) => event.preventDefault()}>
          <header className="prompt-library-header"><div><Dialog.Title>提示词仓库</Dialog.Title><Dialog.Description className="sr-only">管理、导入和编辑提示词，并将提示词插入当前对话输入框。</Dialog.Description></div><button type="button" aria-label="关闭提示词仓库" onClick={() => void closeLibrary()}>×</button></header>
          <div className="prompt-library-body">
            <aside className="prompt-library-sidebar">
              <input ref={searchRef} value={query} onChange={(event) => { const value = event.target.value; queryRef.current = value; setQuery(value); void api().listPrompts({ query: value }).then((items) => { if (queryRef.current === value) setPrompts(items); }); }} placeholder="搜索提示词（Ctrl + /）" aria-label="搜索提示词" />
              <button className="prompt-outline-button" type="button" onClick={() => setCreateGroupOpen(true)}>＋ 新建分组</button>
              <details className="prompt-import-menu"><summary>⌘ 导入提示词</summary><div><button type="button" onClick={() => void importSingle()}>单个导入</button><button type="button" onClick={() => void prepareBatch()}>批量导入</button></div></details>
              <div className="prompt-group-list">{groups.map((group) => <section key={group.groupId} className={group.groupId === selectedGroupId ? 'is-active' : ''}>
                <div><button type="button" onClick={() => void chooseGroup(group.groupId)}><i className={`prompt-folder is-${group.iconKey}`} />{group.groupName}<span>{group.promptCount}</span></button>{!group.isSystem && <button type="button" aria-label={`删除分组 ${group.groupName}`} onClick={() => void deleteGroup(group)}>×</button>}</div>
                {(group.groupId === selectedGroupId || Boolean(query.trim())) && <div className="prompt-item-list">{prompts.filter((prompt) => prompt.groupId === group.groupId).map((prompt) => <button type="button" key={prompt.promptId} className={prompt.promptId === selectedPromptId ? 'is-active' : ''} onClick={() => void choosePrompt(prompt)}>{prompt.title}</button>)}</div>}
              </section>)}</div>
              <button className="prompt-new-button" type="button" onClick={() => void createPrompt()}>＋ 新建提示词</button>
            </aside>
            <section className="prompt-library-editor">
              {selectedPromptId ? <>
                <div className="prompt-editor-title"><input value={title} maxLength={100} disabled={inserting} aria-label="提示词标题" onChange={(event) => setTitle(event.target.value)} /><button type="button" title="删除提示词" disabled={inserting} onClick={() => setDeleteTarget({ promptId: selectedPromptId, title: title.trim() || '未命名提示词' })}>•••</button></div>
                <div className="prompt-editor-toolbar"><span>{groups.find((group) => group.groupId === selectedGroupId)?.groupName}</span><button type="button" disabled={!past.length} onClick={undo}>↶ 撤销</button><button type="button" disabled={!future.length} onClick={redo}>↷ 重做</button></div>
                <textarea ref={editorRef} value={content} disabled={inserting} aria-label="提示词内容" placeholder="输入提示词内容，支持 Markdown" onChange={(event) => updateContent(event.target.value)} onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
                }} />
                <footer className={`prompt-save-status is-${saveStatus}`}><span>{statusText}</span><span>共 {Array.from(content).length} 字</span></footer>
              </> : <div className="prompt-library-empty"><strong>暂无提示词</strong><span>新建或导入提示词后即可在这里编辑。</span></div>}
            </section>
          </div>
          <footer className="prompt-library-actions"><button type="button" className="secondary-action" disabled={inserting} onClick={() => void closeLibrary()}>关闭</button><button type="button" className="primary-action" disabled={insertDisabled} title={insertDisabled ? (!selectedPromptId ? '请先选择提示词' : !content.trim() ? '提示词内容为空，无法插入' : '正在处理提示词') : ''} onClick={() => void (async () => { const draft = { ...draftRef.current }; setInserting(true); try { if (await saveCurrent()) { onInsert(draft.content); onOpenChange(false); showToast('已插入输入框', 'success'); } } finally { setInserting(false); } })()}>插入到输入框</button></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <Dialog.Root open={createGroupOpen} onOpenChange={setCreateGroupOpen}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-subdialog"><Dialog.Title>新建分组</Dialog.Title><Dialog.Description className="sr-only">填写分组名称、描述并选择文件夹颜色。</Dialog.Description><label>分组名称 <em>*</em><input value={groupName} maxLength={30} onChange={(event) => setGroupName(event.target.value)} placeholder="请输入分组名称，最多 30 个字符" /><small>{Array.from(groupName).length}/30</small></label><label>分组描述<textarea value={groupDescription} maxLength={100} onChange={(event) => setGroupDescription(event.target.value)} placeholder="请输入分组描述（可选）" /><small>{Array.from(groupDescription).length}/100</small></label><fieldset><legend>分组图标</legend>{['blue', 'yellow', 'green', 'purple', 'red', 'cyan'].map((color) => <button type="button" aria-label={`${color} 文件夹`} className={groupIcon === color ? 'is-active' : ''} key={color} onClick={() => setGroupIcon(color)}><i className={`prompt-folder is-${color}`} /></button>)}</fieldset><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="primary-action" disabled={!groupName.trim()} onClick={() => void createGroup()}>创建</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={batchOpen} onOpenChange={(next) => { if (!importing) setBatchOpen(next); }}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-import-dialog"><header><div><Dialog.Title>导入提示词</Dialog.Title><Dialog.Description>支持批量导入提示词，每个文档内容为一个独立提示词。</Dialog.Description></div><Dialog.Close aria-label="关闭">×</Dialog.Close></header><div className="prompt-import-summary">已选择 {batchItems.length} 个文件（.md、.txt、.docx）</div><div className="prompt-import-table"><div className="prompt-import-row is-head"><span>文件名 / 标题</span><span>预览内容（前 100 字符）</span><span>分组</span><span>状态</span><span>操作</span></div>{batchItems.map((item) => <div className="prompt-import-row" key={item.importId}><input value={item.title} disabled={item.status === 'error'} onChange={(event) => setBatchItems((items) => items.map((entry) => entry.importId === item.importId ? { ...entry, title: event.target.value } : entry))} title={item.fileName} /><span title={item.error || item.preview}>{item.error || item.preview}</span><select value={item.groupId} disabled={item.status === 'error'} onChange={(event) => setBatchItems((items) => items.map((entry) => entry.importId === item.importId ? { ...entry, groupId: event.target.value } : entry))}>{groups.map((group) => <option key={group.groupId} value={group.groupId}>{group.groupName}</option>)}</select><span className={item.status === 'error' ? 'is-error' : 'is-ready'}>{item.status === 'error' ? '解析失败' : '待导入'}</span><button type="button" onClick={() => setBatchItems((items) => items.filter((entry) => entry.importId !== item.importId))}>移除</button></div>)}</div><footer><Dialog.Close className="secondary-action" disabled={importing}>取消</Dialog.Close><button type="button" className="primary-action" disabled={importing || !batchItems.some((item) => item.status === 'ready')} onClick={() => void commitBatch()}>{importing ? '正在导入…' : '开始导入'}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(next) => !next && setDeleteTarget(null)}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-delete-dialog"><Dialog.Title>删除提示词</Dialog.Title><Dialog.Description>删除“{deleteTarget?.title}”后将不再显示，是否继续？</Dialog.Description><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="danger-action" onClick={() => void removePrompt()}>删除</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
