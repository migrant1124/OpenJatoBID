const test = require('node:test');
const assert = require('node:assert/strict');

const { runBidSectionExtractionTask } = require('./bidSectionExtractionTask.cjs');

test('多标段识别仅返回一个有效标段时恢复为单标段', async () => {
  let state = {};
  const taskUpdates = [];
  const workspaceStore = {
    readOriginalTenderMarkdown() {
      return '第一章 项目概况\n第一标段：设备采购及安装\n第二章 技术要求';
    },
    prepareBidSectionExtraction() {},
    updateTechnicalPlan(patch) {
      state = { ...state, ...patch };
      return state;
    },
  };
  const aiService = {
    async collectJsonResponse() {
      return {
        sections: [{
          title: '第一标段',
          includeRanges: [{ startLine: 2, endLine: 2, reason: '标段标题' }],
        }],
      };
    },
  };

  await runBidSectionExtractionTask({
    aiService,
    workspaceStore,
    updateTask(update) {
      taskUpdates.push(update);
    },
  });

  assert.equal(state.bidSectionMode, 'single');
  assert.deepEqual(state.bidSections, []);
  assert.equal(state.bidSectionExtractionError, undefined);
  assert.equal(taskUpdates.at(-1).status, 'success');
  assert.match(taskUpdates.at(-1).logs.at(-1), /已恢复为单标段/);
});

test('多标段识别会并发提交全部文本分段，再等待候选合并', async () => {
  let state = {};
  const extractResolvers = [];
  let mergeResolver;
  const source = Array.from({ length: 12 }, (_item, index) => `第${index + 1}部分标段范围说明。`).join('\n');
  const workspaceStore = {
    readOriginalTenderMarkdown() {
      return source;
    },
    prepareBidSectionExtraction() {},
    updateTechnicalPlan(patch) {
      state = { ...state, ...patch };
      return state;
    },
  };
  const aiService = {
    getConfig() {
      return { context_length_limit: 48 };
    },
    collectJsonResponse(options) {
      if (options.progressLabel === '多标段识别候选合并') {
        return new Promise((resolve) => {
          mergeResolver = resolve;
        });
      }
      return new Promise((resolve) => {
        extractResolvers.push(resolve);
      });
    },
  };

  const task = runBidSectionExtractionTask({
    aiService,
    workspaceStore,
    updateTask() {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(extractResolvers.length > 1, '应在第一个分段返回前提交其他分段请求');
  extractResolvers.forEach((resolve) => resolve({ sections: [] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof mergeResolver, 'function');
  mergeResolver({
    sections: [
      { title: '第一包', includeRanges: [{ startLine: 1, endLine: 2 }] },
      { title: '第二包', includeRanges: [{ startLine: 3, endLine: 4 }] },
    ],
  });

  await task;
  assert.equal(state.bidSectionExtractionStatus, 'success');
  assert.equal(state.bidSections.length, 2);
});

test('并发分段有一段失败后，其他完成请求不会将任务恢复为运行中', async () => {
  let state = {};
  const extractRequests = [];
  const source = Array.from({ length: 12 }, (_item, index) => `第${index + 1}部分标段范围说明。`).join('\n');
  const workspaceStore = {
    readOriginalTenderMarkdown() {
      return source;
    },
    prepareBidSectionExtraction() {},
    updateTechnicalPlan(patch) {
      state = { ...state, ...patch };
      return state;
    },
  };
  const aiService = {
    getConfig() {
      return { context_length_limit: 48 };
    },
    collectJsonResponse() {
      return new Promise((resolve, reject) => {
        extractRequests.push({ resolve, reject });
      });
    },
  };

  const task = runBidSectionExtractionTask({
    aiService,
    workspaceStore,
    updateTask() {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  extractRequests[0].reject(new Error('模型请求失败'));
  await assert.rejects(task, /模型请求失败/u);
  extractRequests.slice(1).forEach(({ resolve }) => resolve({ sections: [] }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.bidSectionExtractionStatus, 'error');
});

test('多标段识别清理展示描述中的原始行号、分隔符和换行标签', async () => {
  let state = {};
  const workspaceStore = {
    readOriginalTenderMarkdown() {
      return '第一包范围\n第二包范围';
    },
    prepareBidSectionExtraction() {},
    updateTechnicalPlan(patch) {
      state = { ...state, ...patch };
      return state;
    },
  };
  const aiService = {
    async collectJsonResponse() {
      return {
        sections: [
          {
            title: '第一包服务',
            headLine: 'L000001 | 第一包服务<br>范围说明',
            description: 'L000002 | 负责标准制修订<br>专家评审|会议组织。',
            includeRanges: [{ startLine: 1, endLine: 1 }],
          },
          {
            title: '第二包服务',
            description: '负责项目审查服务。',
            includeRanges: [{ startLine: 2, endLine: 2 }],
          },
        ],
      };
    },
  };

  await runBidSectionExtractionTask({
    aiService,
    workspaceStore,
    updateTask() {},
  });

  assert.equal(state.bidSections[0].headLine, '第一包服务 范围说明');
  assert.equal(state.bidSections[0].description, '负责标准制修订 专家评审 会议组织。');
});
