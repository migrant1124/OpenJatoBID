'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTENT_SAFETY_BACKUP_KEY,
  recoverInterruptedContentBackup,
} = require('./contentGenerationGuard.cjs');

function createStore(initial) {
  let state = structuredClone(initial);
  return {
    loadTechnicalPlan: () => structuredClone(state),
    updateTechnicalPlan(partial) {
      state = { ...state, ...structuredClone(partial) };
      return structuredClone(state);
    },
    getState: () => structuredClone(state),
  };
}

test('中断的正文全量生成会恢复持久化备份', () => {
  const baseline = {
    outlineData: { outline: [{ id: '1', title: '技术方案', description: '说明', content: '原正文' }] },
    contentGenerationSections: { '1': { status: 'success', content: '原正文' } },
    contentGenerationPlans: {},
    contentGenerationRuntime: undefined,
  };
  const store = createStore({
    outlineData: { outline: [{ id: '1', title: '技术方案', description: '说明', content: '' }] },
    contentGenerationSections: { '1': { status: 'running', content: '' } },
    contentGenerationTask: { status: 'running', progress: 20 },
    contentGenerationOptions: { [CONTENT_SAFETY_BACKUP_KEY]: { version: 1, snapshot: baseline } },
  });

  assert.ok(recoverInterruptedContentBackup(store));
  const restored = store.getState();
  assert.deepEqual(restored.outlineData, baseline.outlineData);
  assert.equal(restored.contentGenerationTask.status, 'error');
  assert.equal(restored.contentGenerationOptions[CONTENT_SAFETY_BACKUP_KEY], undefined);
});
