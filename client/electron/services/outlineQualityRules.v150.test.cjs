const assert = require('node:assert/strict');
const test = require('node:test');
const { applyOutlineQualityRules } = require('./outlineQualityRules.cjs');

function matrix(points) {
  return {
    schema_version: 1,
    revision: 'focus-test',
    scoring_points: points.map(([id, title, score]) => ({
      scoring_point_id: id,
      group_requirement_id: id,
      title,
      requirement_text: title,
      scoring_rule: title,
      source_refs: [],
      mandatory_level: 'high',
      expected_response_types: ['content'],
      high_score_conditions: ['完整响应'],
      ...(score === undefined ? {} : { score_value: score }),
      mapped_node_ids: [],
      status: 'unmapped',
    })),
    rejection_risks: [],
    hidden_requirements: [],
    value_anchors: [],
  };
}

test('focus labels use service plan, highest score ties, then next distinct score', () => {
  const result = applyOutlineQualityRules({
    outline: [{ id: '1', title: '服务方案', description: '服务内容', children: [
      { id: '1.1', title: '实施能力', description: '能力', focus_scoring_point_ids: ['P1'] },
      { id: '1.2', title: '质量保障', description: '质量', focus_scoring_point_ids: ['P2'] },
      { id: '1.3', title: '项目管理', description: '管理', focus_scoring_point_ids: ['P3'] },
    ] }],
  }, matrix([['P1', '实施能力', 10], ['P2', '质量保障', 10], ['P3', '项目管理', 8]]));

  const [root] = result.outline.outline;
  assert.equal(root.focus_priority, 'service-plan');
  assert.equal(root.children[0].focus_priority, 'score-first');
  assert.equal(root.children[1].focus_priority, 'score-first');
  assert.equal(root.children[2].focus_priority, 'score-second');
});

test('does not invent score focus when scores are unavailable', () => {
  const result = applyOutlineQualityRules({
    outline: [{ id: '1', title: '项目管理', description: '管理', focus_scoring_point_ids: ['P1'] }],
  }, matrix([['P1', '项目管理', undefined]]));
  assert.equal(result.outline.outline[0].focus_priority, undefined);
});
