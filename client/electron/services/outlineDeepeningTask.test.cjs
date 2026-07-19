const assert = require('node:assert/strict');
const test = require('node:test');

const { runOutlineDeepeningTask } = require('./outlineDeepeningTask.cjs');

function plan() {
  return {
    outlineExpansionMode: 'ai-complement',
    outlineData: {
      outline: [{ id: '1', title: '技术方案', description: '技术方案', children: [{
        id: '1.1', title: '实施方案', description: '实施方案', deep_writing: false, deep_writing_recommended: false, writing_profile: 'standard',
        mapped_scoring_point_ids: ['R1.P1'], value_anchor_ids: [], children: [{ id: '1.1.1', title: '组织', description: '组织', children: [{ id: '1.1.1.1', title: '职责', description: '职责' }] }],
      }] }],
    },
    requirementResponseMatrix: {
      schema_version: 1, revision: 'deepening-task',
      scoring_points: [{
        scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施', requirement_text: '明确实施方案', scoring_rule: '完整得分', source_refs: [],
        mandatory_level: 'important', expected_response_types: ['content'], high_score_conditions: ['职责清晰'], mapped_node_ids: ['1.1'], primary_node_id: '1.1', status: 'mapped',
      }],
      rejection_risks: [], hidden_requirements: [], value_anchors: [],
    },
  };
}

test('AI 深化任务只保存待确认 Patch，不在候选阶段修改目录', async () => {
  const state = plan();
  const updates = [];
  const aiService = {
    async collectJsonResponse(options) {
      const raw = {
        schema_version: 1, target_node_id: '1.1', deep_writing: true, deep_writing_reason: '评分点复杂',
        additions: [{ parent_id: '1.1.1.1', title: '岗位交接', description: '明确交接产物' }],
      };
      const value = options.normalizer(raw);
      options.validator(value);
      return value;
    },
  };
  const store = {
    loadTechnicalPlan: () => state,
  };
  const updateTask = (partial) => updates.push(partial);

  await runOutlineDeepeningTask({ aiService, workspaceStore: store, updateTask, payload: { target_node_id: '1.1', allow_ai_value_additions: true } });

  assert.equal(state.outlineData.outline[0].children[0].deep_writing, false);
  const finished = updates.at(-1);
  assert.equal(finished.status, 'success');
  assert.equal(finished.stats.diff.added_node_ids.length, 1);
  assert.equal(finished.stats.patch.target_node_id, '1.1');
});
