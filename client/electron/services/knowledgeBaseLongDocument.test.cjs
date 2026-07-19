const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const { createAiRequestQueue } = require('../utils/aiRequestQueue.cjs');

let openDialogResult = { canceled: true, filePaths: [] };

function loadKnowledgeBaseModule() {
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
      return { dialog: { showOpenDialog: async () => openDialogResult } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('./knowledgeBaseService.cjs');
  } finally {
    Module._load = originalLoad;
  }
}

const { createKnowledgeBaseService } = loadKnowledgeBaseModule();

function createMemoryStore() {
  const folders = [{ id: 'folder-1', name: '测试知识库' }];
  const documents = new Map();
  const blocksByDocument = new Map();
  const filteredByDocument = new Map();
  const candidatesByDocument = new Map();
  const itemsByDocument = new Map();
  const stepsByDocument = new Map();
  const batchesByDocument = new Map();
  const matchStepHistory = [];

  function steps(documentId) {
    if (!stepsByDocument.has(documentId)) stepsByDocument.set(documentId, new Map());
    return stepsByDocument.get(documentId);
  }

  function batches(documentId) {
    if (!batchesByDocument.has(documentId)) batchesByDocument.set(documentId, new Map());
    return batchesByDocument.get(documentId);
  }

  const store = {
    list() {
      return { folders: [...folders], documents: [...documents.values()] };
    },
    createDocument(document) {
      documents.set(document.id, { ...document });
      return documents.get(document.id);
    },
    getDocument(documentId) {
      return documents.get(documentId);
    },
    updateDocument(documentId, partial) {
      const next = { ...documents.get(documentId), ...partial };
      documents.set(documentId, next);
      return next;
    },
    recoverInterruptedDocuments() {
      return [];
    },
    getDocumentStep(documentId, stepKey) {
      return steps(documentId).get(stepKey) || null;
    },
    saveDocumentStep(documentId, stepKey, fields) {
      const current = steps(documentId).get(stepKey) || {};
      const next = { ...current, ...fields };
      steps(documentId).set(stepKey, next);
      if (stepKey === 'match_batches' && fields.status === 'success') {
        matchStepHistory.push(fields.result);
      }
      return next;
    },
    clearDocumentProcessingFromStep(documentId, stepKey) {
      steps(documentId).delete(stepKey);
      if (stepKey === 'match_batches') batches(documentId).clear();
    },
    updateMarkdownMetadata() {},
    saveBlocks(documentId, blocks, filteredBlocks) {
      blocksByDocument.set(documentId, blocks.map((block) => ({ ...block })));
      filteredByDocument.set(documentId, filteredBlocks.map((block) => ({ ...block })));
    },
    readBlocks(documentId) {
      return blocksByDocument.get(documentId) || [];
    },
    readFilteredBlocks(documentId) {
      return filteredByDocument.get(documentId) || [];
    },
    saveCandidateItems(documentId, items) {
      candidatesByDocument.set(documentId, items.map((item) => ({ ...item })));
    },
    readCandidateItems(documentId) {
      return candidatesByDocument.get(documentId) || [];
    },
    getMatchBatch(documentId, batchIndex) {
      return batches(documentId).get(batchIndex) || null;
    },
    readMatchBatches(documentId) {
      return [...batches(documentId).values()];
    },
    clearMatchBatches(documentId) {
      batches(documentId).clear();
    },
    saveMatchBatch(documentId, batchIndex, fields) {
      const current = batches(documentId).get(batchIndex) || { batch_index: batchIndex };
      const next = {
        ...current,
        batch_index: batchIndex,
        status: fields.status,
        item_ids: Object.hasOwn(fields, 'itemIds') ? fields.itemIds : current.item_ids,
        matches: Object.hasOwn(fields, 'matches') ? fields.matches : current.matches,
        error: fields.error,
      };
      batches(documentId).set(batchIndex, next);
      return next;
    },
    readItems(documentId) {
      return itemsByDocument.get(documentId) || [];
    },
    saveMatchResult(documentId, payload) {
      candidatesByDocument.set(documentId, payload.candidateItems.map((item) => ({ ...item })));
      itemsByDocument.set(documentId, payload.finalItems.map((item) => ({ ...item })));
    },
    getOutlineReferences() {
      return [];
    },
    readMarkdown() {
      return '';
    },
    readAnalysis() {
      return {};
    },
  };

  return {
    store,
    documents,
    blocksByDocument,
    candidatesByDocument,
    itemsByDocument,
    matchStepHistory,
  };
}

