import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect, useMemo, useRef, useState } from 'react';
import agentLogoUrl from '../../../../assets/icon_64.png';
import { MarkdownRenderer, useToast } from '../../../shared/ui';
import { PromptLibraryDialog } from '../../prompt-library/components/PromptLibraryDialog';
import type { ConversationAttachment, ConversationMessage, ConversationThread } from '../types';
import { graphemeLength, useConversationWorkspace } from '../hooks/useConversationWorkspace';
import { replaceDraftWithPrompt } from '../utils/promptInsertion';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function threadGroupLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更早';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
  if (date >= today) return '今天';
  if (date >= yesterday) return '昨天';
  if (date >= sevenDaysAgo) return '7 天内';
  if (date >= thirtyDaysAgo) return '30 天内';
  return '更早';
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const attachmentStatus: Record<ConversationAttachment['status'], string> = {
  selected: '等待处理', copying: '正在复制', parsing: '正在解析', ready: '解析完成', error: '解析失败', removed: '已移除',
};
const COMPOSER_MIN_HEIGHT = 82;
const COMPOSER_MAX_HEIGHT = 396;

function clampComposerHeight(value: number) {
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, value));
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="conversation-icon-button" type="button" aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>
      </Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tooltip-content" sideOffset={6}>{label}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ThreadItem({ thread, active, onSelect, onRename, onDelete }: {
  thread: ConversationThread; active: boolean; onSelect: () => void; onRename: () => void; onDelete: () => void;
}) {
  return (
    <div className={`conversation-thread-item${active ? ' is-active' : ''}`}>
      <button type="button" className="conversation-thread-main" onClick={onSelect}>
        <strong>{thread.title}</strong>
      </button>
      <details className="conversation-more-menu">
        <summary aria-label="会话操作">•••</summary>
        <div><button type="button" onClick={onRename}>重命名</button><button type="button" onClick={onDelete}>删除</button></div>
      </details>
    </div>
  );
}

function AttachmentCard({ attachment, removable, detailed = false, onRemove }: { attachment: ConversationAttachment; removable: boolean; detailed?: boolean; onRemove: () => void }) {
  return (
    <div className={`conversation-attachment-card is-${attachment.status}`}>
      <span className="conversation-file-icon" aria-hidden="true">▤</span>
      <div><strong title={attachment.fileName}>{attachment.fileName}</strong><span>{formatBytes(attachment.sizeBytes)} · {attachmentStatus[attachment.status]}</span>
        {detailed && <small>{formatTime(attachment.createdAt)} · {attachment.parserLabel || '未记录解析方式'}</small>}
        {['copying', 'parsing'].includes(attachment.status) && <progress value={attachment.progress} max="100" />}
        {attachment.error && <small>{attachment.error}</small>}
      </div>
      {removable && <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={onRemove}>×</button>}
    </div>
  );
}

function MessageCard({ message, attachments = [], generationActive, onQuickAction, onRegenerate, onExport, onCopy }: {
  message: ConversationMessage;
  attachments?: ConversationAttachment[];
  generationActive: boolean;
  onQuickAction: (action: 'continue' | 'refine' | 'formal') => void;
  onRegenerate: () => void;
  onExport: () => void;
  onCopy: () => void;
}) {
  const assistant = message.role === 'assistant';
  const streaming = ['queued', 'streaming'].includes(message.status);
  const answerActionsDisabled = generationActive || !['completed', 'canceled'].includes(message.status);
  const moreActionsDisabled = generationActive || streaming;
  return (
    <article className={`conversation-message is-${message.role}`}>
      {assistant && <img className="conversation-agent-avatar" src={agentLogoUrl} alt="" />}
      <div className="conversation-message-body">
        {assistant && <header><strong>Jato Agent</strong><time>{formatTime(message.createdAt)}</time></header>}
        <div className="conversation-message-content">
          {assistant ? <MarkdownRenderer allowRawHtml={false}>{message.contentMarkdown || (['queued', 'streaming'].includes(message.status) ? '正在生成…' : '')}</MarkdownRenderer> : message.contentMarkdown}
        </div>
        {!assistant && attachments.length > 0 && <div className="conversation-message-attachments">{attachments.map((attachment) => <AttachmentCard key={attachment.attachmentId} attachment={attachment} removable={false} onRemove={() => {}} />)}</div>}
        {!assistant && <time>{formatTime(message.createdAt)}</time>}
        {message.status === 'canceled' && <p className="conversation-message-state">已停止生成</p>}
        {message.status === 'error' && <p className="conversation-message-error">{message.errorMessage || '生成失败，请重试。'}</p>}
        {assistant && message.contentMarkdown && (
          <footer className="conversation-message-actions">
            <IconButton label="继续扩写" disabled={answerActionsDisabled} onClick={() => onQuickAction('continue')}>↳</IconButton>
            <IconButton label="精简润色" disabled={answerActionsDisabled} onClick={() => onQuickAction('refine')}>✦</IconButton>
            <IconButton label="改正式语气" disabled={answerActionsDisabled} onClick={() => onQuickAction('formal')}>文</IconButton>
            <IconButton label="导出 Word" disabled={answerActionsDisabled} onClick={onExport}>W</IconButton>
            <details className="conversation-message-more" onClick={(event) => { if (moreActionsDisabled) event.preventDefault(); }}>
              <summary aria-label="更多回答操作" aria-disabled={moreActionsDisabled}>•••</summary>
              <div><button type="button" disabled={moreActionsDisabled} onClick={onCopy}>复制回答</button><button type="button" disabled={moreActionsDisabled} onClick={onRegenerate}>重新生成</button></div>
            </details>
          </footer>
        )}
      </div>
    </article>
  );
}

