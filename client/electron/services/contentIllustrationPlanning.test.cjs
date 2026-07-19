const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ILLUSTRATION_PLAN_VERSION,
  buildIllustrationPlanningContext,
  buildIllustrationPlanningPrompt,
  resolveIllustrationPlan,
} = require('./contentIllustrationPlanning.cjs');

function candidate(overrides = {}) {
  const sectionId = overrides.section_ids?.[0] || '1.1';
  return {
    kind: 'html',
    image_type: '进度网络图',
    title: '实施进度网络图',
    section_ids: [sectionId],
    visual_role: '进度安排',
    purpose: '帮助评委理解实施顺序',
    scoring_point_ids: [],
    value_anchor_ids: [],
    priority: 5,
    anchor: { type: 'section_end', section_id: sectionId, sequence: 0 },
    ...overrides,
  };
}

test('prefers AI over legacy Mermaid candidates for the same section', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: {
      outline: [{ id: '1.1', title: '实施方案', description: '', content: '实施方案正文' }],
    },
    sections: {
      '1.1': { status: 'success', content: '实施方案正文' },
    },
    options: {
      useAiImages: true,
      maxAiImages: 1,
      useMermaidImages: true,
      maxMermaidImages: 1,
      useHtmlImages: false,
      maxHtmlImages: 0,
      htmlImageTypes: '',
    },
    aiImagesAvailable: true,
  });

  const result = resolveIllustrationPlan({
    items: [
      candidate({
        kind: 'mermaid', image_type: 'process', title: '实施流程', visual_role: '流程说明', purpose: '帮助评委理解实施流程',
      }),
      candidate({
        kind: 'ai',
        image_type: 'engineering_diagram',
        title: '实施架构',
        visual_role: '总体概念', purpose: '帮助评委理解实施架构', priority: 1,
      }),
    ],
  }, context);

  assert.equal(result.plan.items.length, 1);
  assert.equal(result.plan.items[0].kind, 'ai');
  assert.deepEqual(result.stats.selected, { html: 0, ai: 1, mermaid: 0 });
});

test('excludes protected response bodies from the illustration agent workspace', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: {
      outline: [
        { id: '1', title: '固定承诺函', response_mode: 'locked-commitment', content: '不得进入普通配图 Agent 的承诺原文' },
        { id: '2', title: '实施方案', response_mode: 'freeform-markdown', content: '允许配图的正文' },
      ],
    },
    sections: {
      1: { status: 'success', content: '不得进入普通配图 Agent 的承诺原文' },
      2: { status: 'success', content: '允许配图的正文' },
    },
    options: { useMermaidImages: true, maxMermaidImages: 1 },
  });

  const technicalPlan = context.files.find((file) => file.path === 'technical-plan.md')?.content || '';
  assert.deepEqual(context.eligibleSectionIds, ['2']);
  assert.doesNotMatch(technicalPlan, /不得进入普通配图 Agent/);
  assert.match(technicalPlan, /允许配图的正文/);
});

test('limits HTML candidates to the user-selected HTML image types', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: {
      outline: [{ id: '1.1', title: '实施方案', description: '', content: '实施方案正文' }],
    },
    sections: {
      '1.1': { status: 'success', content: '实施方案正文' },
    },
    options: {
      useHtmlImages: true,
      maxHtmlImages: 1,
      htmlImageTypes: 'gantt, table',
    },
  });

  assert.deepEqual(context.config.html.allowed_types, ['甘特图', '数据表']);
  assert.throws(() => resolveIllustrationPlan({
    items: [candidate({ title: '实施网络关系图', image_type: '进度网络图', priority: 1 })],
  }, context), /image_type 无效/);
});

