const assert = require('node:assert/strict');
const test = require('node:test');

const { applyOutlineQualityRules, validateConditionalOutlineDepth } = require('./outlineQualityRules.cjs');

function matrix() {
  return {
    schema_version: 1,
    revision: 'outline-quality-test',
    scoring_points: [{
      scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施组织', requirement_text: '提供实施组织', scoring_rule: '完整得分',
      source_refs: [], mandatory_level: 'important', expected_response_types: ['content'], high_score_conditions: ['明确职责'], mapped_node_ids: [], status: 'unmapped',
    }],
    rejection_risks: [{
      risk_id: 'RR1', source_refs: [], trigger: '缺少承诺', category: 'format', risk_level: 'high', handling_route: 'outline', mapped_node_ids: [], mitigation: '人工核对', status: 'unhandled',
    }],
    hidden_requirements: [],
    value_anchors: [],
  };
}

function outline({ deep = false, addLevelSix = false } = {}) {
  const levelFive = { id: '1.1.1.1.1', title: '五级', description: '五级' };
  if (addLevelSix) levelFive.children = [{ id: '1.1.1.1.1.1', title: '六级', description: '六级' }];
  return {
    outline: [{ id: '1', title: '技术方案', description: '技术方案', children: [{
      id: '1.1', title: '实施组织', description: '实施组织', deep_writing: deep, deep_writing_recommended: deep,
      deep_writing_source: deep ? 'ai' : undefined, deep_writing_reason: deep ? '评分条件复杂，需要展开执行闭环' : undefined,
      writing_profile: deep ? 'deep' : 'standard', mapped_scoring_point_ids: ['R1.P1'],
      children: [{ id: '1.1.1', title: '三级', description: '三级', children: [{ id: '1.1.1.1', title: '四级', description: '四级', ...(deep ? { children: [levelFive] } : {}) }] }],
    }] }],
  };
}

test('深化二级目录必须恰好到第五级，普通目录最多第四级', () => {
  assert.doesNotThrow(() => validateConditionalOutlineDepth(outline()));
  assert.doesNotThrow(() => validateConditionalOutlineDepth(outline({ deep: true })));
  const incomplete = outline({ deep: true });
  delete incomplete.outline[0].children[0].children[0].children[0].children;
  assert.throws(() => validateConditionalOutlineDepth(incomplete), /第五级/u);
  assert.throws(() => validateConditionalOutlineDepth(outline({ deep: true, addLevelSix: true })), /L6/u);
});

test('目录只将每个原子评分点映射到一个二级主负责人，并显式升级待确认风险', () => {
  const result = applyOutlineQualityRules(outline({ deep: true }), matrix());
  assert.equal(result.matrix.scoring_points[0].primary_node_id, '1.1');
  assert.equal(result.matrix.scoring_points[0].status, 'mapped');
  assert.equal(result.matrix.rejection_risks[0].handling_route, 'manual-review');
  assert.equal(result.matrix.rejection_risks[0].status, 'needs-confirmation');
  assert.equal(result.review.can_proceed, true);
  assert.equal(result.outline.outline[0].children[0].deep_writing, true);
});
