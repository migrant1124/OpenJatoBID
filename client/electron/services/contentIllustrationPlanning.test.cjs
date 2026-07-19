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

test('同一小节同一视觉角色按 AI 优先于 Mermaid 去重', () => {
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
        kind: 'mermaid', image_type: 'process', title: '实施流程', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系',
      }),
      candidate({
        kind: 'ai',
        image_type: 'engineering_diagram',
        title: '实施架构',
        visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系', priority: 1,
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

test('HTML 在同一视觉角色的跨类型冲突中优先且图片计划 v4 要求锚点与评分关联', () => {
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
      candidate({ kind: 'mermaid', image_type: 'process', title: '实施流程图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
      candidate({ kind: 'ai', image_type: 'engineering_diagram', title: '实施工程图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
      candidate({ kind: 'html', image_type: '进度网络图', title: '实施进度网络图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
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

test('同一小节可保留不同视觉角色的多张图片，且配置上限不再受叶子数量截断', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: { outline: [{ id: '1.1', title: '实施方案', content: '实施范围。\n\n实施流程。\n\n质量控制。' }] },
    sections: { '1.1': { status: 'success', content: '实施范围。\n\n实施流程。\n\n质量控制。' } },
    options: { useAiImages: true, maxAiImages: 20, useMermaidImages: true, maxMermaidImages: 5, useHtmlImages: true, maxHtmlImages: 30 },
    aiImagesAvailable: true,
  });
  const [firstBlock, secondBlock] = context.sectionMap.get('1.1').blocks;
  const result = resolveIllustrationPlan({
    items: [
      candidate({ kind: 'html', image_type: '流程图', title: '实施总体流程图', visual_role: '流程说明', purpose: '帮助评委理解实施流程', anchor: { type: 'after_block', section_id: '1.1', block_id: firstBlock.id, sequence: 1 } }),
      candidate({ kind: 'ai', image_type: 'engineering_diagram', title: '实施场景关系图', visual_role: '执行场景', purpose: '帮助评委理解实施场景关系', anchor: { type: 'after_block', section_id: '1.1', block_id: secondBlock.id, sequence: 1 } }),
      candidate({ kind: 'mermaid', image_type: 'responsibility', title: '实施职责关系图', visual_role: '职责关系', purpose: '帮助评委理解实施职责关系', anchor: { type: 'section_end', section_id: '1.1', sequence: 1 } }),
    ],
  }, context);
  assert.equal(context.config.html.limit, 30);
  assert.equal(context.config.ai.limit, 20);
  assert.equal(context.config.mermaid.limit, 5);
  assert.equal(result.plan.items.length, 3);
  assert.deepEqual(result.plan.items.map((item) => item.visual_role).sort(), ['执行场景', '流程说明', '职责关系'].sort());
});

test('未保存配置使用 HTML 30、可用 AI 20、Mermaid 关闭且保留 5 的默认上限', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: { outline: [{ id: '1.1', title: '实施方案', content: '实施正文' }] },
    sections: { '1.1': { status: 'success', content: '实施正文' } },
    aiImagesAvailable: true,
  });
  assert.deepEqual(context.config, {
    ai: { enabled: true, limit: 20, allowed_types: context.config.ai.allowed_types, type_descriptions: context.config.ai.type_descriptions },
    mermaid: { enabled: false, limit: 5, allowed_types: context.config.mermaid.allowed_types, type_descriptions: context.config.mermaid.type_descriptions },
    html: { enabled: true, limit: 30, allowed_types: context.config.html.allowed_types },
    eligible_section_ids: ['1.1'],
  });
  assert.equal(context.config.html.allowed_types.length, 17);
});
