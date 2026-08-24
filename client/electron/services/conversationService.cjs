const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  CONVERSATION_SYSTEM_INSTRUCTION,
  QUICK_ACTION_PROMPTS,
  buildConversationWorkspace,
} = require('./conversationPromptBuilder.cjs');
const { visibleLength } = require('./conversationAttachmentService.cjs');

function conversationError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError' || /取消|abort/i.test(error?.message || '');
}

function isReasoningUnsupported(error) {
  return /reasoning[_ -]?effort|thinking level|思考档位|不支持.*推理|unsupported.*reason/i.test(error?.message || '');
}

function createConversationService({ app, configStore, store, attachmentService, agentService, exportService }) {
  const listeners = new Set();
  const activeControllers = new Map();
  const activeTasksByThread = new Map();
  const streamBuffers = new Map();
  const rootDir = path.resolve(app.getPath('userData'), 'workspace', 'conversation');

  function emit(event) {
    for (const listener of listeners) {
      try { listener(event); } catch {}
    }
  }

  function onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function ensureNoActiveTask(threadId) {
    if (activeTasksByThread.has(threadId)) {
      throw conversationError('CONVERSATION_ALREADY_RUNNING', '当前会话正在生成，请先停止或等待完成。');
    }
  }

  function listThreads(input = {}) {
    return store.listThreads(input.query);
  }

  function createThread() {
    const thread = store.createThread();
    emit({ type: 'thread-list-changed' });
    return thread;
  }

  function getThread({ threadId }) {
    return {
      thread: store.getThread(threadId),
      messages: store.listMessages(threadId),
      attachments: store.listThreadAttachments(threadId, true),
    };
  }

  function renameThread({ threadId, title }) {
    const thread = store.renameThread(threadId, title);
    emit({ type: 'thread-list-changed' });
    return thread;
  }

  async function deleteThread({ threadId }) {
    const activeMessageId = activeTasksByThread.get(threadId);
    if (activeMessageId) await cancelMessage({ threadId, assistantMessageId: activeMessageId });
    const result = store.softDeleteThread(threadId);
    emit({ type: 'thread-list-changed' });
    return result;
  }

  async function selectAttachments(input) {
    const result = await attachmentService.selectAttachments(input);
    emit({ type: 'thread-list-changed' });
    return result;
  }

  async function createTextAttachment(input) {
    const result = await attachmentService.createTextAttachment(input);
    emit({ type: 'thread-list-changed' });
    return result;
  }

  async function removeAttachment(input) {
    const result = await attachmentService.removeAttachment(input);
    emit({ type: 'thread-list-changed' });
    return result;
  }

  async function loadReadyAttachments(threadId) {
    const attachments = store.listReadyAttachments(threadId, true);
    return Promise.all(attachments.map(async (attachment) => {
      const markdownPath = path.resolve(attachment.markdownPath);
      if (markdownPath !== rootDir && !markdownPath.startsWith(`${rootDir}${path.sep}`)) {
        throw conversationError('ATTACHMENT_NOT_READY', '附件解析内容不在当前会话工作区。');
      }
      return { ...attachment, contentMarkdown: await fs.readFile(markdownPath, 'utf8') };
    }));
  }

  function normalizeMessageContent(content, attachments) {
    const text = String(content || '');
    if (visibleLength(text) > 10000) {
      throw conversationError('CONVERSATION_MESSAGE_EMPTY', '输入内容超过 10000 个字符，请等待系统转换为 TXT 附件。');
    }
    if (text.trim()) return text;
    if (!attachments.length) throw conversationError('CONVERSATION_MESSAGE_EMPTY', '请输入问题或添加附件。');
    return attachments.some((item) => item.source === 'composer-overflow-text')
      ? '请阅读自动转换的超长文本附件，并按其中的内容和要求处理。'
      : '请阅读附件并概括主要内容。';
  }

  async function buildRunInput(threadId, currentMessage) {
    const attachments = await loadReadyAttachments(threadId);
    const config = configStore.load();
    return buildConversationWorkspace({
      messages: store.listMessages(threadId),
      currentMessage,
      attachments,
      contextLengthLimit: config.context_length_limit,
    });
  }

  async function runAgent(threadId, assistantMessage, currentMessage) {
    const controller = new AbortController();
    const messageId = assistantMessage.messageId;
    activeControllers.set(messageId, controller);
    activeTasksByThread.set(threadId, messageId);
    streamBuffers.set(messageId, '');
    emit({ type: 'message-queued', threadId, messageId });
    let started = false;

    try {
      const runInput = await buildRunInput(threadId, currentMessage);
      let result = null;
      let lastReasoningError = null;
      for (const thinkingLevel of ['high', 'medium', 'low', 'minimal']) {
        try {
          result = await agentService.runTask({
            mode: 'conversation',
            requested_thinking_level: thinkingLevel,
            archive_workspace: false,
            task_id: assistantMessage.taskId,
            title: 'Jato Agent 对话',
            prompt: runInput.prompt,
            session_instructions: CONVERSATION_SYSTEM_INSTRUCTION,
            files: runInput.files,
            max_retries: 0,
            signal: controller.signal,
            onActivity(event) {
              if (!started && event.stage !== 'queued') {
                started = true;
                store.updateAssistantStatus(messageId, 'streaming');
                emit({ type: 'message-start', threadId, messageId });
              }
            },
            onEvent(event) {
              if (event.type !== 'assistant_delta') return;
              const delta = String(event.delta || '');
              streamBuffers.set(messageId, `${streamBuffers.get(messageId) || ''}${delta}`);
              emit({ type: 'message-delta', threadId, messageId, delta });
            },
          });
          break;
        } catch (error) {
          if (isAbort(error, controller.signal) || !isReasoningUnsupported(error)) throw error;
          lastReasoningError = error;
        }
      }
      if (!result) throw lastReasoningError || conversationError('CONVERSATION_REASONING_UNSUPPORTED', '当前文本模型不支持对话智能体所需的推理能力，请在设置中更换可用模型。');
      const content = String(result.assistant_text || streamBuffers.get(messageId) || '').trim();
      store.completeAssistantMessage(messageId, content);
      emit({ type: 'message-complete', threadId, messageId, contentMarkdown: content });
      emit({ type: 'thread-list-changed' });
    } catch (error) {
      const partial = streamBuffers.get(messageId) || '';
      if (isAbort(error, controller.signal)) {
        store.cancelAssistantMessage(messageId, partial);
        emit({ type: 'message-canceled', threadId, messageId, contentMarkdown: partial });
      } else {
        const reasoningUnsupported = isReasoningUnsupported(error);
        const code = reasoningUnsupported ? 'CONVERSATION_REASONING_UNSUPPORTED' : 'CONVERSATION_AGENT_FAILED';
        const message = reasoningUnsupported
          ? '当前文本模型不支持对话智能体所需的推理能力，请在设置中更换可用模型。'
          : 'Jato Agent 生成失败，请重试。';
        store.failAssistantMessage(messageId, partial, code, message);
        emit({ type: 'message-error', threadId, messageId, errorCode: code, message, ...(partial ? { partialContent: partial } : {}) });
      }
      emit({ type: 'thread-list-changed' });
    } finally {
      activeControllers.delete(messageId);
      activeTasksByThread.delete(threadId);
      streamBuffers.delete(messageId);
    }
  }

  async function sendMessage({ threadId, content = '', attachmentIds = [], source = 'manual', parentMessageId }) {
    store.getThread(threadId);
    ensureNoActiveTask(threadId);
    const selected = store.getAttachmentsByIds(threadId, attachmentIds);
    if (selected.length !== new Set(attachmentIds).size || selected.some((item) => item.status !== 'ready' || item.originMessageId)) {
      throw conversationError('ATTACHMENT_NOT_READY', '附件尚未解析完成，请稍候。');
    }
    const normalizedContent = normalizeMessageContent(content, selected);
    const taskId = crypto.randomUUID();
    const created = store.createUserAndAssistantPlaceholder({
      threadId,
      content: normalizedContent,
      attachmentIds,
      source,
      parentMessageId,
      taskId,
    });
    store.autoTitleThread(threadId, normalizedContent);
    emit({ type: 'thread-list-changed' });
    void runAgent(threadId, created.assistantMessage, created.userMessage);
    return created;
  }

  async function cancelMessage({ threadId, assistantMessageId }) {
    if (activeTasksByThread.get(threadId) !== assistantMessageId) return { success: true };
    activeControllers.get(assistantMessageId)?.abort(new Error('用户已停止生成'));
    return { success: true };
  }

  async function regenerateMessage({ threadId, assistantMessageId }) {
    ensureNoActiveTask(threadId);
    const target = store.getMessage(assistantMessageId);
    if (!target || target.threadId !== threadId || target.role !== 'assistant' || !target.parentMessageId) {
      throw conversationError('CONVERSATION_AGENT_FAILED', '无法重新生成该回答。');
    }
    const userMessage = store.getMessage(target.parentMessageId);
    const assistantMessage = store.createAssistantPlaceholder({
      threadId,
      parentMessageId: userMessage.messageId,
      taskId: crypto.randomUUID(),
    });
    emit({ type: 'thread-list-changed' });
    void runAgent(threadId, assistantMessage, userMessage);
    return { userMessage, assistantMessage };
  }

  function applyQuickAction({ threadId, assistantMessageId, action }) {
    const target = store.getMessage(assistantMessageId);
    if (!target || target.threadId !== threadId || target.role !== 'assistant' || !target.contentMarkdown) {
      throw conversationError('CONVERSATION_AGENT_FAILED', '无法对该回答执行快捷操作。');
    }
    const content = QUICK_ACTION_PROMPTS[action];
    if (!content) throw conversationError('CONVERSATION_AGENT_FAILED', '未知快捷操作。');
    return sendMessage({ threadId, content, attachmentIds: [], source: 'quick-action', parentMessageId: assistantMessageId });
  }

  async function exportMessageWord({ threadId, assistantMessageId }) {
    const message = store.getMessage(assistantMessageId);
    if (!message || message.threadId !== threadId || message.role !== 'assistant'
      || !['completed', 'canceled'].includes(message.status) || !message.contentMarkdown.trim()) {
      throw conversationError('WORD_EXPORT_INVALID_MESSAGE', '只能导出已有内容的 Jato Agent 回答。');
    }
    const thread = store.getThread(threadId);
    try {
      return await exportService.exportStandaloneMarkdownWord({ title: thread.title, markdown: message.contentMarkdown });
    } catch {
      throw conversationError('WORD_EXPORT_FAILED', 'Word 导出失败，请重试。');
    }
  }

  async function close() {
    for (const controller of activeControllers.values()) controller.abort(new Error('客户端正在关闭'));
    listeners.clear();
  }

  store.recoverInterruptedMessages();
  void attachmentService.cleanupExpiredAttachments().catch(() => undefined);

  return {
    listThreads,
    createThread,
    getThread,
    renameThread,
    deleteThread,
    selectAttachments,
    createTextAttachment,
    removeAttachment,
    sendMessage,
    cancelMessage,
    regenerateMessage,
    applyQuickAction,
    exportMessageWord,
    onEvent,
    emitEvent: emit,
    close,
  };
}

module.exports = { createConversationService, conversationError, isReasoningUnsupported };