function ConversationPage() {
  const workspace = useConversationWorkspace();
  const { showToast } = useToast();
  const [threadPanelOpen, setThreadPanelOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ConversationAttachment | null>(null);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const currentThread = workspace.snapshot?.thread;
  const allAttachments = workspace.snapshot?.attachments || [];
  const activeGeneration = Boolean(workspace.activeMessage);
  const characterCount = graphemeLength(workspace.draft);
  const canSend = !workspace.busy && !workspace.converting && !activeGeneration
    && (Boolean(workspace.draft.trim()) || workspace.draftAttachments.length > 0)
    && workspace.draftAttachments.every((item) => item.status === 'ready');
  const groupedThreads = useMemo(() => {
    const groups = new Map<string, ConversationThread[]>();
    workspace.threads.forEach((thread) => {
      const label = threadGroupLabel(thread.updatedAt);
      groups.set(label, [...(groups.get(label) || []), thread]);
    });
    return [...groups];
  }, [workspace.threads]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: 'end' }); }, [workspace.snapshot?.messages]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      document.querySelectorAll<HTMLDetailsElement>('.conversation-page details[open]').forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
    };
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);

  const openRename = (thread?: ConversationThread) => {
    if (thread && thread.threadId !== workspace.activeThreadId) workspace.selectThread(thread.threadId);
    setRenameValue(thread?.title || currentThread?.title || '');
    setRenameOpen(true);
  };

  const confirmRename = async () => {
    try { await workspace.renameThread(renameValue); setRenameOpen(false); } catch (error) { showToast(error instanceof Error ? error.message : '重命名失败', 'error'); }
  };

  const requestDelete = (thread?: ConversationThread) => {
    if (thread && thread.threadId !== workspace.activeThreadId) workspace.selectThread(thread.threadId);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    try { await workspace.deleteThread(); setDeleteOpen(false); } catch (error) { showToast(error instanceof Error ? error.message : '删除失败', 'error'); }
  };

  const confirmBatchDelete = async () => {
    if (!selectedThreadIds.size) return;
    setBatchDeleting(true);
    try {
      await workspace.deleteThreads([...selectedThreadIds]);
      showToast(`已删除 ${selectedThreadIds.size} 个会话`, 'success');
      setBatchDeleteOpen(false);
      setSelectedThreadIds(new Set());
    } catch (error) {
      showToast(error instanceof Error ? error.message : '批量删除失败', 'error');
    } finally {
      setBatchDeleting(false);
    }
  };

  const requestRemove = (attachment: ConversationAttachment) => {
    if (attachment.source === 'composer-overflow-text' && !attachment.originMessageId) setRemoveTarget(attachment);
    else void workspace.removeAttachment(attachment).catch((error) => showToast(error instanceof Error ? error.message : '移除失败', 'error'));
  };

  const resizeComposer = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = composerResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setComposerHeight(clampComposerHeight(resize.startHeight + resize.startY - event.clientY));
  };

  const insertPrompt = (prompt: string) => {
    const textarea = composerRef.current;
    const replacement = replaceDraftWithPrompt(prompt);
    workspace.setDraft(replacement.text);
    window.setTimeout(() => { textarea?.focus(); textarea?.setSelectionRange(replacement.caret, replacement.caret); }, 0);
  };

  const threadPanel = useMemo(() => (
    <aside className="conversation-thread-panel">
      <div className="conversation-thread-tools">
        <input value={workspace.query} onChange={(event) => workspace.setQuery(event.target.value)} placeholder="搜索会话标题" aria-label="搜索会话标题" />
        <button type="button" onClick={() => { void workspace.createThread(); setThreadPanelOpen(false); }}>＋ 新建对话</button>
      </div>
      <div className="conversation-thread-heading"><h2>会话列表</h2><button type="button" aria-label="批量删除会话" title="批量删除会话" onClick={() => { setSelectedThreadIds(new Set()); setBatchDeleteOpen(true); }}>⚙</button></div>
      <div className="conversation-thread-list">
        {groupedThreads.map(([label, threads]) => <section className="conversation-thread-group" key={label}><h3>{label}</h3>
          {threads.map((thread) => <ThreadItem key={thread.threadId} thread={thread} active={thread.threadId === workspace.activeThreadId}
            onSelect={() => { workspace.selectThread(thread.threadId); setThreadPanelOpen(false); }} onRename={() => openRename(thread)} onDelete={() => requestDelete(thread)} />)}
        </section>)}
      </div>
      <footer>共 {workspace.threads.length} 个会话</footer>
    </aside>
  ), [workspace.threads, workspace.activeThreadId, workspace.query]);

  return (
    <main className="conversation-page">
      <section className="conversation-title-card"><div><h1>对话智能体工作台</h1><p>通过多轮对话生成内容、整理方案并导出 Word</p></div></section>
      <section className="conversation-workspace">
        <div className="conversation-desktop-thread-panel">{threadPanel}</div>
        <section className="conversation-chat-panel">
          <header className="conversation-chat-header">
            <button className="conversation-thread-toggle" type="button" aria-label="打开会话列表" onClick={() => setThreadPanelOpen(true)}>☰</button>
            <div><h2>{currentThread?.title || '对话模式'}</h2><span>{activeGeneration ? 'Jato Agent 正在生成' : 'Jato Agent'}</span></div>
            <details className="conversation-header-menu"><summary aria-label="当前会话操作">•••</summary><div>
              <button type="button" onClick={() => setAttachmentsOpen(true)}>查看本会话附件</button>
              <button type="button" onClick={() => openRename()}>重命名</button>
              <button type="button" onClick={() => requestDelete()}>删除</button>
            </div></details>
          </header>

          <div className="conversation-message-list">
            {!workspace.snapshot?.messages.length && <div className="conversation-empty-state"><h3>开始与 Jato Agent 对话</h3><p>输入问题，或上传文档后围绕材料继续提问。</p></div>}
            {workspace.snapshot?.messages.map((message) => <MessageCard key={message.messageId} message={message} attachments={allAttachments.filter((attachment) => attachment.originMessageId === message.messageId)} generationActive={activeGeneration}
              onQuickAction={(action) => void workspace.quickAction(message.messageId, action)} onRegenerate={() => void workspace.regenerate(message.messageId)}
              onExport={() => void workspace.exportWord(message.messageId)} onCopy={() => void workspace.copyMessage(message.contentMarkdown)} />)}
            <div ref={messagesEndRef} />
          </div>

          <div className="conversation-composer">
            {workspace.draftAttachments.length > 0 && <div className="conversation-attachment-tray">{workspace.draftAttachments.map((attachment) => <AttachmentCard key={attachment.attachmentId} attachment={attachment} removable onRemove={() => requestRemove(attachment)} />)}</div>}
            <div className="conversation-composer-input">
              <div className="conversation-composer-resize-handle" role="separator" aria-label="调节输入框高度" aria-orientation="horizontal" aria-valuemin={COMPOSER_MIN_HEIGHT} aria-valuemax={COMPOSER_MAX_HEIGHT} aria-valuenow={composerHeight} tabIndex={0}
                onPointerDown={(event) => { composerResizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: composerHeight }; event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerMove={resizeComposer} onPointerUp={(event) => { composerResizeRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { composerResizeRef.current = null; }}
                onKeyDown={(event) => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); setComposerHeight((height) => clampComposerHeight(height + (event.key === 'ArrowUp' ? 10 : -10))); }} />
              <textarea ref={composerRef} value={workspace.draft} disabled={workspace.converting} aria-label="对话输入" placeholder="输入问题，Enter 发送，Shift + Enter 换行" style={{ height: composerHeight }}
                onChange={(event) => workspace.setDraft(event.target.value)} onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) void workspace.send(); }
                }} />
            </div>
            <div className="conversation-composer-bar">
              <div className="conversation-composer-tools"><button className="conversation-attach-button" type="button" disabled={workspace.busy || workspace.converting} onClick={() => void workspace.selectAttachments()} aria-label="添加附件"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg><span>添加附件</span></button><button className="conversation-prompt-button" type="button" onClick={() => setPromptLibraryOpen(true)} aria-label="打开提示词库"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="7" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 7h4a4 4 0 0 1 4 4v5M8 7l7-1" /></svg><span>提示词库</span></button></div>
              <span className={characterCount > 10000 ? 'is-overflow' : ''}>{workspace.converting ? '正在将超长文本转换为 TXT 附件' : `${characterCount} / 10000`}</span>
              {activeGeneration
                ? <button className="conversation-stop-button" type="button" onClick={() => void workspace.stop()}>■ 停止</button>
                : <button className="conversation-send-button" type="button" disabled={!canSend} onClick={() => void workspace.send()}>发送</button>}
            </div>
          </div>
        </section>
      </section>

      <Dialog.Root open={threadPanelOpen} onOpenChange={setThreadPanelOpen}><Dialog.Portal><Dialog.Overlay className="conversation-drawer-overlay" /><Dialog.Content className="conversation-thread-drawer"><Dialog.Title className="sr-only">会话列表</Dialog.Title>{threadPanel}</Dialog.Content></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={renameOpen} onOpenChange={setRenameOpen}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog"><Dialog.Title>重命名会话</Dialog.Title><Dialog.Description>输入 1–80 个字符的会话标题。</Dialog.Description><input value={renameValue} maxLength={80} onChange={(event) => setRenameValue(event.target.value)} /><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="primary-action" onClick={() => void confirmRename()}>保存</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog"><Dialog.Title>删除会话</Dialog.Title><Dialog.Description>会话将从列表中移除，相关附件按维护策略延迟清理。</Dialog.Description><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="danger-action" onClick={() => void confirmDelete()}>删除</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={batchDeleteOpen} onOpenChange={(open) => { if (!batchDeleting) setBatchDeleteOpen(open); }}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog conversation-batch-delete-dialog"><Dialog.Title>批量删除会话</Dialog.Title><Dialog.Description>选择需要删除的会话，删除后无法恢复。</Dialog.Description><div className="conversation-batch-delete-list"><label><input type="checkbox" checked={workspace.threads.length > 0 && selectedThreadIds.size === workspace.threads.length} onChange={(event) => setSelectedThreadIds(event.target.checked ? new Set(workspace.threads.map((thread) => thread.threadId)) : new Set())} />全选</label>{workspace.threads.map((thread) => <label key={thread.threadId}><input type="checkbox" checked={selectedThreadIds.has(thread.threadId)} onChange={(event) => setSelectedThreadIds((current) => { const next = new Set(current); if (event.target.checked) next.add(thread.threadId); else next.delete(thread.threadId); return next; })} /><span>{thread.title}</span></label>)}</div><footer><Dialog.Close className="secondary-action" disabled={batchDeleting}>取消</Dialog.Close><button type="button" className="danger-action" disabled={!selectedThreadIds.size || batchDeleting} onClick={() => void confirmBatchDelete()}>{batchDeleting ? '删除中…' : `删除所选（${selectedThreadIds.size}）`}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={attachmentsOpen} onOpenChange={setAttachmentsOpen}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog conversation-attachments-dialog"><Dialog.Title>本会话附件</Dialog.Title><Dialog.Description>附件仅在当前会话中持续可用，不显示本机路径。</Dialog.Description><div>{allAttachments.length ? allAttachments.map((attachment) => <AttachmentCard key={attachment.attachmentId} attachment={attachment} removable={attachment.status !== 'removed'} detailed onRemove={() => requestRemove(attachment)} />) : <p>暂无附件。</p>}</div><footer><Dialog.Close className="primary-action">关闭</Dialog.Close></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog"><Dialog.Title>删除超长文本附件</Dialog.Title><Dialog.Description>删除后将不再保留原输入文本，是否继续？</Dialog.Description><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="danger-action" onClick={() => { if (removeTarget) void workspace.removeAttachment(removeTarget); setRemoveTarget(null); }}>删除</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <PromptLibraryDialog open={promptLibraryOpen} onOpenChange={setPromptLibraryOpen} onInsert={insertPrompt} />
    </main>
  );
}

export default ConversationPage;
