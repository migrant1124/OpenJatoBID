const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadKnowledgeBaseModule() {
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
      return { dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('./knowledgeBaseService.cjs');
  } finally {
    Module._load = originalLoad;
  }
}

const { _internals } = loadKnowledgeBaseModule();

function createBlock(index, content = `正文-${index}`) {
  return {
    id: `P${String(index).padStart(6, '0')}`,
    type: 'paragraph',
    heading_path: ['测试章节'],
    content,
  };
}

test('uses the 400000 fallback, 80% request budget, 20% reserve, and fixed-message deduction', () => {
  assert.equal(_internals.getRequestBudget({ getConfig: () => ({}) }), 320000);
  assert.equal(_internals.getRequestBudget({ getConfig: () => ({ context_length_limit: 0 }) }), 320000);
  assert.equal(_internals.getRequestBudget({ getConfig: () => ({ context_length_limit: 1000 }) }), 800);

  const fixedMessages = [{ role: 'user', content: 'abc' }];
  assert.equal(_internals.getMessagesContentLength(fixedMessages), 71);
  assert.equal(_internals.getKnowledgeBaseSegmentLimit(
    { getConfig: () => ({ context_length_limit: 1000 }) },
    fixedMessages,
  ), 729);

  const packed = _internals.buildUnifiedBlockSegments(
    [createBlock(1, 'a'.repeat(30))],
    { getConfig: () => ({ context_length_limit: 2500 }) },
  );
  assert.equal(packed.requestBudget, 2000);
  assert.equal(packed.minimumReserve, 400);
  assert.equal(packed.reserve, packed.fixedMessageChars + packed.minimumReserve);
  assert.equal(packed.blockSegmentLimit, packed.requestBudget - packed.reserve);
});

test('fails closed before splitting one business block across low-context segments', () => {
  const aiService = { getConfig: () => ({ context_length_limit: 1000 }) };
  const documentName = '低上下文.md';
  const sourceBlock = createBlock(1, 'a'.repeat(500));
  assert.throws(
    () => _internals.buildUnifiedBlockSegments([sourceBlock], aiService, documentName),
    /block P000001 超过当前可用预算：\d+\/0（请求预算 800）/,
    '同一个业务 block 不得为了适配预算而复制到多个 Segment',
  );
  assert.throws(
    () => _internals.buildRecoveryBlockSegments([sourceBlock], aiService, documentName),
    /block P000001 超过当前可用预算：\d+\/0（请求预算 800）/,
  );
});

test('packs consecutive blocks without loss, duplication, or ordinary single-block splitting', () => {
  const blocks = [
    createBlock(1, 'a'.repeat(80)),
    createBlock(2, 'b'.repeat(80)),
    createBlock(3, 'c'.repeat(80)),
    createBlock(4, 'd'.repeat(2000)),
  ];
  const firstPairLimit = _internals.renderBlocksForPrompt(blocks.slice(0, 2)).length;
  const segments = _internals.packBlocksIntoSegments(blocks, firstPairLimit);

  assert.deepEqual(segments.flatMap((segment) => segment.blockIds), blocks.map((block) => block.id));
  assert.equal(new Set(segments.flatMap((segment) => segment.blockIds)).size, blocks.length);
  assert.deepEqual(segments[0].blockIds, [blocks[0].id, blocks[1].id]);
  assert.equal(segments.at(-1).blocks.length, 1);
  assert.ok(segments.at(-1).chars > firstPairLimit);
  assert.deepEqual(_internals.packBlocksIntoSegments([], 0), []);
});

test('packs item sub-batches by serialized length without loss or duplication', () => {
  const items = [
    { id: 'K000001', title: '一', summary: 'a'.repeat(80) },
    { id: 'K000002', title: '二', summary: 'b'.repeat(80) },
    { id: 'K000003', title: '三', summary: 'c'.repeat(80) },
  ];
  const oneSegment = _internals.packItemsIntoSegments(items, 10000);
  const splitSegments = _internals.packItemsIntoSegments(items, 1);

  assert.equal(oneSegment.length, 1);
  assert.deepEqual(splitSegments.flatMap((segment) => segment.itemIds), items.map((item) => item.id));
  assert.equal(new Set(splitSegments.flatMap((segment) => segment.itemIds)).size, items.length);
});

test('merges segmented extraction and match results deterministically', () => {
  assert.deepEqual(_internals.mergeTitleSummaryItems([
    [{ title: '质量 保证', summary: '第一版' }],
    [{ title: '质量保证', summary: '重复版' }, { title: '安全方案', summary: '新增' }],
  ]), [
    { title: '质量 保证', summary: '第一版' },
    { title: '安全方案', summary: '新增' },
  ]);

  assert.deepEqual(_internals.mergeMatchResults([
    [{ id: 'K000001', ranges: [['P000001', 'P000001']], block_ids: ['P000001'] }],
    [{ id: 'K000001', ranges: [['P000002', 'P000002']], block_ids: ['P000002'] }],
  ]), [{
    id: 'K000001',
    ranges: [['P000001', 'P000001'], ['P000002', 'P000002']],
    block_ids: ['P000001', 'P000002'],
  }]);
});