function blockIdsFromMessage(message) {
  return [...String(message?.content || '').matchAll(/\[(P\d{6})\]/g)].map((match) => match[1]);
}

function itemIdsFromMessage(message) {
  return [...String(message?.content || '').matchAll(/"id"\s*:\s*"(K\d{6})"/g)].map((match) => match[1]);
}

function firstRoundTitlesFromMessage(message) {
  const match = /<first_round_items>\s*([\s\S]*?)\s*<\/first_round_items>/.exec(String(message?.content || ''));
  if (!match) return [];
  return JSON.parse(match[1]).map((item) => String(item?.title || '')).filter(Boolean);
}

function messagesContentLength(messages) {
  return (messages || []).reduce((sum, message) => (
    sum + String(message?.role || 'user').length + String(message?.content || '').length + 64
  ), 0);
}

function createAiService(contextLengthLimit, calls) {
  return {
    getConfig() {
      return { context_length_limit: contextLengthLimit };
    },
    async collectJsonResponse(options) {
      const prefix = options.messages[0];
      const taskMessage = options.messages[1];
      const task = String(taskMessage?.content || '');
      const blockIds = blockIdsFromMessage(prefix);
      let stage = '';
      let value;

      if (task.includes('投标资料知识库分析助手')) {
        stage = 'initial';
        value = {
          items: Array.from({ length: 4 }, (_, index) => ({
            title: `首轮-${blockIds[0]}-${index + 1}`,
            summary: `首轮摘要-${blockIds[0]}-${index + 1}-` + '甲'.repeat(160),
          })),
        };
      } else if (task.includes('投标资料知识库补漏助手')) {
        stage = 'supplement';
        value = {
          items: Array.from({ length: 3 }, (_, index) => ({
            title: `补充-${blockIds[0]}-${index + 1}`,
            summary: `补充摘要-${blockIds[0]}-${index + 1}-` + '乙'.repeat(160),
          })),
        };
      } else if (task.includes('投标知识库段落匹配助手')) {
        stage = 'match';
        const itemIds = itemIdsFromMessage(taskMessage);
        const matchedBlockIds = blockIds.length > 1
          ? blockIds.slice(0, -1)
          : contextLengthLimit <= 2500 && Number(blockIds[0]?.slice(1) || 0) % 2 === 0 ? [] : blockIds;
        value = {
          matches: matchedBlockIds.length && itemIds.length
            ? [{ id: itemIds[0], ranges: [[matchedBlockIds[0], matchedBlockIds.at(-1)]] }]
            : [],
        };
      } else if (task.includes('投标知识库遗漏段落补漏助手')) {
        stage = 'recovery';
        value = {
          matches: [],
          new_items: [],
          discarded: blockIds.length
            ? [{ ranges: [[blockIds[0], blockIds.at(-1)]], reason: '测试补漏舍弃' }]
            : [],
        };
      } else {
        throw new Error(`无法识别测试请求阶段：${task.slice(0, 80)}`);
      }

      calls.push({
        stage,
        prefix: prefix.content,
        blockIds,
        itemIds: itemIdsFromMessage(taskMessage),
        firstRoundTitles: firstRoundTitlesFromMessage(taskMessage),
        requestChars: messagesContentLength(options.messages),
        requestBudget: Math.floor(contextLengthLimit * 0.8),
      });
      const normalized = options.normalizer(value);
      options.validator(normalized);
      return normalized;
    },
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error(message);
}

function createMarkdown(sectionCount, bodyChars) {
  return Array.from({ length: sectionCount }, (_, index) => [
    `# 第 ${index + 1} 章`,
    `第 ${index + 1} 章专属内容。${String.fromCharCode(0x4e00 + index).repeat(bodyChars)}`,
  ].join('\n\n')).join('\n\n');
}

test('long-document orchestration segments all four stages, item-splits, ignores batchSize, and still uses injected aiService', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-long-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, '超长知识库.md');
  fs.writeFileSync(sourcePath, createMarkdown(7, 520), 'utf-8');
  openDialogResult = { canceled: false, filePaths: [sourcePath] };

  const fixture = createMemoryStore();
  const calls = [];
  const rawAiService = createAiService(2500, calls);
  const textRequestQueue = createAiRequestQueue({ getLimit: () => 2 });
  let activeAiRequests = 0;
  let maxActiveAiRequests = 0;
  const aiService = {
    getConfig: rawAiService.getConfig,
    collectJsonResponse(options) {
      return textRequestQueue.enqueue(async () => {
        activeAiRequests += 1;
        maxActiveAiRequests = Math.max(maxActiveAiRequests, activeAiRequests);
        await new Promise((resolve) => setImmediate(resolve));
        try {
          return await rawAiService.collectJsonResponse(options);
        } finally {
          activeAiRequests -= 1;
        }
      });
    },
  };
  const app = { getPath: () => tempDir };
  const configStore = { load: () => ({ developer_mode: true, file_parser: { provider: 'local' } }) };
  const service = createKnowledgeBaseService({ app, aiService, configStore, knowledgeBaseStore: fixture.store });
  const originalSetTimeout = global.setTimeout;
  const originalConsoleInfo = console.info;
  const warmupDelays = [];
  global.setTimeout = (callback, delay) => {
    if (delay === 5000) warmupDelays.push(delay);
    queueMicrotask(callback);
    return 1;
  };
  console.info = () => {};

  try {
    const webContents = { isDestroyed: () => false, send: () => {} };
    const upload = await service.uploadDocuments('folder-1', webContents);
    assert.equal(upload.success, true);
    const documentId = upload.documents[0].id;
    await waitFor(
      () => fixture.documents.get(documentId)?.status === 'ready_for_matching',
      '超长文档未完成首次提取和补充阶段',
    );

    const initialCalls = calls.filter((call) => call.stage === 'initial');
    const supplementCalls = calls.filter((call) => call.stage === 'supplement');
    const initialPrefixes = [...new Set(initialCalls.map((call) => call.prefix))];
    const supplementPrefixes = [...new Set(supplementCalls.map((call) => call.prefix))];
    assert.ok(initialPrefixes.length > 1, '首次提取应覆盖多个 Block Segment');
    assert.ok(supplementPrefixes.length > 1, '补充遗漏应覆盖多个 Block Segment');
    assert.deepEqual(
      initialPrefixes,
      supplementPrefixes,
      '首次提取与补充遗漏必须复用字节级稳定 Block 前缀',
    );
    assert.ok(
      supplementCalls.length > supplementPrefixes.length,
      '首轮条目超预算时补充阶段应在固定 Block 前缀下拆分 item 子批',
    );
    const expectedFirstRoundTitles = [...new Set(initialCalls.flatMap((call) => (
      Array.from({ length: 4 }, (_, index) => `首轮-${call.blockIds[0]}-${index + 1}`)
    )))].sort();
    for (const prefix of supplementPrefixes) {
      const seenTitles = supplementCalls
        .filter((call) => call.prefix === prefix)
        .flatMap((call) => call.firstRoundTitles);
      assert.deepEqual(
        [...seenTitles].sort(),
        expectedFirstRoundTitles,
        '每个 Block Segment 的补充阶段都应覆盖全部首轮条目',
      );
      assert.equal(
        new Set(seenTitles).size,
        expectedFirstRoundTitles.length,
        '同一 Block Segment 的补充 item 子批不得丢失或重复首轮条目',
      );
    }
    assert.ok(
      calls.every((call) => call.requestChars <= call.requestBudget),
      '所有实际知识库 AI 请求都必须控制在 80% 请求预算内',
    );

    const firstStart = service.startMatching(documentId, 1, webContents);
    assert.equal(firstStart.success, true);
    await waitFor(() => {
      const current = fixture.documents.get(documentId);
      if (current?.status === 'error') throw new Error(current.error || current.message);
      return current?.status === 'success';
    }, 'batchSize=1 匹配未完成');
    const firstRunResult = fixture.matchStepHistory.at(-1);
    const firstRunCalls = calls.length;
    const matchCalls = calls.filter((call) => call.stage === 'match');
    const recoveryCalls = calls.filter((call) => call.stage === 'recovery');
    assert.ok(new Set(matchCalls.map((call) => call.prefix)).size > 1, '条目匹配应覆盖多个 Block Segment');
    assert.ok(new Set(recoveryCalls.map((call) => call.prefix)).size > 1, '未归属 Block 补漏应覆盖多个 Segment');
    assert.ok(
      matchCalls.length > new Set(matchCalls.map((call) => call.prefix)).size,
      '知识条目超预算时应在固定 Block 前缀下拆分 item 子批',
    );
    assert.ok(fixture.itemsByDocument.get(documentId).length > 0, '普通成功匹配结果应继续保存知识条目');

    const secondStart = service.startMatching(documentId, 99, webContents);
    assert.equal(secondStart.success, true);
    await waitFor(
      () => fixture.documents.get(documentId)?.status === 'success' && calls.length > firstRunCalls,
      'batchSize=99 强制重跑未完成',
    );
    const secondRunResult = fixture.matchStepHistory.at(-1);
    assert.equal(secondRunResult.segment_count, firstRunResult.segment_count);
    assert.equal(secondRunResult.batch_count, firstRunResult.batch_count);
    assert.ok(warmupDelays.length >= 3);
    assert.ok(warmupDelays.every((delay) => delay === 5000));
    assert.ok(calls.length > 0, '所有阶段请求必须通过注入的 aiService 发出');
    assert.equal(maxActiveAiRequests, 2, '知识库并发分段必须受真实 AI 请求队列的 concurrency_limit 限制');
    assert.deepEqual(textRequestQueue.getStatus(), {
      active: 0,
      queued: 0,
      retrying: 0,
      limit: 2,
      pausedScopes: [],
    });
  } finally {
    global.setTimeout = originalSetTimeout;
    console.info = originalConsoleInfo;
  }
});

