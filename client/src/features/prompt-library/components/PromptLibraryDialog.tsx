import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptGroup, PromptImportItem, PromptItem } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
const FAVORITES_GROUP_ID = 'prompt-group-favorites';
const UNGROUPED_GROUP_ID = 'prompt-group-ungrouped';

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
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{ groupId: string; groupName: string; favoriteOnly?: boolean } | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const [batchDeleteMode, setBatchDeleteMode] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set());
  const [selectedPromptIds, setSelectedPromptIds] = useState<Set<string>>(() => new Set());
  const [selectedFavoritePromptIds, setSelectedFavoritePromptIds] = useState<Set<string>>(() => new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef({ promptId: '', title: '', content: '' });
  const savedRef = useRef({ promptId: '', title: '', content: '' });
  draftRef.current = { promptId: selectedPromptId, title, content };

  const selectPromptDraft = useCallback((prompt: PromptItem | undefined, viewGroupId = '') => {
    const next = prompt || { promptId: '', title: '', contentMarkdown: '' };
    setSelectedPromptId(next.promptId);
    setSelectedGroupId((current) => viewGroupId || prompt?.groupId || current);
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
    const hasFavorites = nextPrompts.some((item) => item.isFavorite);
    const hasUngrouped = nextPrompts.some((item) => item.groupId === UNGROUPED_GROUP_ID);
    const availableGroupIds = new Set([
      ...nextGroups.map((group) => group.groupId),
      ...(hasFavorites ? [FAVORITES_GROUP_ID] : []),
      ...(hasUngrouped ? [UNGROUPED_GROUP_ID] : []),
    ]);
    const requestedGroupId = preferredGroupId || selectedGroupId;
    const nextGroupId = availableGroupIds.has(requestedGroupId) ? requestedGroupId : nextGroups[0]?.groupId || (hasFavorites ? FAVORITES_GROUP_ID : hasUngrouped ? UNGROUPED_GROUP_ID : '');
    setSelectedGroupId(nextGroupId);
    if (nextGroupId) setExpandedGroupIds((items) => new Set(items).add(nextGroupId));
    const promptsInGroup = nextGroupId === FAVORITES_GROUP_ID
      ? nextPrompts.filter((item) => item.isFavorite)
      : nextPrompts.filter((item) => item.groupId === nextGroupId);
    selectPromptDraft(nextPrompts.find((item) => item.promptId === preferredPromptId)
      || promptsInGroup[0], nextGroupId);
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

  const choosePrompt = async (prompt: PromptItem, viewGroupId = prompt.groupId) => {
    if ((prompt.promptId === selectedPromptId && viewGroupId === selectedGroupId) || !(await saveCurrent())) return;
    selectPromptDraft(prompt, viewGroupId);
  };

  const chooseGroup = async (groupId: string) => {
    if (!(await saveCurrent())) return;
    setExpandedGroupIds((items) => {
      const next = new Set(items);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
    setSelectedGroupId(groupId);
    const nextPrompt = groupId === FAVORITES_GROUP_ID
      ? prompts.find((item) => item.isFavorite)
      : prompts.find((item) => item.groupId === groupId);
    selectPromptDraft(nextPrompt, groupId);
  };

  const closeLibrary = async () => {
    if (importing || inserting) { showToast('正在处理提示词，请稍候。', 'info'); return; }
    if (!(await saveCurrent())) return;
    onOpenChange(false);
  };

  const createGroup = async () => {
    if (!(await saveCurrent())) return;
    try {
      const group = await api().createGroup({ groupName, description: groupDescription, iconKey: groupIcon });
      setGroups((items) => [...items, group]);
      setSelectedGroupId(group.groupId);
      setExpandedGroupIds((items) => new Set(items).add(group.groupId));
      selectPromptDraft(undefined, group.groupId);
      setGroupName(''); setGroupDescription(''); setGroupIcon('blue'); setCreateGroupOpen(false);
      showToast('分组创建成功', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const deleteGroup = async (group: PromptGroup) => {
    setDeleteGroupTarget({ groupId: group.groupId, groupName: group.groupName });
  };

  const createPrompt = async () => {
    if (!selectedGroupId || !(await saveCurrent())) return;
    try {
      const favorite = selectedGroupId === FAVORITES_GROUP_ID;
      const prompt = await api().createPrompt({ groupId: favorite ? UNGROUPED_GROUP_ID : selectedGroupId, isFavorite: favorite });
      setPrompts((items) => [prompt, ...items]);
      setGroups((items) => items.map((group) => group.groupId === selectedGroupId ? { ...group, promptCount: group.promptCount + 1 } : group));
      setExpandedGroupIds((items) => new Set(items).add(selectedGroupId));
      selectPromptDraft(prompt, selectedGroupId);
      window.setTimeout(() => editorRef.current?.focus(), 0);
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const removePrompt = async () => {
    if (!deleteTarget || !(await saveCurrent())) return;
    try {
      const preferredPromptId = deleteTarget.promptId === selectedPromptId ? '' : selectedPromptId;
      await api().deletePrompt({ promptId: deleteTarget.promptId });
      setDeleteTarget(null);
      await loadLibrary(preferredPromptId, selectedGroupId);
      showToast('提示词已删除', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const toggleFavorite = async (prompt: PromptItem) => {
    if (!(await saveCurrent())) return;
    try {
      const saved = await api().setFavorite({ promptId: prompt.promptId, isFavorite: !prompt.isFavorite });
      setPrompts((items) => items.map((item) => item.promptId === saved.promptId ? saved : item));
      if (prompt.isFavorite && selectedGroupId === FAVORITES_GROUP_ID) await loadLibrary('', prompt.groupId);
      else if (!prompt.isFavorite) setExpandedGroupIds((items) => new Set(items).add(FAVORITES_GROUP_ID));
      showToast(prompt.isFavorite ? '已取消常用标记' : '已标记为常用', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroupTarget || !(await saveCurrent())) return;
    setDeleting(true);
    try {
      if (deleteGroupTarget.favoriteOnly) {
        const allPrompts = await api().listPrompts();
        await api().batchDelete({ groupIds: [], promptIds: [], favoritePromptIds: allPrompts.filter((item) => item.isFavorite).map((item) => item.promptId) });
      } else {
        await api().deleteGroup({ groupId: deleteGroupTarget.groupId });
      }
      setDeleteGroupTarget(null);
      await loadLibrary();
      showToast('分组已删除', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setDeleting(false); }
  };

  const resetBatchDelete = () => {
    setBatchDeleteMode(false);
    setSelectedGroupIds(new Set());
    setSelectedPromptIds(new Set());
    setSelectedFavoritePromptIds(new Set());
    setBatchDeleteConfirmOpen(false);
  };

  const startBatchDelete = async () => {
    try {
      if (query) {
        queryRef.current = '';
        setQuery('');
        setPrompts(await api().listPrompts());
      }
      setBatchDeleteMode(true);
    } catch (error) { showToast(errorMessage(error), 'error'); }
  };

  const toggleGroupSelection = (groupId: string, checked: boolean) => {
    const groupPromptIds = (groupId === FAVORITES_GROUP_ID
      ? prompts.filter((item) => item.isFavorite)
      : prompts.filter((item) => item.groupId === groupId)).map((item) => item.promptId);
    if (groupId === FAVORITES_GROUP_ID) {
      setSelectedFavoritePromptIds((items) => {
        const next = new Set(items);
        groupPromptIds.forEach((promptId) => checked ? next.add(promptId) : next.delete(promptId));
        return next;
      });
      return;
    }
    setSelectedGroupIds((items) => { const next = new Set(items); if (checked) next.add(groupId); else next.delete(groupId); return next; });
    setSelectedPromptIds((items) => {
      const next = new Set(items);
      groupPromptIds.forEach((promptId) => checked ? next.add(promptId) : next.delete(promptId));
      return next;
    });
  };

  const confirmBatchDelete = async () => {
    if (!(await saveCurrent())) return;
    setDeleting(true);
    try {
      await api().batchDelete({ groupIds: [...selectedGroupIds], promptIds: [...selectedPromptIds], favoritePromptIds: [...selectedFavoritePromptIds] });
      resetBatchDelete();
      await loadLibrary();
      showToast('批量删除完成', 'success');
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setDeleting(false); }
  };

  const importSingle = async () => {
    if (!selectedGroupId || importing || !(await saveCurrent())) return;
    setImporting(true);
    try {
      const favorite = selectedGroupId === FAVORITES_GROUP_ID;
      const result = await api().importSingle({ groupId: favorite ? UNGROUPED_GROUP_ID : selectedGroupId });
      if (result.prompt) {
        if (favorite) await api().setFavorite({ promptId: result.prompt.promptId, isFavorite: true });
        await loadLibrary(result.prompt.promptId, selectedGroupId);
        showToast('提示词导入成功', 'success');
      }
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setImporting(false); }
  };

  const prepareBatch = async () => {
    if (!selectedGroupId || importing || !(await saveCurrent())) return;
    setImporting(true);
    try {
      const result = await api().prepareBatchImport({ groupId: selectedGroupId === FAVORITES_GROUP_ID ? UNGROUPED_GROUP_ID : selectedGroupId });
      if (!result.canceled) { setBatchItems(result.items); setBatchOpen(true); }
    } catch (error) { showToast(errorMessage(error), 'error'); } finally { setImporting(false); }
  };

  const commitBatch = async () => {
    const ready = batchItems.filter((item) => item.status === 'ready');
    if (!ready.length || !(await saveCurrent())) return;
    setImporting(true);
    try {
      const result = await api().commitBatchImport({ items: ready.map(({ importId, title: itemTitle, groupId }) => ({ importId, title: itemTitle, groupId, isFavorite: selectedGroupId === FAVORITES_GROUP_ID })) });
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

  const favoritePrompts = prompts.filter((prompt) => prompt.isFavorite);
  const ungroupedPrompts = prompts.filter((prompt) => prompt.groupId === UNGROUPED_GROUP_ID);
  const batchSelectionCount = selectedGroupIds.size + selectedPromptIds.size + selectedFavoritePromptIds.size;
  const selectedGroupName = selectedGroupId === FAVORITES_GROUP_ID ? '常用提示词'
    : selectedGroupId === UNGROUPED_GROUP_ID ? '未分组'
      : groups.find((group) => group.groupId === selectedGroupId)?.groupName || '';

  const closeRowMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
  };

  const renderPromptRow = (prompt: PromptItem, viewGroupId: string) => {
    const favoriteReference = viewGroupId === FAVORITES_GROUP_ID;
    const selected = favoriteReference ? selectedFavoritePromptIds.has(prompt.promptId) : selectedPromptIds.has(prompt.promptId);
    return <div className={`prompt-item-row${prompt.promptId === selectedPromptId && viewGroupId === selectedGroupId ? ' is-active' : ''}`} key={`${viewGroupId}-${prompt.promptId}`}>
      {batchDeleteMode && <input type="checkbox" aria-label={`选择提示词 ${prompt.title}`} checked={selected} onChange={(event) => {
        const setter = favoriteReference ? setSelectedFavoritePromptIds : setSelectedPromptIds;
        setter((items) => { const next = new Set(items); if (event.target.checked) next.add(prompt.promptId); else next.delete(prompt.promptId); return next; });
      }} />}
      <button type="button" className="prompt-item-title" onClick={() => void choosePrompt(prompt, viewGroupId)}>{prompt.title}</button>
      {!batchDeleteMode && <details className="prompt-row-menu"><summary aria-label={`提示词操作 ${prompt.title}`}>•••</summary><div>
        <button type="button" onClick={(event) => { closeRowMenu(event); void toggleFavorite(prompt); }}>{prompt.isFavorite ? '取消常用' : '标记常用'}</button>
        {!favoriteReference && <button type="button" onClick={(event) => { closeRowMenu(event); setDeleteTarget({ promptId: prompt.promptId, title: prompt.title }); }}>删除提示词</button>}
        <button type="button" onClick={(event) => { closeRowMenu(event); void startBatchDelete(); }}>批量删除</button>
      </div></details>}
    </div>;
  };

  const renderGroupSection = (groupId: string, groupName: string, groupPrompts: PromptItem[], group?: PromptGroup, favoriteOnly = false, ungrouped = false) => {
    const expanded = expandedGroupIds.has(groupId) || Boolean(query.trim());
    const groupChecked = favoriteOnly
      ? groupPrompts.length > 0 && groupPrompts.every((prompt) => selectedFavoritePromptIds.has(prompt.promptId))
      : ungrouped
        ? groupPrompts.length > 0 && groupPrompts.every((prompt) => selectedPromptIds.has(prompt.promptId))
        : selectedGroupIds.has(groupId);
    return <section key={groupId} className={`${groupId === selectedGroupId ? 'is-active' : ''}${ungrouped ? ' is-ungrouped' : ''}`}>
      <div className="prompt-group-row">
        {batchDeleteMode && <input type="checkbox" aria-label={`选择分组 ${groupName}`} checked={groupChecked} onChange={(event) => {
          if (ungrouped) {
            setSelectedPromptIds((items) => { const next = new Set(items); groupPrompts.forEach((prompt) => event.target.checked ? next.add(prompt.promptId) : next.delete(prompt.promptId)); return next; });
          } else toggleGroupSelection(groupId, event.target.checked);
        }} />}
        <button type="button" className="prompt-group-title" onClick={() => void chooseGroup(groupId)}><span className="prompt-group-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span><strong>{groupName}</strong></button>
        {!batchDeleteMode && !ungrouped && <details className="prompt-row-menu"><summary aria-label={`分组操作 ${groupName}`}>•••</summary><div>
          <button type="button" onClick={(event) => { closeRowMenu(event); if (favoriteOnly) setDeleteGroupTarget({ groupId, groupName, favoriteOnly: true }); else if (group) void deleteGroup(group); }}>删除分组</button>
          <button type="button" onClick={(event) => { closeRowMenu(event); void startBatchDelete(); }}>批量删除</button>
        </div></details>}
      </div>
      {expanded && <div className="prompt-item-list">{groupPrompts.map((prompt) => renderPromptRow(prompt, groupId))}</div>}
    </section>;
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
              <div className="prompt-library-primary-tools">
                <button type="button" onClick={() => setCreateGroupOpen(true)}>新建分组</button>
                <button type="button" disabled={!selectedGroupId} onClick={() => void createPrompt()}>新建提示词</button>
              </div>
              {batchDeleteMode && <div className="prompt-batch-delete-bar"><span>已选 {batchSelectionCount} 项</span><button type="button" onClick={resetBatchDelete}>取消</button><button type="button" disabled={!batchSelectionCount || deleting} onClick={() => setBatchDeleteConfirmOpen(true)}>删除所选</button></div>}
              <div className="prompt-group-list">
                {favoritePrompts.length > 0 && renderGroupSection(FAVORITES_GROUP_ID, '常用提示词', favoritePrompts, undefined, true)}
                {groups.map((group) => renderGroupSection(group.groupId, group.groupName, prompts.filter((prompt) => prompt.groupId === group.groupId), group))}
                {ungroupedPrompts.length > 0 && renderGroupSection(UNGROUPED_GROUP_ID, '未分组', ungroupedPrompts, undefined, false, true)}
              </div>
            </aside>
            <section className="prompt-library-editor">
              {selectedPromptId ? <>
                <div className="prompt-editor-title"><input value={title} maxLength={100} disabled={inserting} aria-label="提示词标题" onChange={(event) => setTitle(event.target.value)} />{selectedGroupId !== FAVORITES_GROUP_ID && <button type="button" title="删除提示词" disabled={inserting} onClick={() => setDeleteTarget({ promptId: selectedPromptId, title: title.trim() || '未命名提示词' })}>•••</button>}</div>
                <div className="prompt-editor-toolbar"><span>{selectedGroupName}</span><button type="button" disabled={!past.length} onClick={undo}>↶ 撤销</button><button type="button" disabled={!future.length} onClick={redo}>↷ 重做</button></div>
                <textarea ref={editorRef} value={content} disabled={inserting} aria-label="提示词内容" placeholder="输入提示词内容，支持 Markdown" onChange={(event) => updateContent(event.target.value)} onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
                }} />
                <footer className={`prompt-save-status is-${saveStatus}`}><span>{statusText}</span><span>共 {Array.from(content).length} 字</span></footer>
              </> : <div className="prompt-library-empty"><strong>暂无提示词</strong><span>新建或导入提示词后即可在这里编辑。</span></div>}
            </section>
          </div>
          <footer className="prompt-library-actions"><details className="prompt-import-menu"><summary>导入提示词</summary><div><button type="button" onClick={() => void importSingle()}>单个导入</button><button type="button" onClick={() => void prepareBatch()}>批量导入</button></div></details><button type="button" className="secondary-action" disabled={inserting} onClick={() => void closeLibrary()}>关闭</button><button type="button" className="primary-action" disabled={insertDisabled} title={insertDisabled ? (!selectedPromptId ? '请先选择提示词' : !content.trim() ? '提示词内容为空，无法插入' : '正在处理提示词') : ''} onClick={() => void (async () => { const draft = { ...draftRef.current }; setInserting(true); try { if (await saveCurrent()) { onInsert(draft.content); onOpenChange(false); showToast('已插入输入框', 'success'); } } finally { setInserting(false); } })()}>插入到输入框</button></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <Dialog.Root open={createGroupOpen} onOpenChange={setCreateGroupOpen}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-subdialog"><Dialog.Title>新建分组</Dialog.Title><Dialog.Description className="sr-only">填写分组名称、描述并选择文件夹颜色。</Dialog.Description><label>分组名称 <em>*</em><input value={groupName} maxLength={30} onChange={(event) => setGroupName(event.target.value)} placeholder="请输入分组名称，最多 30 个字符" /><small>{Array.from(groupName).length}/30</small></label><label>分组描述<textarea value={groupDescription} maxLength={100} onChange={(event) => setGroupDescription(event.target.value)} placeholder="请输入分组描述（可选）" /><small>{Array.from(groupDescription).length}/100</small></label><fieldset><legend>分组图标</legend>{['blue', 'yellow', 'green', 'purple', 'red', 'cyan'].map((color) => <button type="button" aria-label={`${color} 文件夹`} className={groupIcon === color ? 'is-active' : ''} key={color} onClick={() => setGroupIcon(color)}><i className={`prompt-folder is-${color}`} /></button>)}</fieldset><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="primary-action" disabled={!groupName.trim()} onClick={() => void createGroup()}>创建</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={batchOpen} onOpenChange={(next) => { if (!importing) setBatchOpen(next); }}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-import-dialog"><header><div><Dialog.Title>导入提示词</Dialog.Title><Dialog.Description>支持批量导入提示词，每个文档内容为一个独立提示词。</Dialog.Description></div><Dialog.Close aria-label="关闭">×</Dialog.Close></header><div className="prompt-import-summary">已选择 {batchItems.length} 个文件（.md、.txt、.docx）</div><div className="prompt-import-table"><div className="prompt-import-row is-head"><span>文件名 / 标题</span><span>预览内容（前 100 字符）</span><span>分组</span><span>状态</span><span>操作</span></div>{batchItems.map((item) => <div className="prompt-import-row" key={item.importId}><input value={item.title} disabled={item.status === 'error'} onChange={(event) => setBatchItems((items) => items.map((entry) => entry.importId === item.importId ? { ...entry, title: event.target.value } : entry))} title={item.fileName} /><span title={item.error || item.preview}>{item.error || item.preview}</span><select value={item.groupId} disabled={item.status === 'error'} onChange={(event) => setBatchItems((items) => items.map((entry) => entry.importId === item.importId ? { ...entry, groupId: event.target.value } : entry))}>{groups.map((group) => <option key={group.groupId} value={group.groupId}>{group.groupName}</option>)}<option value={UNGROUPED_GROUP_ID}>未分组</option></select><span className={item.status === 'error' ? 'is-error' : 'is-ready'}>{item.status === 'error' ? '解析失败' : '待导入'}</span><button type="button" onClick={() => setBatchItems((items) => items.filter((entry) => entry.importId !== item.importId))}>移除</button></div>)}</div><footer><Dialog.Close className="secondary-action" disabled={importing}>取消</Dialog.Close><button type="button" className="primary-action" disabled={importing || !batchItems.some((item) => item.status === 'ready')} onClick={() => void commitBatch()}>{importing ? '正在导入…' : '开始导入'}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(next) => !next && setDeleteTarget(null)}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-delete-dialog"><Dialog.Title>删除提示词</Dialog.Title><Dialog.Description>删除“{deleteTarget?.title}”后将不再显示，是否继续？</Dialog.Description><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="danger-action" onClick={() => void removePrompt()}>删除</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={Boolean(deleteGroupTarget)} onOpenChange={(next) => !next && setDeleteGroupTarget(null)}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-delete-dialog"><Dialog.Title>删除分组</Dialog.Title><Dialog.Description>{deleteGroupTarget?.favoriteOnly ? '删除“常用提示词”分组只会取消全部常用引用，不会删除原提示词。' : `删除“${deleteGroupTarget?.groupName || ''}”后，组内提示词也会一并删除。`}</Dialog.Description><footer><Dialog.Close className="secondary-action" disabled={deleting}>取消</Dialog.Close><button type="button" className="danger-action" disabled={deleting} onClick={() => void confirmDeleteGroup()}>{deleting ? '删除中…' : '删除'}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={batchDeleteConfirmOpen} onOpenChange={(next) => !deleting && setBatchDeleteConfirmOpen(next)}><Dialog.Portal><Dialog.Overlay className="prompt-subdialog-overlay" /><Dialog.Content className="prompt-delete-dialog"><Dialog.Title>批量删除提示词</Dialog.Title><Dialog.Description>普通分组中未勾选的提示词会移入“未分组”；常用分组中的选择只取消引用，不删除原提示词。</Dialog.Description><footer><Dialog.Close className="secondary-action" disabled={deleting}>取消</Dialog.Close><button type="button" className="danger-action" disabled={deleting} onClick={() => void confirmBatchDelete()}>{deleting ? '删除中…' : '确认删除'}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
