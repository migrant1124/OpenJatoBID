'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyOutlineQualityRules, validateConditionalOutlineDepth } = require('./outlineQualityRules.cjs');

test('目录不再受五级深化门槛限制', () => {
  const outline = { outline: [{ id: '1', title: '服务方案', description: '说明', children: [{ id: '1.1', title: '实施内容', description: '说明' }] }] };
  assert.doesNotThrow(() => validateConditionalOutlineDepth(outline));
});

test('评分矩阵不再绑定目录主承载或人工责任', () => {
  const result = applyOutlineQualityRules({
    outline: [{ id: '1', title: '服务方案', description: '说明' }],
  }, {
    schema_version: 1,
    revision: 'v1.5.0-test',
    scoring_points: [{
      scoring_point_id: 'SP-1',
      group_requirement_id: 'SP-1',
      title: '服务方案',
      requirement_text: '服务方案',
      scoring_rule: '服务方案',
      source_refs: [],
      mandatory_level: 'high',
      expected_response_types: ['content'],
      high_score_conditions: [],
      score_value: 10,
      mapped_node_ids: ['1'],
      status: 'mapped',
    }],
    rejection_risks: [],
    hidden_requirements: [],
    value_anchors: [],
  });

  assert.equal(result.outline.outline[0].focus_priority, 'service-plan');
  assert.deepEqual(result.matrix.scoring_points[0].mapped_node_ids, []);
  assert.equal(result.matrix.scoring_points[0].status, 'unmapped');
  assert.equal(result.review.can_proceed, true);
});