test('low-context oversized business block fails before any AI request', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-low-context-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, '低上下文知识库.md');
  fs.writeFileSync(sourcePath, createMarkdown(1, 500), 'utf-8');
  openDialogResult = { canceled: false, filePaths: [sourcePath] };

  const fixture = createMemoryStore();
  const calls = [];
  const service = createKnowledgeBaseService({
    app: { getPath: () => tempDir },
    aiService: createAiService(1000, calls),
    configStore: { load: () => ({ developer_mode: true, file_parser: { provider: 'local' } }) },
    knowledgeBaseStore: fixture.store,
  });
  const originalConsoleInfo = console.info;
  console.info = () => {};
  try {
    const upload = await service.uploadDocuments('folder-1', { isDestroyed: () => false, send: () => {} });
    const documentId = upload.documents[0].id;
    await waitFor(
      () => fixture.documents.get(documentId)?.status === 'error',
      '低上下文超预算 block 未进入 fail-closed 状态',
    );
    const document = fixture.documents.get(documentId);
    assert.match(document.error, /知识库固定提示已占满当前文本模型请求预算/);
    assert.equal(calls.length, 0, '超预算 block 必须在任何 AI 请求前失败');
  } finally {
    console.info = originalConsoleInfo;
  }
});

test('one oversized paragraph becomes unique persisted blocks and completes all four stages', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-oversized-block-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, '单段超长正文.md');
  const markdown = createMarkdown(1, 2000);
  fs.writeFileSync(sourcePath, markdown, 'utf-8');
  openDialogResult = { canceled: false, filePaths: [sourcePath] };

  const fixture = createMemoryStore();
  const calls = [];
  const service = createKnowledgeBaseService({
    app: { getPath: () => tempDir },
    aiService: createAiService(2000, calls),
    configStore: { load: () => ({ developer_mode: true, file_parser: { provider: 'local' } }) },
    knowledgeBaseStore: fixture.store,
  });
  const originalSetTimeout = global.setTimeout;
  const originalConsoleInfo = console.info;
  global.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 1;
  };
  console.info = () => {};

  try {
    const webContents = { isDestroyed: () => false, send: () => {} };
    const upload = await service.uploadDocuments('folder-1', webContents);
    const documentId = upload.documents[0].id;
    await waitFor(
      () => fixture.documents.get(documentId)?.status === 'ready_for_matching',
      '单段超长正文未完成候选条目提取',
    );

    const persistedBlocks = fixture.blocksByDocument.get(documentId) || [];
    const persistedIds = persistedBlocks.map((block) => block.id);
    assert.ok(persistedBlocks.length > 1, '异常超大业务块应在持久化前拆成多个业务 Block');
    assert.equal(new Set(persistedIds).size, persistedIds.length, '每个拆分业务 Block 必须拥有唯一 P id');
    assert.ok(persistedIds.every((id) => /^P\d{6}$/.test(id)));
    assert.equal(
      persistedBlocks.map((block) => block.content).join(''),
      markdown,
      '顺序拼接持久化 Blocks 必须完整还原原正文，不得丢失或重复字符',
    );

    const start = service.startMatching(documentId, 1, webContents);
    assert.equal(start.success, true);
    await waitFor(() => {
      const current = fixture.documents.get(documentId);
      if (current?.status === 'error') throw new Error(current.error || current.message);
      return current?.status === 'success';
    }, '单段超长正文未完成匹配与补漏');

    for (const stage of ['initial', 'supplement', 'match', 'recovery']) {
      assert.ok(calls.some((call) => call.stage === stage), `${stage} 阶段必须实际执行`);
    }
    assert.ok(calls.every((call) => call.requestChars <= call.requestBudget));
    assert.ok(fixture.itemsByDocument.get(documentId).length > 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    console.info = originalConsoleInfo;
  }
});

