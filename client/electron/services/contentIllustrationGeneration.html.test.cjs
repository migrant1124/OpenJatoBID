const test = require('node:test');
const assert = require('node:assert/strict');
const { generateHtmlIllustration } = require('./contentIllustrationGeneration.cjs');

function createExecution(reference = '实施方案正文') {
  return {
    planItem: {
      item_id: 'html-1',
      kind: 'html',
      image_type: '系统架构与拓扑图',
      title: '总体系统架构图',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {},
    },
    reference,
  };
}

function createWorkspaceStore(overrides = {}) {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  return {
    readIllustrationHtml: () => '',
    findIllustrationHtml: () => null,
    saveIllustrationHtml: ({ content }) => {
      assert.match(content, /<html\b/i);
      return { relativePath: 'illustrations/revision/html/html-1.html' };
    },
    saveIllustrationPng: ({ buffer }) => {
      assert.deepEqual(buffer, png);
      return { assetUrl: 'yibiao-asset://generated-images/html-1.png' };
    },
    ...overrides,
  };
}

test('normal HTML illustration follows the upstream prompt, persists source, renders PNG and returns asset URL', async () => {
  let prompt = '';
  let renderedHtml = '';
  const sourceEvents = [];
  const sequence = [];
  const result = await generateHtmlIllustration({
    aiService: {
      chat: async ({ messages }) => {
        prompt = messages[0].content;
        return '<!doctype html><html><head></head><body><section>架构图</section></body></html>';
      },
    },
    execution: createExecution(),
    plan: { revision: 'revision' },
    workspaceStore: createWorkspaceStore(),
    localImageRenderService: {
      renderHtmlToPng: async (html) => {
        sequence.push('render');
        renderedHtml = html;
        return { buffer: Buffer.from('89504e470d0a1a0a', 'hex'), width: 1240, height: 600 };
      },
    },
    runAgentHtml: async () => { throw new Error('normal mode must not start Agent'); },
    onSourceSaved: (source) => {
      sequence.push('source-saved');
      sourceEvents.push(source);
    },
  });

  assert.match(prompt, /用html绘制一张系统架构与拓扑图/);
  assert.match(prompt, /完整 HTML/);
  assert.match(renderedHtml, /<section>架构图<\/section>/);
  assert.deepEqual(sourceEvents, [{ mode: 'normal', source_path: 'illustrations/revision/html/html-1.html' }]);
  assert.deepEqual(sequence, ['source-saved', 'render']);
  assert.equal(result.asset_url, 'yibiao-asset://generated-images/html-1.png');
  assert.equal(result.source_path, 'illustrations/revision/html/html-1.html');
});

test('HTML illustration resumes from the deterministic saved source without calling the model', async () => {
  let modelCalls = 0;
  const recoveredHtml = '<!doctype html><html><head></head><body>已保存源码</body></html>';
  const result = await generateHtmlIllustration({
    aiService: { chat: async () => { modelCalls += 1; return ''; } },
    execution: createExecution(),
    plan: { revision: 'revision' },
    workspaceStore: createWorkspaceStore({
      findIllustrationHtml: () => ({
        relativePath: 'illustrations/revision/html/html-1.html',
        content: recoveredHtml,
      }),
    }),
    localImageRenderService: {
      renderHtmlToPng: async (html) => {
        assert.equal(html, recoveredHtml);
        return { buffer: Buffer.from('89504e470d0a1a0a', 'hex'), width: 1240, height: 600 };
      },
    },
    runAgentHtml: async () => { throw new Error('recovered source must not start Agent'); },
  });

  assert.equal(modelCalls, 0);
  assert.equal(result.mode, 'normal');
});

test('long HTML illustration uses the Agent output contract', async () => {
  let agentRequest = null;
  const result = await generateHtmlIllustration({
    aiService: { chat: async () => { throw new Error('agent mode must not call chat'); } },
    execution: createExecution('长正文'.repeat(20000)),
    plan: { revision: 'revision' },
    workspaceStore: createWorkspaceStore(),
    localImageRenderService: {
      renderHtmlToPng: async () => ({ buffer: Buffer.from('89504e470d0a1a0a', 'hex'), width: 1240, height: 600 }),
    },
    runAgentHtml: async (request) => {
      agentRequest = request;
      const html = '<!doctype html><html><head></head><body>Agent HTML</body></html>';
      assert.equal(request.validateOutput({ output_content: html }), html);
      return html;
    },
  });

  assert.equal(agentRequest.outputFile, 'illustration.html');
  assert.equal(agentRequest.files[0].path, 'reference.md');
  assert.match(agentRequest.prompt, /生成完整 HTML 文档/);
  assert.equal(result.mode, 'agent');
});

test('HTML illustration resumes directly from the recorded source path', async () => {
  const recordedHtml = '<!doctype html><html><head></head><body>已记录源码</body></html>';
  let findCalls = 0;
  let modelCalls = 0;
  const execution = createExecution();
  execution.planItem.generation.source_path = 'illustrations/revision/html/html-1.html';
  await generateHtmlIllustration({
    aiService: { chat: async () => { modelCalls += 1; return ''; } },
    execution,
    plan: { revision: 'revision' },
    workspaceStore: createWorkspaceStore({
      readIllustrationHtml: (sourcePath) => {
        assert.equal(sourcePath, execution.planItem.generation.source_path);
        return recordedHtml;
      },
      findIllustrationHtml: () => { findCalls += 1; return null; },
    }),
    localImageRenderService: {
      renderHtmlToPng: async (html) => {
        assert.equal(html, recordedHtml);
        return { buffer: Buffer.from('89504e470d0a1a0a', 'hex'), width: 1240, height: 600 };
      },
    },
    runAgentHtml: async () => { throw new Error('recorded source must not start Agent'); },
  });

  assert.equal(findCalls, 0);
  assert.equal(modelCalls, 0);
});

test('HTML render failure keeps the persisted source path for the next run', async () => {
  await assert.rejects(async () => generateHtmlIllustration({
    aiService: {
      chat: async () => '<!doctype html><html><head></head><body>待恢复源码</body></html>',
    },
    execution: createExecution(),
    plan: { revision: 'revision' },
    workspaceStore: createWorkspaceStore(),
    localImageRenderService: {},
    runAgentHtml: async () => { throw new Error('normal mode must not start Agent'); },
  }), (error) => {
    assert.match(error.message, /HTML 转图组件尚未初始化/);
    assert.deepEqual(error.illustrationGeneration, {
      mode: 'normal',
      source_path: 'illustrations/revision/html/html-1.html',
    });
    return true;
  });
});
