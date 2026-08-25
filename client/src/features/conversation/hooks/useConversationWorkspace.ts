import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../../shared/ui';
import type { ConversationAttachment, ConversationEvent, ConversationMessage, ConversationThread, ConversationThreadSnapshot } from '../types';

export function graphemeLength(value: string) {
  try {
    const Segmenter = (Intl as typeof Intl & { Segmenter: new (locale: string, options: { granularity: 'grapheme' }) => { segment: (text: string) => Iterable<unknown> } }).Segmenter;
    return [...new Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value)].length;
  } catch {
    return Array.from(value).length;
  }
}

function conversationApi() {
  if (!window.yibiao?.conversation) throw new Error('对话服务尚未就绪，请稍后重试。');
  return window.yibiao.conversation;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || '操作失败')).replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^[A-Z][A-Z0-9_]+:\s*/, '');
}

export function useConversationWorkspace() {
  const { showToast } = useToast();
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [snapshot, setSnapshot] = useState<ConversationThreadSnapshot | null>(null);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const activeThreadRef = useRef(activeThreadId);
  const snapshotRef = useRef(snapshot);
  const failedConversionRef = useRef('');
  const deletingThreadsRef = useRef(false);
  activeThreadRef.current = activeThreadId;
  snapshotRef.current = snapshot;

  const loadThreads = useCallback(async (search = '', preferredId = activeThreadRef.current) => {
    let list = await conversationApi().listThreads({ query: search });
    if (deletingThreadsRef.current) return '';
    if (!list.length && !search) {
      const created = await conversationApi().createThread();
      list = [created];
    }
    setThreads(list);
    const nextId = list.some((item) => item.threadId === preferredId) ? preferredId : list[0]?.threadId || '';
    if (nextId && nextId !== activeThreadRef.current) setActiveThreadId(nextId);
    return nextId;
  }, []);

  const loadSnapshot = useCallback(async (threadId = activeThreadRef.current) => {
    if (!threadId) return;
    try {
      setSnapshot(await conversationApi().getThread({ threadId }));
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void loadThreads('', '').catch((error) => showToast(errorMessage(error), 'error'));
  }, [loadThreads, showToast]);

  useEffect(() => {
    if (activeThreadId) void loadSnapshot(activeThreadId);
  }, [activeThreadId, loadSnapshot]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreads(query).catch((error) => showToast(errorMessage(error), 'error'));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, loadThreads, showToast]);

  const applyEvent = useCallback((event: ConversationEvent) => {
    if (event.type === 'thread-list-changed') {
      if (deletingThreadsRef.current) return;
      void loadThreads(query);
      return;
    }
    if ('threadId' in event && event.threadId !== activeThreadRef.current) return;
    if (event.type === 'attachment-progress' && !snapshotRef.current?.attachments.some((item) => item.attachmentId === event.attachmentId)) {
      void loadSnapshot(event.threadId);
      return;
    }
    if (event.type === 'attachment-progress' && ['ready', 'error'].includes(event.status)) {
      void loadSnapshot(event.threadId);
      return;
    }
    setSnapshot((current) => {
      if (!current) return current;
      if (event.type === 'attachment-progress') {
        return { ...current, attachments: current.attachments.map((item) => item.attachmentId === event.attachmentId
          ? { ...item, status: event.status, progress: event.progress }
          : item) };
      }
      if (!('messageId' in event)) return current;
      return {
        ...current,
        messages: current.messages.map((message) => {
          if (message.messageId !== event.messageId) return message;
          if (event.type === 'message-queued') return { ...message, status: 'queued' };
          if (event.type === 'message-start') return { ...message, status: 'streaming' };
          if (event.type === 'message-delta') return { ...message, status: 'streaming', contentMarkdown: `${message.contentMarkdown}${event.delta}` };
          if (event.type === 'message-complete') return { ...message, status: 'completed', contentMarkdown: event.contentMarkdown };
          if (event.type === 'message-canceled') return { ...message, status: 'canceled', contentMarkdown: event.contentMarkdown };
          if (event.type === 'message-error') return { ...message, status: 'error', contentMarkdown: event.partialContent || message.contentMarkdown, errorCode: event.errorCode, errorMessage: event.message };
          return message;
        }),
      };
    });
  }, [loadSnapshot, loadThreads, query]);

  useEffect(() => conversationApi().onEvent(applyEvent), [applyEvent]);

  const draftAttachments = useMemo(() => snapshot?.attachments.filter((item) => !item.originMessageId && item.status !== 'removed') || [], [snapshot]);
  const activeMessage = useMemo(() => [...(snapshot?.messages || [])].reverse().find((item) => item.role === 'assistant' && ['queued', 'streaming'].includes(item.status)), [snapshot]);
  const conversionKey = `${activeThreadId}:${draft}:${draftAttachments.map((item) => `${item.attachmentId}:${item.status}`).join(',')}`;

  useEffect(() => {
    if (graphemeLength(draft) <= 10000) {
      failedConversionRef.current = '';
      return;
    }
    if (!activeThreadId || converting || failedConversionRef.current === conversionKey) return;
    const content = draft;
    const timer = window.setTimeout(() => {
      setConverting(true);
      void conversationApi().createTextAttachment({
        threadId: activeThreadId,
        content,
        existingDraftAttachmentIds: draftAttachments.map((item) => item.attachmentId),
      }).then(({ attachment }) => {
        failedConversionRef.current = '';
        setSnapshot((current) => current ? { ...current, attachments: current.attachments.some((item) => item.attachmentId === attachment.attachmentId) ? current.attachments : [...current.attachments, attachment] } : current);
        setDraft((current) => current === content ? '' : current);
        showToast('超长文本已转换为 TXT 附件，请确认后主动发送。', 'success');
      }).catch((error) => {
        failedConversionRef.current = conversionKey;
        showToast(errorMessage(error), 'error');
      }).finally(() => setConverting(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeThreadId, conversionKey, converting, draft, draftAttachments, showToast]);

  const createThread = useCallback(async () => {
    const thread = await conversationApi().createThread();
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.threadId);
    setDraft('');
  }, []);

  const selectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setDraft('');
  }, []);

  const renameThread = useCallback(async (title: string) => {
    if (!activeThreadId) return;
    await conversationApi().renameThread({ threadId: activeThreadId, title });
    await Promise.all([loadThreads(query, activeThreadId), loadSnapshot(activeThreadId)]);
  }, [activeThreadId, loadSnapshot, loadThreads, query]);

  const deleteThread = useCallback(async () => {
    if (!activeThreadId) return;
    await conversationApi().deleteThread({ threadId: activeThreadId });
    setSnapshot(null);
    setActiveThreadId('');
    await loadThreads(query, '');
  }, [activeThreadId, loadThreads, query]);

  const deleteThreads = useCallback(async (threadIds: string[]) => {
    deletingThreadsRef.current = true;
    setSnapshot(null);
    setActiveThreadId('');
    activeThreadRef.current = '';
    try {
      for (const threadId of new Set(threadIds)) await conversationApi().deleteThread({ threadId });
    } finally {
      deletingThreadsRef.current = false;
      await loadThreads(query, '');
    }
  }, [loadThreads, query]);

  const selectAttachments = useCallback(async () => {
    if (!activeThreadId || busy || converting) return;
    setBusy(true);
    try {
      const result = await conversationApi().selectAttachments({
        threadId: activeThreadId,
        existingDraftAttachmentIds: draftAttachments.map((item) => item.attachmentId),
      });
      if (result.attachments.length) setSnapshot((current) => current ? { ...current, attachments: [...current.attachments, ...result.attachments.filter((attachment) => !current.attachments.some((item) => item.attachmentId === attachment.attachmentId))] } : current);
      if (result.errors.length) showToast(result.errors.map((item) => `${item.fileName}：${item.message}`).join('\n'), 'info');
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }, [activeThreadId, busy, converting, draftAttachments, showToast]);

  const removeAttachment = useCallback(async (attachment: ConversationAttachment) => {
    if (!activeThreadId) return;
    try {
      await conversationApi().removeAttachment({ threadId: activeThreadId, attachmentId: attachment.attachmentId });
    } finally {
      await loadSnapshot(activeThreadId);
    }
  }, [activeThreadId, loadSnapshot]);

  const appendResult = useCallback((result: { userMessage: ConversationMessage; assistantMessage: ConversationMessage }) => {
    setSnapshot((current) => current ? { ...current, messages: [...current.messages, result.userMessage, result.assistantMessage] } : current);
  }, []);

  const send = useCallback(async () => {
    if (!activeThreadId || busy || converting || activeMessage) return;
    if (draftAttachments.some((item) => item.status !== 'ready')) {
      showToast('请先等待附件解析完成，并移除解析失败的附件。', 'info');
      return;
    }
    setBusy(true);
    try {
      const result = await conversationApi().sendMessage({
        threadId: activeThreadId,
        content: draft,
        attachmentIds: draftAttachments.map((item) => item.attachmentId),
      });
      appendResult(result);
      setDraft('');
      setSnapshot((current) => current ? { ...current, attachments: current.attachments.map((item) => draftAttachments.some((draftItem) => draftItem.attachmentId === item.attachmentId) ? { ...item, originMessageId: result.userMessage.messageId } : item) } : current);
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }, [activeMessage, activeThreadId, appendResult, busy, converting, draft, draftAttachments, showToast]);

  const stop = useCallback(async () => {
    if (!activeThreadId || !activeMessage) return;
    await conversationApi().cancelMessage({ threadId: activeThreadId, assistantMessageId: activeMessage.messageId });
  }, [activeMessage, activeThreadId]);

  const quickAction = useCallback(async (messageId: string, action: 'continue' | 'refine' | 'formal') => {
    if (!activeThreadId || activeMessage) return;
    try {
      appendResult(await conversationApi().quickAction({ threadId: activeThreadId, assistantMessageId: messageId, action }));
    } catch (error) { showToast(errorMessage(error), 'error'); }
  }, [activeMessage, activeThreadId, appendResult, showToast]);

  const regenerate = useCallback(async (messageId: string) => {
    if (!activeThreadId || activeMessage) return;
    try {
      const result = await conversationApi().regenerateMessage({ threadId: activeThreadId, assistantMessageId: messageId });
      setSnapshot((current) => current ? { ...current, messages: [...current.messages, result.assistantMessage] } : current);
    } catch (error) { showToast(errorMessage(error), 'error'); }
  }, [activeMessage, activeThreadId, showToast]);

  const exportWord = useCallback(async (messageId: string) => {
    if (!activeThreadId) return;
    try {
      const result = await conversationApi().exportMessageWord({ threadId: activeThreadId, assistantMessageId: messageId });
      showToast(result.message || (result.success ? 'Word 已导出。' : '已取消导出。'), result.success ? 'success' : 'info');
    } catch (error) { showToast(errorMessage(error), 'error'); }
  }, [activeThreadId, showToast]);

  const copyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast('回答已复制。', 'success');
    } catch { showToast('复制失败，请重试。', 'error'); }
  }, [showToast]);

  return {
    threads, snapshot, activeThreadId, query, setQuery, draft, setDraft, busy, converting, draftAttachments, activeMessage,
    createThread, selectThread, renameThread, deleteThread, deleteThreads, selectAttachments, removeAttachment, send, stop,
    quickAction, regenerate, exportWord, copyMessage,
  };
}
