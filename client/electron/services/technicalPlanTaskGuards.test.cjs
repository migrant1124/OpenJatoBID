'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGuardedOutlineRunner } = require('./outlineGenerationGuard.cjs');

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

test('目录任务成功后以一次提交保存，并保留生成阶段的重点标签', async () => {
  const store = createStore({ outlineData: null });
  const baseRunner = async ({ workspaceStore, updateTask }) => {
    const state = workspaceStore.updateTechnicalPlan({
      outlineData: {
        outline: [{
          title: '服务方案',
          description: '说明',
          focus_priority: 'service-plan',
          children: [{ title: '实施内容', description: '内容' }],
        }],
      },
      outlineGenerationTask: { status: 'success', progress: 100 },
    });
    updateTask({ status: 'success', progress: 100 }, state);
  };

  await createGuardedOutlineRunner(baseRunner)({ workspaceStore: store, updateTask: () => undefined, payload: {} });

  const saved = store.getState().outlineData.outline[0];
  assert.equal(saved.manual_input_required, false);
  assert.equal(saved.focus_priority, 'service-plan');
  assert.equal(saved.children[0].manual_input_required, false);
});
