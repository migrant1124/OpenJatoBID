const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { dialog } = require('electron');
const { parseDocumentWithConfig, resolveFileParser } = require('./fileService.cjs');

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

const parserLabels = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicSelectionError(error) {
  if (String(error?.code || '').startsWith('ATTACHMENT_')) return error.message;
  return '无法读取所选附件，请确认文件仍存在且可访问。';
}

function publicProcessingError(stage) {
  return stage === 'copying'
    ? '附件复制失败，请移除后重新选择。'
    : '附件解析失败，请检查文件内容或解析设置。';
}

function safeFileName(value) {
  return String(value || '附件')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || '附件';
}

function visibleLength(value) {
  const text = String(value || '');
  try {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].length;
  } catch {
    return Array.from(text).length;
  }
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function resolveAttachmentDirectory(rootDir, target) {
  const expected = path.resolve(rootDir, 'threads', target.thread_id, 'attachments', target.attachment_id);
  const actual = path.resolve(path.dirname(path.dirname(target.stored_file_path)));
  if (actual !== expected) throw createError('ATTACHMENT_PATH_INVALID', '附件目录不在当前对话工作区。');
  return actual;
}

function createConversationAttachmentService({ app, configStore, store, emitEvent = () => {} }) {
  const rootDir = path.join(app.getPath('userData'), 'workspace', 'conversation');

  function emit(attachment, message) {
    emitEvent({
      type: 'attachment-progress',
      threadId: attachment.threadId,
      attachmentId: attachment.attachmentId,
      status: attachment.status,
      progress: attachment.progress,
      message,
    });
  }

  function draftState(threadId) {
    const attachments = store.listThreadAttachments(threadId, false).filter((item) => !item.originMessageId);
    return {
      count: attachments.filter((item) => item.status !== 'removed').length,
      totalBytes: attachments.filter((item) => item.status !== 'removed').reduce((sum, item) => sum + item.sizeBytes, 0),
    };
  }

  function attachmentPaths(threadId, attachmentId, fileName) {
    const directory = path.join(rootDir, 'threads', threadId, 'attachments', attachmentId);
    return {
      directory,
      originalPath: path.join(directory, 'original', safeFileName(fileName)),
      markdownPath: path.join(directory, 'parsed', 'content.md'),
    };
  }

  async function prepareSelectedFile(threadId, filePath, config) {
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) throw createError('ATTACHMENT_FILE_TOO_LARGE', '单个附件不能超过 200MB。');
    const parser = resolveFileParser(config, filePath);
    if (!parser.supported) throw createError('ATTACHMENT_UNSUPPORTED', '当前文件解析方式不支持该格式。');
    const sha256 = await sha256File(filePath);
    const attachmentId = crypto.randomUUID();
    const fileName = path.basename(filePath);
    const paths = attachmentPaths(threadId, attachmentId, fileName);
    return { attachmentId, threadId, filePath, fileName, stat, parser, sha256, paths };
  }

  async function processSelectedFile(prepared, config) {
    const { attachmentId, threadId, filePath, paths } = prepared;
    let stage = 'copying';
    let attachment = store.updateAttachment(attachmentId, { status: 'copying', progress: 10 });
    if (attachment.status === 'removed') return attachment;
    emit(attachment, '正在复制');

    try {
      await fsp.mkdir(path.dirname(paths.originalPath), { recursive: true });
      await fsp.copyFile(filePath, paths.originalPath);
      attachment = store.updateAttachment(attachmentId, { status: 'parsing', progress: 35 });
      stage = 'parsing';
      if (attachment.status === 'removed') return attachment;
      emit(attachment, '正在解析');
      const markdown = await parseDocumentWithConfig(app, paths.originalPath, config, {
        preserveImages: false,
        assetScope: `conversation-${threadId}-${attachmentId}`,
        suppressFileIdentity: true,
        onProgress: (progress) => {
          const raw = typeof progress === 'object' ? progress?.progress ?? progress?.percent : progress;
          const numeric = Number(raw || 0);
          const value = Math.max(35, Math.min(90, 35 + Math.round((Number.isFinite(numeric) ? numeric : 0) * 0.55)));
          attachment = store.updateAttachment(attachmentId, { progress: value });
          if (attachment.status !== 'removed') emit(attachment, '正在解析');
        },
      });
      if (!String(markdown || '').trim()) throw new Error('未提取到有效 Markdown 内容，请检查文件内容。');
      await fsp.mkdir(path.dirname(paths.markdownPath), { recursive: true });
      await fsp.writeFile(paths.markdownPath, markdown, 'utf8');
      attachment = store.updateAttachment(attachmentId, {
        status: 'ready', progress: 100, markdownChars: visibleLength(markdown), error: null,
      });
      if (attachment.status !== 'removed') emit(attachment, '解析完成');
      return attachment;
    } catch (error) {
      attachment = store.updateAttachment(attachmentId, {
        status: 'error', progress: 0, error: publicProcessingError(stage),
      });
      if (attachment.status !== 'removed') emit(attachment, '解析失败');
      return attachment;
    }
  }

  async function selectAttachments({ threadId, existingDraftAttachmentIds = [] }) {
    store.getThread(threadId);
    const config = configStore.load();
    const provider = config.file_parser?.provider || 'local';
    const result = await dialog.showOpenDialog({
      title: '选择对话附件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: parserLabels[provider] || '支持的文档', extensions: ['txt', 'md', 'markdown', 'doc', 'docx', 'wps', 'pdf', 'xls', 'xlsx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true, attachments: [], errors: [] };

    const draft = draftState(threadId);
    const activeHashes = new Set(store.listThreadAttachments(threadId, false).map((item) => item.sha256));
    const preparedFiles = [];
    const errors = [];
    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath);
      try {
        const prepared = await prepareSelectedFile(threadId, filePath, config);
        if (activeHashes.has(prepared.sha256)) throw createError('ATTACHMENT_DUPLICATE', '该文件已存在于当前会话中，无需重复上传。');
        activeHashes.add(prepared.sha256);
        preparedFiles.push(prepared);
      } catch (error) {
        errors.push({ fileName, code: error?.code || 'ATTACHMENT_READ_FAILED', message: publicSelectionError(error) });
      }
    }
    if (draft.count + preparedFiles.length > MAX_ATTACHMENTS) {
      return { success: false, attachments: [], errors: [...errors, { fileName: '本次选择', code: 'ATTACHMENT_TOO_MANY', message: '每次最多选择 5 个附件。' }] };
    }
    if (draft.totalBytes + preparedFiles.reduce((sum, item) => sum + item.stat.size, 0) > MAX_TOTAL_BYTES) {
      return { success: false, attachments: [], errors: [...errors, { fileName: '本次选择', code: 'ATTACHMENT_TOTAL_TOO_LARGE', message: '本次附件总大小不能超过 500MB。' }] };
    }
    const attachments = preparedFiles.map((prepared) => store.createAttachment({
      attachmentId: prepared.attachmentId,
      threadId,
      source: 'selected-file',
      fileName: prepared.fileName,
      extension: path.extname(prepared.filePath).toLowerCase(),
      sizeBytes: prepared.stat.size,
      sha256: prepared.sha256,
      storedFilePath: prepared.paths.originalPath,
      markdownPath: prepared.paths.markdownPath,
      parserProvider: prepared.parser.provider,
      parserLabel: parserLabels[prepared.parser.provider] || '本地解析',
      status: 'selected',
      progress: 0,
    }));
    setTimeout(() => {
      void (async () => {
        for (const prepared of preparedFiles) await processSelectedFile(prepared, config);
      })();
    }, 0);
    return { success: attachments.length > 0, attachments, errors };
  }

  async function createTextAttachment({ threadId, content, existingDraftAttachmentIds = [] }) {
    store.getThread(threadId);
    const source = String(content || '');
    if (visibleLength(source) <= 10000) throw createError('CONVERSATION_TEXT_CONVERSION_FAILED', '仅超过 10000 个字符的文本可自动转换为附件。');
    const draft = draftState(threadId);
    if (draft.count >= MAX_ATTACHMENTS) {
      throw createError('CONVERSATION_TEXT_ATTACHMENT_SLOT_REQUIRED', '当前已有 5 个待发送附件，无法将超长文本转换为 TXT，请先移除一个附件。');
    }
    const buffer = Buffer.from(source, 'utf8');
    if (buffer.length > MAX_FILE_BYTES) throw createError('ATTACHMENT_FILE_TOO_LARGE', '单个附件不能超过 200MB。');
    if (draft.totalBytes + buffer.length > MAX_TOTAL_BYTES) throw createError('ATTACHMENT_TOTAL_TOO_LARGE', '本次附件总大小不能超过 500MB。');

    const attachmentId = crypto.randomUUID();
    const baseName = `超长文本_${timestamp()}.txt`;
    const fileName = store.hasActiveFileName(threadId, baseName)
      ? baseName.replace(/\.txt$/, `_${attachmentId.slice(0, 6)}.txt`)
      : baseName;
    const paths = attachmentPaths(threadId, attachmentId, fileName);
    const tempDir = path.join(rootDir, '.tmp');
    const tempPath = path.join(tempDir, `${attachmentId}.txt`);
    await fsp.mkdir(tempDir, { recursive: true });
    let moved = false;
    try {
      const handle = await fsp.open(tempPath, 'wx');
      try {
        await handle.writeFile(buffer);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsp.mkdir(path.dirname(paths.originalPath), { recursive: true });
      await fsp.rename(tempPath, paths.originalPath);
      moved = true;
      const attachment = store.createTextAttachment({
        attachmentId,
        threadId,
        source: 'composer-overflow-text',
        fileName,
        extension: '.txt',
        mimeType: 'text/plain; charset=utf-8',
        sizeBytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        storedFilePath: paths.originalPath,
        markdownPath: paths.originalPath,
        markdownChars: visibleLength(source),
        parserProvider: 'internal-text',
        parserLabel: '输入文本自动转换',
        status: 'ready',
        progress: 100,
      });
      emit(attachment, '转换完成');
      return { success: true, attachment };
    } catch (error) {
      if (moved) await fsp.rm(paths.directory, { recursive: true, force: true }).catch(() => undefined);
      await fsp.rm(tempPath, { force: true }).catch(() => undefined);
      if (error?.code?.startsWith?.('CONVERSATION_') || error?.code?.startsWith?.('ATTACHMENT_')) throw error;
      throw createError('CONVERSATION_TEXT_CONVERSION_FAILED', '超长文本转换为 TXT 附件失败，原输入内容已保留，请重试。');
    }
  }

  async function removeAttachment({ threadId, attachmentId }) {
    const attachment = store.getAttachment(attachmentId, true);
    if (!attachment || attachment.threadId !== threadId) throw new Error('附件不存在。');
    store.removeAttachment(threadId, attachmentId);
    return { success: true };
  }

  async function cleanupExpiredAttachments() {
    for (const target of store.listCleanupTargets()) {
      let attachmentDir;
      try {
        attachmentDir = resolveAttachmentDirectory(rootDir, target);
      } catch (error) {
        console.warn('[conversation] 拒绝清理越界附件目录', { attachmentId: target.attachment_id, code: error?.code || '', name: error?.name || '' });
        continue;
      }
      await fsp.rm(attachmentDir, { recursive: true, force: true }).catch((error) => {
        console.warn('[conversation] 过期附件目录清理失败', { attachmentId: target.attachment_id, code: error?.code || '', name: error?.name || '' });
      });
    }
  }

  return { selectAttachments, createTextAttachment, removeAttachment, cleanupExpiredAttachments, visibleLength };
}

module.exports = {
  createConversationAttachmentService,
  visibleLength,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  resolveAttachmentDirectory,
  publicSelectionError,
  publicProcessingError,
};
