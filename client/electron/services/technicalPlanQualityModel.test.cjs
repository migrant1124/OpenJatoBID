const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeOutlineQualityMetadata,
  normalizeRequirementResponseMatrix,
} = require('./technicalPlanQualityModel.cjs');

test('旧目录节点补齐 v1.4.5 质量字段默认值', () => {
  assert.deepEqual(normalizeOutlineQualityMetadata(), {
    deep_writing: false,
    deep_writing_recommended: false,
    writing_profile: 'standard',
    value_anchor_ids: [],
    mapped_scoring_point_ids: [],
  });
});

test('要求响应矩阵拒绝未知评分点映射并规范化来源引用', () => {
  assert.throws(() => normalizeRequirementResponseMatrix({
    schema_version: 1,
    revision: 'matrix-1',
    scoring_points: [{
      scoring_point_id: 'R1.P1',
      group_requirement_id: 'R1',
      title: '实施阶段',
      requirement_text: '明确实施阶段',
      scoring_rule: '完整得分',
      source_refs: [],
      mandatory_level: 'important',
      expected_response_types: ['content'],
      high_score_conditions: ['明确里程碑'],
      mapped_node_ids: [],
      status: 'unmapped',
    }],
    rejection_risks: [],
    hidden_requirements: [],
    value_anchors: [{
      anchor_id: 'A1',
      title: '进度韧性',
      category: 'schedule-assurance',
      base_scoring_point_ids: ['R9.P1'],
      business_value: '提高进度保障的可执行性',
      directory_recommended: false,
      deep_writing_recommended: false,
      support_state: 'industry-template',
      content_requirements: [],
      table_recommendations: [],
      visual_recommendations: [],
      risk_notes: [],
      route: 'writing',
      status: 'candidate',
    }],
  }), /未知评分点 ID：R9\.P1/);

  const matrix = normalizeRequirementResponseMatrix({
    schema_version: 1,
    revision: 'matrix-1',
    scoring_points: [{
      scoring_point_id: 'R1.P1',
      group_requirement_id: 'R1',
      title: '实施阶段',
      requirement_text: '明确实施阶段',
      scoring_rule: '完整得分',
      source_refs: [{ source_type: 'tender', quote: '  实施阶段  '}],
      mandatory_level: 'important',
      expected_response_types: ['content', 'content', 'table'],
      high_score_conditions: ['明确里程碑'],
      mapped_node_ids: ['2.1', '2.1'],
      primary_node_id: '2.1',
      status: 'mapped',
    }],
    rejection_risks: [],
    hidden_requirements: [],
    value_anchors: [],
  });

  assert.deepEqual(matrix.scoring_points[0].mapped_node_ids, ['2.1']);
  assert.deepEqual(matrix.scoring_points[0].expected_response_types, ['content', 'table']);
  assert.deepEqual(matrix.scoring_points[0].source_refs, [{ source_type: 'tender', quote: '实施阶段' }]);
});
