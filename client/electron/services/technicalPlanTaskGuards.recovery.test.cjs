'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAndValidateOutline } = require('./outlineGenerationGuard.cjs');
const {
  CONTENT_SAFETY_BACKUP_KEY,
  recoverInterruptedContentBackup,
} = require('./contentGenerationGuard.cjs');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStore(initial) {
  let state = clone(initial);
  return {
    loadTechnicalPlan() {
      return clone(state);
    },
    updateTechnicalPlan(partial = {}) {
      state = { ...state, ...clone(partial) };
      return clone(state);
    },
    get state() {
      return clone(state);
    },
  };
}

function contentOutline(contentA = '', contentB = '') {
  return {
    outline: [{
      id: '1',
      title: '技术方案',
      description: '技术方案',
      children: [{
        id: '1.1',
        title: '实施组织',
        description: '实施组织',
        children: [
          { id: '1.1.1', title: '组织职责', description: '组织职责', content: contentA },
          { id: '1.1.2', title: '人员安排', description: '人员安排', content: contentB },
        ],
      }],
    }],
  };
}

test('strict outline validation rejects unknown mapped requirement IDs', () => {
  assert.throws(() => normalizeAndValidateOutline({
    outline: [{
      title: '技术方案',
      description: '技术方案',
      children: [{
        title: '实施组织',
        description: '实施组织',
        children: [
          {
            title: '组织职责',
            description: '组织职责',
            mapped_requirement_ids: ['R999'],
          },
          {
            title: '人员安排',
            description: '人员安排',
          },
        ],
      }],
    }],
  }, {
    sourceOutline: contentOutline(),
    groups: [{ requirement_id: 'R1', title: '实施组织评分', description: '组织职责', detail_points: [] }],
    outlineExpansionMode: 'ai-complement',
  }), /未知技术评分项/);
});

test('interrupted full regeneration restores its persisted safety backup on startup', () => {
  const baseline = {
    outlineData: contentOutline('旧正文A', '旧正文B'),
    contentGenerationSections: {
      '1.1.1': { id: '1.1.1', title: '组织职责', status: 'success', content: '旧正文A' },
      '1.1.2': { id: '1.1.2', title: '人员安排', status: 'success', content: '旧正文B' },
    },
    contentGenerationPlans: { old: { plan_version: 4, plan: {} } },
    contentGenerationRuntime: undefined,
  };
  const store = createStore({
    workflowKind: 'technical-plan',
    outlineData: contentOutline('', ''),
    contentGenerationSections: {
      '1.1.1': { id: '1.1.1', title: '组织职责', status: 'running', content: '' },
    },
    contentGenerationPlans: {},
    contentGenerationTask: { status: 'running', progress: 20, logs: ['正在生成'] },
    contentGenerationOptions: {
      minimumWords: 10000,
      [CONTENT_SAFETY_BACKUP_KEY]: { version: 1, snapshot: baseline },
    },
  });

  const restored = recoverInterruptedContentBackup(store);
  assert.ok(restored);
  assert.deepEqual(store.state.outlineData, baseline.outlineData);
  assert.deepEqual(store.state.contentGenerationSections, baseline.contentGenerationSections);
  assert.equal(store.state.contentGenerationTask.status, 'error');
  assert.equal(store.state.contentGenerationOptions.minimumWords, 10000);
  assert.equal(store.state.contentGenerationOptions[CONTENT_SAFETY_BACKUP_KEY], undefined);
});
