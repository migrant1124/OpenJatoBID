import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownRenderer, useToast } from '../../../shared/ui';
import type { ConversationAttachment, ConversationMessage, ConversationThread } from '../types';
import { graphemeLength, useConversationWorkspace } from '../hooks/useConversationWorkspace';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const attachmentStatus: Record<ConversationAttachment['status'], string> = {
  selected: '等待处理', copying: '正在复制', parsing: '正在解析', ready: '解析完成', error: '解析失败', removed: '已移除',
};

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
        <span>{thread.lastMessagePreview || '开始一段新对话'}</span>
        <time>{formatTime(thread.updatedAt)}</time>
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
      {assistant && <div className="conversation-agent-avatar" aria-hidden="true">J</div>}
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
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ConversationAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentThread = workspace.snapshot?.thread;
  const allAttachments = workspace.snapshot?.attachments || [];
  const activeGeneration = Boolean(workspace.activeMessage);
  const characterCount = graphemeLength(workspace.draft);
  const canSend = !workspace.busy && !workspace.converting && !activeGeneration
    && (Boolean(workspace.draft.trim()) || workspace.draftAttachments.length > 0)
    && workspace.draftAttachments.every((item) => item.status === 'ready');

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

  const requestRemove = (attachment: ConversationAttachment) => {
    if (attachment.source === 'composer-overflow-text' && !attachment.originMessageId) setRemoveTarget(attachment);
    else void workspace.removeAttachment(attachment).catch((error) => showToast(error instanceof Error ? error.message : '移除失败', 'error'));
  };

  const threadPanel = useMemo(() => (
    <aside className="conversation-thread-panel">
      <div className="conversation-thread-tools">
        <input value={workspace.query} onChange={(event) => workspace.setQuery(event.target.value)} placeholder="搜索会话标题" aria-label="搜索会话标题" />
        <button type="button" onClick={() => { void workspace.createThread(); setThreadPanelOpen(false); }}>＋ 新建对话</button>
      </div>
      <h2>会话列表</h2>
      <div className="conversation-thread-list">
        {workspace.threads.map((thread) => <ThreadItem key={thread.threadId} thread={thread} active={thread.threadId === workspace.activeThreadId}
          onSelect={() => { workspace.selectThread(thread.threadId); setThreadPanelOpen(false); }} onRename={() => openRename(thread)} onDelete={() => requestDelete(thread)} />)}
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
            <textarea value={workspace.draft} disabled={workspace.converting} aria-label="对话输入" placeholder="输入问题，Enter 发送，Shift + Enter 换行"
              onChange={(event) => workspace.setDraft(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) void workspace.send(); }
              }} />
            <div className="conversation-composer-bar">
              <button className="conversation-attach-button" type="button" disabled={workspace.busy || workspace.converting} onClick={() => void workspace.selectAttachments()} aria-label="添加附件">⌕ <span>添加附件</span></button>
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
      <Dialog.Root open={attachmentsOpen} onOpenChange={setAttachmentsOpen}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog conversation-attachments-dialog"><Dialog.Title>本会话附件</Dialog.Title><Dialog.Description>附件仅在当前会话中持续可用，不显示本机路径。</Dialog.Description><div>{allAttachments.length ? allAttachments.map((attachment) => <AttachmentCard key={attachment.attachmentId} attachment={attachment} removable={attachment.status !== 'removed'} detailed onRemove={() => requestRemove(attachment)} />) : <p>暂无附件。</p>}</div><footer><Dialog.Close className="primary-action">关闭</Dialog.Close></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
      <Dialog.Root open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="conversation-dialog"><Dialog.Title>删除超长文本附件</Dialog.Title><Dialog.Description>删除后将不再保留原输入文本，是否继续？</Dialog.Description><footer><Dialog.Close className="secondary-action">取消</Dialog.Close><button type="button" className="danger-action" onClick={() => { if (removeTarget) void workspace.removeAttachment(removeTarget); setRemoveTarget(null); }}>删除</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
    </main>
  );
}

export default ConversationPage;