test('HTML wins legacy section conflicts and图片计划 v4 要求锚点与评分关联', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: {
      outline: [{ id: '1.1', title: '实施方案', description: '', content: '实施方案正文' }],
    },
    sections: {
      '1.1': { status: 'success', content: '实施方案正文' },
    },
    options: {
      useAiImages: true,
      maxAiImages: 1,
      useMermaidImages: true,
      maxMermaidImages: 1,
      useHtmlImages: true,
      maxHtmlImages: 1,
      htmlImageTypes: 'network',
    },
    aiImagesAvailable: true,
  });

  const result = resolveIllustrationPlan({
    items: [
      candidate({ kind: 'mermaid', image_type: 'process', title: '实施流程图', visual_role: '流程说明', purpose: '帮助评委理解实施流程' }),
      candidate({ kind: 'ai', image_type: 'engineering_diagram', title: '实施工程图', visual_role: '工程结构', purpose: '帮助评委理解工程结构' }),
      candidate({ kind: 'html', image_type: '进度网络图', title: '实施进度网络图' }),
    ],
  }, context);

  assert.equal(result.plan.items[0].kind, 'html');
  assert.deepEqual(result.stats.selected, { html: 1, ai: 0, mermaid: 0 });
  assert.equal(result.plan.plan_version, ILLUSTRATION_PLAN_VERSION);
  assert.equal(result.plan.items[0].anchor.type, 'section_end');
  const prompt = buildIllustrationPlanningPrompt();
  assert.match(prompt, /kind 只能是 html、mermaid、ai/);
  assert.match(prompt, /Creative Brief/);
  assert.match(prompt, /yibiao-content-block/);
  assert.doesNotMatch(prompt, /kind 只能是[^\n]*chart/);
});

test('创意图片必须携带独立 Creative Brief、评分点和正文块锚点', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: { project_overview: '城市文化活动传播项目', outline: [{ id: '1.1', title: '活动策划', content: '活动主题与执行场景。\n\n传播节奏与交付物。' }] },
    sections: { '1.1': { status: 'success', content: '活动主题与执行场景。\n\n传播节奏与交付物。' } },
    options: { useAiImages: true, maxAiImages: 2 },
    aiImagesAvailable: true,
    contentPlans: { '1.1': { plan: { writing_profile: 'creative-proposal', scoring_point_ids: ['R1.P1'], value_anchor_ids: ['A1'], illustration_briefs: [{ title: '主视觉', purpose: '展示传播主题' }] } } },
    requirementResponseMatrix: { scoring_points: [{ scoring_point_id: 'R1.P1', title: '活动创意' }], value_anchors: [{ anchor_id: 'A1', title: '传播增值', route: 'writing', status: 'accepted' }] },
  });
  const firstBlockId = context.sectionMap.get('1.1').blocks[0].id;
  const result = resolveIllustrationPlan({
    items: [candidate({
      kind: 'ai', image_type: 'event_scene_render', title: '活动执行场景概念图', visual_role: '执行场景', purpose: '帮助评委理解活动执行空间与场景', scoring_point_ids: ['R1.P1'], value_anchor_ids: ['A1'],
      anchor: { type: 'after_block', section_id: '1.1', block_id: firstBlockId, sequence: 1 }, aspect_ratio: '16:9',
      creative_brief: {
        client_profile: '城市文化活动项目', project_goal: '展示活动执行方案', target_audience: ['目标参与者'], campaign_theme: '城市文化', key_message: '突出执行场景与传播价值', event_type: '主题活动', venue_and_scene: '待确认场地', mandatory_elements: ['执行场景'], prohibited_elements: ['伪造 Logo', '大量关键中文文字'], style_keywords: ['专业', '克制'], brand_colors: [], brand_assets: [], deliverable_type: '活动现场概念图', aspect_ratio: '16:9', source_scoring_point_ids: ['R1.P1'], source_value_anchor_ids: ['A1'], needs_user_confirmation: ['客户品牌资产'],
      },
    })],
  }, context);
  assert.equal(result.plan.items[0].creative_brief.deliverable_type, '活动现场概念图');
  assert.match(context.files.find((file) => file.path === 'technical-plan.md').content, new RegExp(firstBlockId));
  assert.match(context.files.find((file) => file.path === 'illustration-input.json').content, /creative-proposal/);
});
