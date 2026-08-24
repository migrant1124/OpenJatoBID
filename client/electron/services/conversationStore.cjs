const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function compactPreview(value, length = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function toThread(row) {
  if (!row) return null;
  return {
    threadId: row.thread_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    lastMessagePreview: row.last_message_preview || '',
    messageCount: Number(row.message_count || 0),
    attachmentCount: Number(row.attachment_count || 0),
  };
}

function toMessage(row) {
  if (!row) return null;
  return {
    messageId: row.message_id,
    threadId: row.thread_id,
    role: row.role,
    contentMarkdown: row.content_markdown || '',
    status: row.status,
    source: row.source,
    ...(row.parent_message_id ? { parentMessageId: row.parent_message_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    sequence: Number(row.sequence),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttachment(row, includePaths = false) {
  if (!row) return null;
  const result = {
    attachmentId: row.attachment_id,
    threadId: row.thread_id,
    ...(row.origin_message_id ? { originMessageId: row.origin_message_id } : {}),
    source: row.source,
    fileName: row.file_name,
    extension: row.extension,
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256,
    ...(row.parser_provider ? { parserProvider: row.parser_provider } : {}),
    ...(row.parser_label ? { parserLabel: row.parser_label } : {}),
    markdownChars: Number(row.markdown_chars || 0),
    status: row.status,
    progress: Number(row.progress || 0),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includePaths) {
    result.storedFilePath = row.stored_file_path;
    result.markdownPath = row.markdown_path || '';
  }
  return result;
}

function createConversationStore({ db }) {
  const threadSelect = `
    SELECT t.*,
      (SELECT content_markdown FROM conversation_messages m
       WHERE m.thread_id = t.thread_id AND m.status != 'error'
       ORDER BY m.sequence DESC LIMIT 1) AS last_message_preview,
      (SELECT COUNT(*) FROM conversation_messages m WHERE m.thread_id = t.thread_id) AS message_count,
      (SELECT COUNT(*) FROM conversation_attachments a
       WHERE a.thread_id = t.thread_id AND a.status != 'removed') AS attachment_count
    FROM conversation_threads t`;

  function requireThread(threadId) {
    const row = db.prepare('SELECT * FROM conversation_threads WHERE thread_id = ? AND status = ?').get(threadId, 'active');
    if (!row) {
      const error = new Error('当前会话不存在或已删除。');
      error.code = 'CONVERSATION_THREAD_NOT_FOUND';
      throw error;
    }
    return row;
  }

  function listThreads(query = '') {
    const normalized = String(query || '').trim();
    const rows = normalized
      ? db.prepare(`${threadSelect} WHERE t.status = 'active' AND t.title LIKE ? ORDER BY t.updated_at DESC`).all(`%${normalized}%`)
      : db.prepare(`${threadSelect} WHERE t.status = 'active' ORDER BY t.updated_at DESC`).all();
    return rows.map((row) => ({ ...toThread(row), lastMessagePreview: compactPreview(row.last_message_preview) }));
  }

  function getThreadRecord(threadId) {
    requireThread(threadId);
    return toThread(db.prepare(`${threadSelect} WHERE t.thread_id = ?`).get(threadId));
  }

  function createThread() {
    const threadId = crypto.randomUUID();
    const at = nowIso();
    db.prepare(`INSERT INTO conversation_threads
      (thread_id, title, status, created_at, updated_at) VALUES (?, '新对话', 'active', ?, ?)`
    ).run(threadId, at, at);
    return getThreadRecord(threadId);
  }

  function renameThread(threadId, title) {
    requireThread(threadId);
    const normalized = String(title || '').trim();
    if (!normalized || normalized.length > 80) throw new Error('会话标题应为 1–80 个字符。');
    db.prepare('UPDATE conversation_threads SET title = ?, title_locked = 1, updated_at = ? WHERE thread_id = ?').run(normalized, nowIso(), threadId);
    return getThreadRecord(threadId);
  }

  function autoTitleThread(threadId, content) {
    const normalized = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 20).replace(/[，。！？、；：,.!?;:]$/u, '') || '新对话';
    db.prepare('UPDATE conversation_threads SET title = ?, title_locked = 1, updated_at = ? WHERE thread_id = ? AND title_locked = 0')
      .run(normalized, nowIso(), threadId);
    return getThreadRecord(threadId);
  }

  function softDeleteThread(threadId) {
    requireThread(threadId);
    const at = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE conversation_threads SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE thread_id = ?")
        .run(at, at, threadId);
    })();
    return { success: true };
  }

  function listMessages(threadId) {
    requireThread(threadId);
    return db.prepare('SELECT * FROM conversation_messages WHERE thread_id = ? ORDER BY sequence').all(threadId).map(toMessage);
  }

  function getMessage(messageId, includePrivate = false) {
    const row = db.prepare('SELECT * FROM conversation_messages WHERE message_id = ?').get(messageId);
    if (!row) return null;
    return includePrivate ? row : toMessage(row);
  }

  function nextSequence(threadId) {
    return Number(db.prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM conversation_messages WHERE thread_id = ?').get(threadId)?.value || 0) + 1;
  }

  const createUserAndAssistantPlaceholder = db.transaction((input) => {
    requireThread(input.threadId);
    const at = nowIso();
    const sequence = nextSequence(input.threadId);
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    db.prepare(`INSERT INTO conversation_messages
      (message_id, thread_id, role, content_markdown, status, source, parent_message_id, sequence, created_at, updated_at)
      VALUES (?, ?, 'user', ?, 'completed', ?, ?, ?, ?, ?)`
    ).run(userMessageId, input.threadId, input.content, input.source || 'manual', input.parentMessageId || null, sequence, at, at);
    db.prepare(`INSERT INTO conversation_messages
      (message_id, thread_id, role, content_markdown, status, source, parent_message_id, task_id, runtime_id, sequence, created_at, updated_at)
      VALUES (?, ?, 'assistant', '', 'queued', ?, ?, ?, 'pi', ?, ?, ?)`
    ).run(assistantMessageId, input.threadId, input.source || 'manual', userMessageId, input.taskId, sequence + 1, at, at);
    if (input.attachmentIds?.length) {
      const bind = db.prepare(`UPDATE conversation_attachments SET origin_message_id = ?, updated_at = ?
        WHERE attachment_id = ? AND thread_id = ? AND status = 'ready' AND origin_message_id IS NULL`);
      for (const attachmentId of input.attachmentIds) {
        if (bind.run(userMessageId, at, attachmentId, input.threadId).changes !== 1) throw new Error('附件尚未准备完成或不属于当前会话。');
      }
    }
    db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?').run(at, input.threadId);
    return { userMessage: getMessage(userMessageId), assistantMessage: getMessage(assistantMessageId) };
  });

  const createAssistantPlaceholder = db.transaction((input) => {
    requireThread(input.threadId);
    const at = nowIso();
    const messageId = crypto.randomUUID();
    db.prepare(`INSERT INTO conversation_messages
      (message_id, thread_id, role, content_markdown, status, source, parent_message_id, task_id, runtime_id, sequence, created_at, updated_at)
      VALUES (?, ?, 'assistant', '', 'queued', 'regenerate', ?, ?, 'pi', ?, ?, ?)`
    ).run(messageId, input.threadId, input.parentMessageId, input.taskId, nextSequence(input.threadId), at, at);
    db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?').run(at, input.threadId);
    return getMessage(messageId);
  });

  function updateAssistantStatus(messageId, status) {
    db.prepare("UPDATE conversation_messages SET status = ?, updated_at = ? WHERE message_id = ? AND role = 'assistant'")
      .run(status, nowIso(), messageId);
    return getMessage(messageId);
  }

  function finishAssistantMessage(messageId, status, content, errorCode, errorMessage) {
    const message = getMessage(messageId, true);
    if (!message || message.role !== 'assistant') throw new Error('Jato Agent 消息不存在。');
    const at = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE conversation_messages SET status = ?, content_markdown = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE message_id = ?`).run(status, String(content || ''), errorCode || null, errorMessage || null, at, messageId);
      db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?').run(at, message.thread_id);
    })();
    return getMessage(messageId);
  }

  function createAttachment(input) {
    requireThread(input.threadId);
    const at = nowIso();
    const attachmentId = input.attachmentId || crypto.randomUUID();
    db.transaction(() => {
      db.prepare(`INSERT INTO conversation_attachments
        (attachment_id, thread_id, origin_message_id, source, file_name, extension, mime_type, size_bytes, sha256,
         stored_file_path, markdown_path, markdown_chars, parser_provider, parser_label, status, progress, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        attachmentId, input.threadId, input.originMessageId || null, input.source || 'selected-file', input.fileName,
        input.extension, input.mimeType || null, input.sizeBytes, input.sha256, input.storedFilePath,
        input.markdownPath || null, input.markdownChars || 0, input.parserProvider || null, input.parserLabel || null,
        input.status || 'selected', input.progress || 0, input.error || null, at, at,
      );
      db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?').run(at, input.threadId);
    })();
    return getAttachment(attachmentId);
  }

  function updateAttachment(attachmentId, partial) {
    const existing = getAttachment(attachmentId, true);
    if (!existing) throw new Error('附件不存在。');
    if (existing.status === 'removed' && partial.status !== 'removed') return toAttachment(existing);
    const fields = {
      status: 'status', progress: 'progress', error: 'error', markdownPath: 'markdown_path', markdownChars: 'markdown_chars',
      parserProvider: 'parser_provider', parserLabel: 'parser_label', originMessageId: 'origin_message_id',
    };
    const entries = Object.entries(fields).filter(([key]) => Object.prototype.hasOwnProperty.call(partial, key));
    if (!entries.length) return toAttachment(existing);
    const at = nowIso();
    const assignments = entries.map(([, column]) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE conversation_attachments SET ${assignments}, updated_at = ? WHERE attachment_id = ?`)
      .run(...entries.map(([key]) => partial[key]), at, attachmentId);
    db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?').run(at, existing.thread_id);
    return getAttachment(attachmentId);
  }

  function getAttachment(attachmentId, includePaths = false) {
    return toAttachment(db.prepare('SELECT * FROM conversation_attachments WHERE attachment_id = ?').get(attachmentId), includePaths);
  }

  function listThreadAttachments(threadId, includeRemoved = true, includePaths = false) {
    requireThread(threadId);
    const rows = includeRemoved
      ? db.prepare('SELECT * FROM conversation_attachments WHERE thread_id = ? ORDER BY created_at').all(threadId)
      : db.prepare("SELECT * FROM conversation_attachments WHERE thread_id = ? AND status != 'removed' ORDER BY created_at").all(threadId);
    return rows.map((row) => toAttachment(row, includePaths));
  }

  function getAttachmentsByIds(threadId, attachmentIds, includePaths = false) {
    if (!attachmentIds?.length) return [];
    const placeholders = attachmentIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM conversation_attachments WHERE thread_id = ? AND attachment_id IN (${placeholders})`)
      .all(threadId, ...attachmentIds).map((row) => toAttachment(row, includePaths));
  }

  function listReadyAttachments(threadId, includePaths = false) {
    return db.prepare("SELECT * FROM conversation_attachments WHERE thread_id = ? AND status = 'ready' ORDER BY created_at")
      .all(threadId).map((row) => toAttachment(row, includePaths));
  }

  function removeAttachment(threadId, attachmentId) {
    requireThread(threadId);
    const at = nowIso();
    const result = db.prepare("UPDATE conversation_attachments SET status = 'removed', progress = 0, updated_at = ? WHERE thread_id = ? AND attachment_id = ? AND status != 'removed'")
      .run(at, threadId, attachmentId);
    if (!result.changes) throw new Error('附件不存在或已移除。');
    db.prepare('UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?').run(at, threadId);
    return { success: true };
  }

  function hasActiveFileName(threadId, fileName) {
    return Boolean(db.prepare("SELECT 1 FROM conversation_attachments WHERE thread_id = ? AND file_name = ? AND status != 'removed'").get(threadId, fileName));
  }

  function recoverInterruptedMessages() {
    const at = nowIso();
    return db.prepare(`UPDATE conversation_messages
      SET status = 'error', error_code = 'CONVERSATION_INTERRUPTED', error_message = '上次生成因客户端退出而中断，可重新生成。', updated_at = ?
      WHERE role = 'assistant' AND status IN ('pending', 'queued', 'streaming')`).run(at).changes;
  }

  function listCleanupTargets() {
    return db.prepare(`SELECT a.attachment_id, a.thread_id, a.stored_file_path, a.markdown_path
      FROM conversation_attachments a JOIN conversation_threads t ON t.thread_id = a.thread_id
      WHERE (t.status = 'deleted' AND datetime(t.deleted_at) < datetime('now', '-30 days'))
         OR (a.origin_message_id IS NULL AND datetime(a.created_at) < datetime('now', '-1 day'))
         OR (a.status = 'removed' AND datetime(a.updated_at) < datetime('now', '-1 day'))`).all();
  }

  return {
    listThreads,
    createThread,
    getThread: getThreadRecord,
    renameThread,
    autoTitleThread,
    softDeleteThread,
    listMessages,
    getMessage,
    createUserAndAssistantPlaceholder,
    createAssistantPlaceholder,
    updateAssistantStatus,
    completeAssistantMessage: (id, content) => finishAssistantMessage(id, 'completed', content),
    failAssistantMessage: (id, content, code, message) => finishAssistantMessage(id, 'error', content, code, message),
    cancelAssistantMessage: (id, content) => finishAssistantMessage(id, 'canceled', content),
    createAttachment,
    createTextAttachment: createAttachment,
    updateAttachment,
    getAttachment,
    getAttachmentsByIds,
    listThreadAttachments,
    listReadyAttachments,
    removeAttachment,
    hasActiveFileName,
    recoverInterruptedMessages,
    listCleanupTargets,
  };
}

module.exports = { createConversationStore };
