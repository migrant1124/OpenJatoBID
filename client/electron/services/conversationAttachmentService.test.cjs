const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

function loadService(electronMock = { dialog: {} }, fileServiceMock) {
  const modulePath = path.join(__dirname, 'conversationAttachmentService.cjs');
  delete require.cache[require.resolve(modulePath)];
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    if (request === './fileService.cjs' && fileServiceMock) return fileServiceMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(modulePath); } finally { Module._load = originalLoad; }
}

test('10001 visible characters become one exact UTF-8 ready TXT attachment', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-attachment-'));
  const created = [];
  let draftAttachments = [];
  const store = {
    getThread: () => ({}), listThreadAttachments: () => draftAttachments, hasActiveFileName: () => false, listCleanupTargets: () => [],
    createTextAttachment(input) { created.push(input); return { attachmentId: input.attachmentId, threadId: input.threadId, fileName: input.fileName, source: input.source, status: input.status, progress: input.progress, sizeBytes: input.sizeBytes, markdownChars: input.markdownChars, createdAt: '', updatedAt: '', extension: '.txt', sha256: input.sha256 }; },
  };
  const { createConversationAttachmentService, resolveAttachmentDirectory } = loadService();
  const service = createConversationAttachmentService({ app: { getPath: () => tempDir }, configStore: {}, store });
  const content = '中'.repeat(10001);
  await assert.rejects(() => service.createTextAttachment({ threadId: 'thread-1', content: content.slice(1), existingDraftAttachmentIds: [] }), { code: 'CONVERSATION_TEXT_CONVERSION_FAILED' });
  draftAttachments = Array.from({ length: 5 }, () => ({ status: 'ready', sizeBytes: 1 }));
  await assert.rejects(() => service.createTextAttachment({ threadId: 'thread-1', content, existingDraftAttachmentIds: ['1', '2', '3', '4', '5'] }), { code: 'CONVERSATION_TEXT_ATTACHMENT_SLOT_REQUIRED' });
  draftAttachments = [];
  const result = await service.createTextAttachment({ threadId: 'thread-1', content, existingDraftAttachmentIds: [] });
  assert.equal(result.attachment.status, 'ready');
  assert.equal(fs.readFileSync(created[0].storedFilePath, 'utf8'), content);
  assert.equal(created[0].markdownChars, 10001);
  assert.equal(resolveAttachmentDirectory(tempDir, {
    thread_id: 'thread-1', attachment_id: 'a1', stored_file_path: path.join(tempDir, 'threads', 'thread-1', 'attachments', 'a1', 'original', 'file.txt'),
  }), path.join(tempDir, 'threads', 'thread-1', 'attachments', 'a1'));
  assert.throws(() => resolveAttachmentDirectory(tempDir, {
    thread_id: 'thread-1', attachment_id: 'a1', stored_file_path: path.join(tempDir, '..', 'outside', 'original', 'file.txt'),
  }), { code: 'ATTACHMENT_PATH_INVALID' });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('attachment selection prevalidates the whole batch and returns visible placeholders before serial parsing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-selection-'));
  const source = path.join(tempDir, '材料.txt');
  fs.writeFileSync(source, '材料', 'utf8');
  let releaseParse;
  const parsePending = new Promise((resolve) => { releaseParse = resolve; });
  const records = new Map();
  const events = [];
  const store = {
    getThread: () => ({}), getAttachmentsByIds: () => [], listThreadAttachments: () => [],
    createAttachment(input) { const value = { ...input, createdAt: '', updatedAt: '' }; records.set(input.attachmentId, value); return value; },
    updateAttachment(id, partial) { const value = { ...records.get(id), ...partial }; records.set(id, value); return value; },
  };
  const { createConversationAttachmentService } = loadService(
    { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [source] }) } },
    { resolveFileParser: () => ({ supported: true, provider: 'local' }), parseDocumentWithConfig: async () => parsePending },
  );
  const service = createConversationAttachmentService({ app: { getPath: () => tempDir }, configStore: { load: () => ({}) }, store, emitEvent: (event) => events.push(event) });
  const result = await service.selectAttachments({ threadId: 'thread-1', existingDraftAttachmentIds: [] });
  assert.equal(result.attachments[0].status, 'selected');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.some((event) => event.status === 'copying' || event.status === 'parsing'), true);
  releaseParse('# 解析结果');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(records.get(result.attachments[0].attachmentId).status, 'ready');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('six selected attachments are rejected before any metadata or copy is created', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-selection-limit-'));
  const files = Array.from({ length: 6 }, (_, index) => {
    const file = path.join(tempDir, `${index}.txt`);
    fs.writeFileSync(file, String(index), 'utf8');
    return file;
  });
  let created = 0;
  const store = {
    getThread: () => ({}), getAttachmentsByIds: () => [], listThreadAttachments: () => [],
    createAttachment() { created += 1; },
  };
  const { createConversationAttachmentService } = loadService(
    { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: files }) } },
    { resolveFileParser: () => ({ supported: true, provider: 'local' }), parseDocumentWithConfig: async () => '# 不应解析' },
  );
  const service = createConversationAttachmentService({ app: { getPath: () => tempDir }, configStore: { load: () => ({}) }, store });
  const result = await service.selectAttachments({ threadId: 'thread-1', existingDraftAttachmentIds: [] });
  assert.equal(result.success, false);
  assert.equal(result.errors.at(-1).code, 'ATTACHMENT_TOO_MANY');
  assert.equal(created, 0);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('attachment errors exposed to Renderer never include source paths', () => {
  const { publicSelectionError, publicProcessingError } = loadService();
  const secret = new Error('ENOENT: no such file, open D:\\private\\投标文件.docx');
  secret.code = 'ENOENT';
  assert.equal(publicSelectionError(secret), '无法读取所选附件，请确认文件仍存在且可访问。');
  assert.equal(publicProcessingError('copying').includes('D:\\private'), false);
  assert.equal(publicProcessingError('parsing').includes('D:\\private'), false);
});

test('common image formats are normalized for multimodal requests without document parsing', async () => {
  const { IMAGE_MIME_TYPES, normalizeImageForModel } = loadService();
  const result = await normalizeImageForModel(path.join(__dirname, '..', '..', 'assets', 'icon_16.png'), 'image/png');
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...IMAGE_MIME_TYPES.keys()], ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
});
