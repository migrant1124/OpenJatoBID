const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeRequirementResponseMatrix } = require('./technicalPlanQualityModel.cjs');
const { getDirectoryEligibleValueAnchors, validateRequirementResponseMatrix } = require('./technicalPlanQualityValidation.cjs');

function createMatrix(overrides = {}) {
  return {
    schema_version: 1,
    revision: 'matrix-validation',
    scoring_points: [{
      scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施计划', requirement_text: '提交实施计划', scoring_rule: '完整得分',
      source_refs: [], mandatory_level: 'important', expected_response_types: ['content'], high_score_conditions: ['明确阶段'], mapped_node_ids: ['2'], primary_node_id: '2', status: 'mapped',
    }],
    rejection_risks: [{
      risk_id: 'RR1', source_refs: [], trigger: '缺少承诺', category: 'format', risk_level: 'potential-rejection', handling_route: 'fixed-form', mapped_node_ids: [], mitigation: '按固定格式填写', status: 'covered',
    }],
    hidden_requirements: [{
      hidden_requirement_id: 'HR1', source_kind: 'footnote', requirement_text: '附脚注说明', source_refs: [], handling_route: 'manual-review', mapped_node_ids: [], status: 'needs-confirmation',
    }],
    value_anchors: [{
      anchor_id: 'A1', title: '进度韧性保障', category: 'schedule-assurance', base_scoring_point_ids: ['R1.P1'], business_value: '提高履约可执行性',
      directory_recommended: true, deep_writing_recommended: true, support_state: 'tender-supported', content_requirements: ['说明控制机制'], table_recommendations: [], visual_recommendations: [], risk_notes: [],
      route: 'directory', status: 'accepted', directory_gate: {
        scope_relevant: true, score_or_delivery_value: true, actionable: true, section_capacity: true, evidence_safe: true, non_duplicate: true, format_allowed: true,
      },
    }],
    ...overrides,
  };
}

test('目录准入 Gate 阻止未满足条件的增值锚点进入目录', () => {
  const matrix = createMatrix();
  matrix.value_anchors[0].directory_gate.actionable = false;
  assert.throws(() => normalizeRequirementResponseMatrix(matrix), /目录准入 Gate/u);
});

test('三重反查会拒绝未映射评分点与未处理风险', () => {
  const matrix = createMatrix();
  matrix.scoring_points[0].status = 'unmapped';
  matrix.scoring_points[0].mapped_node_ids = [];
  delete matrix.scoring_points[0].primary_node_id;
  matrix.rejection_risks[0].status = 'unhandled';
  const review = validateRequirementResponseMatrix(matrix, { outline: [{ id: '1', title: '技术方案', description: '', children: [{ id: '2', title: '实施计划', description: '' }] }] });

  assert.equal(review.can_proceed, false);
  assert.equal(review.scoring_summary.unmapped, 1);
  assert.ok(review.errors.some((item) => item.kind === 'risk'));
});

test('通过 Gate 的目录锚点可供目录生成使用', () => {
  const eligible = getDirectoryEligibleValueAnchors(createMatrix());
  assert.deepEqual(eligible.map((item) => item.anchor_id), ['A1']);
});