test('one oversized knowledge item fails before sending an over-budget follow-up request', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-oversized-item-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, '超长知识条目.md');
  fs.writeFileSync(sourcePath, createMarkdown(1, 120), 'utf-8');
  openDialogResult = { canceled: false, filePaths: [sourcePath] };

  const fixture = createMemoryStore();
  const calls = [];
  const aiService = createAiService(2500, calls);
  const collectJsonResponse = aiService.collectJsonResponse.bind(aiService);
  aiService.collectJsonResponse = async (options) => {
    const task = String(options.messages?.[1]?.content || '');
    if (!task.includes('投标资料知识库分析助手')) {
      return collectJsonResponse(options);
    }
    calls.push({ stage: 'initial', requestChars: messagesContentLength(options.messages), requestBudget: 2000 });
    const value = options.normalizer({
      items: [{ title: '单个超长知识条目', summary: '甲'.repeat(5000) }],
    });
    options.validator(value);
    return value;
  };

  const service = createKnowledgeBaseService({
    app: { getPath: () => tempDir },
    aiService,
    configStore: { load: () => ({ developer_mode: true, file_parser: { provider: 'local' } }) },
    knowledgeBaseStore: fixture.store,
  });
  const originalConsoleInfo = console.info;
  console.info = () => {};
  try {
    const upload = await service.uploadDocuments('folder-1', { isDestroyed: () => false, send: () => {} });
    const documentId = upload.documents[0].id;
    await waitFor(
      () => fixture.documents.get(documentId)?.status === 'error',
      '单个超长知识条目未进入 fail-closed 状态',
    );
    assert.match(fixture.documents.get(documentId).error, /知识库条目补充请求超过当前文本模型上下文预算/);
    assert.deepEqual(calls.map((call) => call.stage), ['initial']);
  } finally {
    console.info = originalConsoleInfo;
  }
});

