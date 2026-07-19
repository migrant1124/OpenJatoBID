'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyOutlineQualityRules, validateConditionalOutlineDepth } = require('./outlineQualityRules.cjs');
const { applyOutlineDeepeningPatch } = require('./outlineDeepeningPatch.cjs');
const { buildIllustrationPlanningContext, resolveIllustrationPlan } = require('./contentIllustrationPlanning.cjs');

function engineeringMatrix() {
  return {
    schema_version: 1,
    revision: 'fixture-engineering',
    scoring_points: [{
      scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施质量', requirement_text: '提供实施与质量控制方案', scoring_rule: '完整得分',
      source_refs: [], mandatory_level: 'high', expected_response_types: ['content', 'table'], high_score_conditions: ['阶段交付', '质量闭环'], mapped_node_ids: [], status: 'unmapped',
    }],
    rejection_risks: [{
      risk_id: 'RR1', source_refs: [], trigger: '缺少固定承诺', category: 'format', risk_level: 'potential-rejection', handling_route: 'fixed-form', mapped_node_ids: [], mitigation: '保留固定承诺函', status: 'covered',
    }],
    hidden_requirements: [{
      hidden_requirement_id: 'HR1', source_kind: 'footnote', requirement_text: '附件格式待确认', source_refs: [], handling_route: 'manual-review', mapped_node_ids: [], status: 'needs-confirmation',
    }],
    value_anchors: [],
  };
}

function engineeringOutline() {
  return {
    outline: [{ id: '1', title: '技术方案', description: '技术方案', children: [{
      id: '1.1', title: '实施与质量控制', description: '实施、交付、质量闭环', deep_writing: true, deep_writing_recommended: true,
      deep_writing_source: 'ai', deep_writing_reason: '高分条件需要展开实施闭环', writing_profile: 'deep', mapped_scoring_point_ids: ['R1.P1'], value_anchor_ids: [],
      children: [{ id: '1.1.1', title: '实施阶段', description: '阶段动作', children: [{ id: '1.1.1.1', title: '阶段交付与验收', description: '交付和验收', children: [{ id: '1.1.1.1.1', title: '质量闭环记录', description: '质量闭环产物' }] }] }],
    }] }],
  };
}

test('工程技术服务 Fixture：评分点完整映射、风险路由和深度五级目录同时成立', () => {
  const result = applyOutlineQualityRules(engineeringOutline(), engineeringMatrix());
  validateConditionalOutlineDepth(result.outline);
  assert.equal(result.review.can_proceed, true);
  assert.equal(result.matrix.scoring_points[0].primary_node_id, '1.1');
  assert.equal(result.matrix.scoring_points[0].status, 'mapped');
  assert.equal(result.matrix.rejection_risks[0].status, 'covered');
  assert.equal(result.matrix.hidden_requirements[0].status, 'needs-confirmation');
});

test('已有方案扩写 Fixture：original-only 不越界，确认后只深化目标二级子树', () => {
  const source = engineeringOutline();
  source.outline[0].children.push({ id: '1.2', title: '服务承诺', description: '原方案保留', children: [{ id: '1.2.1', title: '响应方式', description: '不应改变' }] });
  assert.throws(() => applyOutlineDeepeningPatch({
    outlineData: source, requirementResponseMatrix: applyOutlineQualityRules(source, engineeringMatrix()).matrix,
    outlineExpansionMode: 'original-only', allowAiValueAdditions: false,
    patch: { schema_version: 1, target_node_id: '1.1', deep_writing: true, additions: [{ parent_id: '1.1.1.1', title: '新增标题', description: '不允许' }] },
  }), /明确允许 AI 增值深化/u);
  const result = applyOutlineDeepeningPatch({
    outlineData: source, requirementResponseMatrix: applyOutlineQualityRules(source, engineeringMatrix()).matrix,
    outlineExpansionMode: 'original-only', allowAiValueAdditions: true,
    patch: { schema_version: 1, target_node_id: '1.1', deep_writing: true, additions: [{ parent_id: '1.1.1.1', title: '执行偏差闭环', description: '记录偏差、纠正和复核' }] },
  });
  assert.equal(result.outlineData.outline[0].children[1].description, '原方案保留');
  assert.ok(result.diff.added_node_ids.every((id) => id.startsWith('1.1.')));
});

test('广告活动策划 Fixture：创意章节支持多角色图片与独立 Creative Brief', () => {
  const content = '活动主题与目标受众。\n\n执行场景、空间动线与传播节奏。';
  const context = buildIllustrationPlanningContext({
    outlineData: { project_overview: '城市文化活动传播项目', outline: [{ id: '2.1', title: '活动创意策划', writing_profile: 'creative-proposal', content }] },
    sections: { '2.1': { status: 'success', content } }, options: { useAiImages: true, maxAiImages: 20 }, aiImagesAvailable: true,
    contentPlans: { '2.1': { plan: { writing_profile: 'creative-proposal', scoring_point_ids: ['R2.P1'], value_anchor_ids: [], illustration_briefs: [] } } },
    requirementResponseMatrix: { scoring_points: [{ scoring_point_id: 'R2.P1', title: '创意方案' }], value_anchors: [] },
  });
  const blockId = context.sectionMap.get('2.1').blocks[0].id;
  const brief = (deliverableType) => ({
    client_profile: '城市文化活动项目', project_goal: '表达创意与执行场景', target_audience: ['目标参与者'], campaign_theme: '城市文化', key_message: '呈现文化活力', mandatory_elements: ['文化活动场景'], prohibited_elements: ['伪造 Logo', '大量关键中文文字'], style_keywords: ['专业', '克制'], brand_colors: [], brand_assets: [], deliverable_type: deliverableType, aspect_ratio: '16:9', source_scoring_point_ids: ['R2.P1'], source_value_anchor_ids: [], needs_user_confirmation: ['客户品牌资产'],
  });
  const result = resolveIllustrationPlan({
    items: [
      { kind: 'ai', image_type: 'campaign_key_visual', title: '城市文化活动主视觉', section_ids: ['2.1'], visual_role: '主视觉方案', purpose: '帮助评委理解活动主题与传播主张', scoring_point_ids: ['R2.P1'], value_anchor_ids: [], priority: 5, anchor: { type: 'after_block', section_id: '2.1', block_id: blockId, sequence: 1 }, aspect_ratio: '16:9', creative_brief: brief('主视觉概念图') },
      { kind: 'ai', image_type: 'event_scene_render', title: '活动执行场景概念图', section_ids: ['2.1'], visual_role: '执行场景', purpose: '帮助评委理解活动执行场景', scoring_point_ids: ['R2.P1'], value_anchor_ids: [], priority: 5, anchor: { type: 'section_end', section_id: '2.1', sequence: 1 }, aspect_ratio: '16:9', creative_brief: brief('活动现场概念图') },
      { kind: 'ai', image_type: 'spatial_concept_render', title: '活动空间概念图', section_ids: ['2.1'], visual_role: '空间概念', purpose: '帮助评委理解活动空间组织与动线', scoring_point_ids: ['R2.P1'], value_anchor_ids: [], priority: 5, anchor: { type: 'after_heading', section_id: '2.1', sequence: 1 }, aspect_ratio: '16:9', creative_brief: brief('空间概念效果图') },
    ],
  }, context);
  assert.equal(result.plan.items.length, 3);
  assert.equal(new Set(result.plan.items.map((item) => item.visual_role)).size, 3);
  assert.ok(result.plan.items.every((item) => item.creative_brief && item.creative_brief.needs_user_confirmation.includes('客户品牌资产')));
});
