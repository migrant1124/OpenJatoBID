const assert = require('node:assert/strict');
const test = require('node:test');

const { applyOutlineDeepeningPatch } = require('./outlineDeepeningPatch.cjs');

function matrix() {
  return {
    schema_version: 1,
    revision: 'deepening-test',
    scoring_points: [{
      scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施', requirement_text: '明确实施方案', scoring_rule: '完整得分', source_refs: [],
      mandatory_level: 'important', expected_response_types: ['content'], high_score_conditions: ['职责清晰'], mapped_node_ids: ['1.1'], primary_node_id: '1.1', status: 'mapped',
    }],
    rejection_risks: [], hidden_requirements: [], value_anchors: [],
  };
}

function outline() {
  return {
    outline: [{ id: '1', title: '技术方案', description: '技术方案', children: [{
      id: '1.1', title: '实施方案', description: '实施方案', deep_writing: false, deep_writing_recommended: false, writing_profile: 'standard',
      mapped_scoring_point_ids: ['R1.P1'], value_anchor_ids: [], children: [{
        id: '1.1.1', title: '实施组织', description: '实施组织', children: [{ id: '1.1.1.1', title: '职责分工', description: '职责分工' }],
      }],
    }, {
      id: '1.2', title: '服务承诺', description: '保持不变', children: [{ id: '1.2.1', title: '响应', description: '响应' }],
    }] }],
  };
}

test('局部深化仅向目标二级子树追加五级目录并保留其他目录', () => {
  const result = applyOutlineDeepeningPatch({
    outlineData: outline(), requirementResponseMatrix: matrix(), outlineExpansionMode: 'ai-complement', allowAiValueAdditions: true,
    patch: {
      schema_version: 1, target_node_id: '1.1', deep_writing: true, deep_writing_reason: '实施评分项需要展开',
      additions: [{ parent_id: '1.1.1.1', client_id: 'work', title: '岗位交接', description: '明确交接产物与时限' }],
    },
  });

  assert.equal(result.outlineData.outline[0].children[0].deep_writing, true);
  assert.equal(result.outlineData.outline[0].children[0].children[0].children[0].children[0].id, '1.1.1.1.1');
  assert.equal(result.outlineData.outline[0].children[1].description, '保持不变');
  assert.deepEqual(result.diff.added_node_ids, ['1.1.1.1.1']);
});

test('局部深化拒绝越界更新、改名和仅参考原方案模式下的隐式新增', () => {
  const base = { outlineData: outline(), requirementResponseMatrix: matrix(), outlineExpansionMode: 'ai-complement', allowAiValueAdditions: true };
  assert.throws(() => applyOutlineDeepeningPatch({ ...base, patch: {
    schema_version: 1, target_node_id: '1.1', deep_writing: true, updates: [{ node_id: '1.2', description: '越界' }], additions: [{ parent_id: '1.1.1.1', title: '五级', description: '五级' }],
  } }), /越过目标子树/u);
  assert.throws(() => applyOutlineDeepeningPatch({ ...base, patch: {
    schema_version: 1, target_node_id: '1.1', deep_writing: true, updates: [{ node_id: '1.1', title: '改名' }], additions: [],
  } }), /不允许修改既有标题/u);
  assert.throws(() => applyOutlineDeepeningPatch({ ...base, outlineExpansionMode: 'original-only', allowAiValueAdditions: false, patch: {
    schema_version: 1, target_node_id: '1.1', deep_writing: true, additions: [{ parent_id: '1.1.1.1', title: '五级', description: '五级' }],
  } }), /明确允许 AI 增值深化/u);
});