test('ordinary short documents keep the single-segment service flow', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-short-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, '普通知识库.md');
  fs.writeFileSync(sourcePath, createMarkdown(1, 520), 'utf-8');
  openDialogResult = { canceled: false, filePaths: [sourcePath] };

  const fixture = createMemoryStore();
  const calls = [];
  const service = createKnowledgeBaseService({
    app: { getPath: () => tempDir },
    aiService: createAiService(400000, calls),
    configStore: { load: () => ({ developer_mode: true, file_parser: { provider: 'local' } }) },
    knowledgeBaseStore: fixture.store,
  });
  const webContents = { isDestroyed: () => false, send: () => {} };
  const originalConsoleInfo = console.info;
  console.info = () => {};
  try {
    const upload = await service.uploadDocuments('folder-1', webContents);
    const documentId = upload.documents[0].id;
    await waitFor(
      () => fixture.documents.get(documentId)?.status === 'ready_for_matching',
      '普通文档未完成候选条目提取',
    );
    service.startMatching(documentId, 20, webContents);
    await waitFor(() => fixture.documents.get(documentId)?.status === 'success', '普通文档匹配未完成');

    assert.equal(calls.filter((call) => call.stage === 'initial').length, 1);
    assert.equal(calls.filter((call) => call.stage === 'supplement').length, 1);
    assert.equal(calls.filter((call) => call.stage === 'match').length, 1);
    assert.equal(calls.filter((call) => call.stage === 'recovery').length, 0);
    assert.ok(fixture.itemsByDocument.get(documentId).length > 0);
  } finally {
    console.info = originalConsoleInfo;
  }
});
