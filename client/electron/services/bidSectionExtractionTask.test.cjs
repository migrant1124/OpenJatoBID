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