test('gives every ordinarily matched block one deterministic existing-item owner', () => {
  const blocks = [createBlock(1), createBlock(2), createBlock(3)];
  const blockOrder = _internals.getBlockOrder(blocks);
  const matches = _internals.mergeUniqueMatchResults([
    [
      { id: 'K000001', ranges: [['P000003', 'P000003']], block_ids: ['P000001', 'P000002'] },
      { id: 'K000002', ranges: [['P000001', 'P000003']], block_ids: ['P000002', 'P000003'] },
    ],
  ], new Set(['K000001', 'K000002']), blocks, blockOrder);

  assert.deepEqual(matches, [
    { id: 'K000001', ranges: [['P000001', 'P000002']], block_ids: ['P000001', 'P000002'] },
    { id: 'K000002', ranges: [['P000003', 'P000003']], block_ids: ['P000003'] },
  ]);
});

test('recovery ownership is matches > new_items > discarded and ranges are rebuilt from claimed ids', () => {
  const blocks = [createBlock(1), createBlock(2), createBlock(3), createBlock(4)];
  const blockOrder = _internals.getBlockOrder(blocks);
  const merged = _internals.mergeRecoverySegmentResults([{
    matches: [{
      id: 'K000001',
      ranges: [['P000004', 'P000004']],
      block_ids: ['P000001', 'P000002'],
    }],
    new_items: [{
      title: '新增条目',
      summary: '摘要',
      ranges: [['P000001', 'P000001']],
      block_ids: ['P000001', 'P000003'],
    }],
    discarded: [{
      ranges: [['P000002', 'P000004']],
      block_ids: ['P000002', 'P000003', 'P000004'],
      reason: '无价值',
    }],
  }], new Set(['K000001']), blocks, blockOrder);

  assert.deepEqual(merged.matches, [{
    id: 'K000001',
    ranges: [['P000001', 'P000002']],
    block_ids: ['P000001', 'P000002'],
  }]);
  assert.deepEqual(merged.new_items, [{
    title: '新增条目',
    summary: '摘要',
    ranges: [['P000003', 'P000003']],
    block_ids: ['P000003'],
  }]);
  assert.deepEqual(merged.discarded, [{
    ranges: [['P000004', 'P000004']],
    block_ids: ['P000004'],
    reason: '无价值',
  }]);
  assert.equal(new Set([
    ...merged.matches.flatMap((item) => item.block_ids),
    ...merged.new_items.flatMap((item) => item.block_ids),
    ...merged.discarded.flatMap((item) => item.block_ids),
  ]).size, 4);
});

test('uses a byte-stable block prefix before each stage task suffix', () => {
  const blocks = [createBlock(1, '稳定正文')];
  const blockText = _internals.renderBlocksForPrompt(blocks);
  const segmentMeta = { index: 1, total: 2 };
  const first = _internals.buildInitialItemMessages('文档.docx', blockText, segmentMeta);
  const supplement = _internals.buildSupplementItemMessages('文档.docx', blockText, [], segmentMeta);
  const match = _internals.buildMatchMessages('文档.docx', blockText, [], segmentMeta);

  assert.equal(first[0].content, supplement[0].content);
  assert.equal(first[0].content, match[0].content);
  assert.match(first[0].content, /^以下是接下来要处理的主要内容 block 列表/);
  assert.match(first[1].content, /^文档名：文档\.docx/);
  assert.notEqual(first[0].content, first[1].content);
});

test('waits exactly 5000ms and prevents fan-out when the active-task guard changes', async () => {
  const originalSetTimeout = global.setTimeout;
  const delays = [];
  let canContinue = true;
  let fanOutStarted = false;
  global.setTimeout = (callback, delay) => {
    delays.push(delay);
    canContinue = false;
    queueMicrotask(callback);
    return 1;
  };

  try {
    await assert.rejects((async () => {
      await _internals.waitForPromptCacheWarmup(() => canContinue);
      fanOutStarted = true;
    })(), (error) => error.code === 'KNOWLEDGE_TASK_INTERRUPTED');
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(delays, [5000]);
  assert.equal(fanOutStarted, false);
});

test('allSettled runner waits for every started task and then throws the first rejection', async () => {
  const firstError = new Error('first');
  const secondError = new Error('second');
  let releaseLastTask;
  let lastTaskFinished = false;
  const lastTaskGate = new Promise((resolve) => { releaseLastTask = resolve; });
  const running = _internals.runParallelAndThrowAfterSettled([
    async () => { throw firstError; },
    async () => { throw secondError; },
    async () => {
      await lastTaskGate;
      lastTaskFinished = true;
      return 'done';
    },
  ]);
  let runnerSettled = false;
  running.finally(() => { runnerSettled = true; }).catch(() => {});

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runnerSettled, false);
  assert.equal(lastTaskFinished, false);
  releaseLastTask();
  await assert.rejects(running, (error) => error === firstError);
  assert.equal(lastTaskFinished, true);
});
