'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runContentGenerationTask } = require('./contentGenerationTask.cjs');

for (const [label, payload] of [
  ['首次生成', {}],
  ['继续生成', { resume: true }],
  ['全文重新生成', { regenerate: true }],
]) {
  test(`缺少项目理解证据时，${label}仍完成初始化并保留跳过提示`, async () => {
    const state = {
      outlineData: { outline: [{ id: '1', title: '技术方案', children: [
        { id: '1.1', title: '项目理解', feature_role: 'project-understanding' },
        { id: '1.2', title: '实施方案' },
      ] }] },
      globalFacts: [{ title: '项目名称', content: '正文启动回归项目' }],
      globalFactsTask: { status: 'success' },
      contentGenerationTask: { status: 'paused' },
    };
    const initialized = new Error('初始化已完成，停止后续生成');
    let initialPatch;
    let aiCalls = 0;
    await assert.rejects(runContentGenerationTask({
      aiService: {
        getConfig: () => ({}),
        collectJsonResponse: async () => {
          aiCalls += 1;
          throw new Error('初始化回归不得调用模型');
        },
      },
      workspaceStore: {
        loadTechnicalPlan: () => structuredClone(state),
        updateTechnicalPlan: (partial) => {
          initialPatch = partial;
          throw initialized;
        },
      },
      updateTask: (partial) => partial,
      payload,
      previousState: structuredClone(state),
    }), (error) => error === initialized);

    assert.equal(aiCalls, 0);
    assert.deepEqual(Object.keys(initialPatch.contentGenerationSections), ['1.2']);
    assert.equal(initialPatch.contentGenerationTask.status, 'running');
    assert.ok(initialPatch.contentGenerationTask.logs.some((line) => line.includes('已跳过 1 个相关小节并继续其他正文')));
    assert.match(initialPatch.contentGenerationTask.logs[0], /准备生成正文|继续已暂停的正文生成任务/);
  });
}
