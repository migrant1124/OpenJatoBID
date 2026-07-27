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
    kind: 'html', image_type: '进度网络图', title: '实施进度网络图', section_ids: [sectionId],
    visual_role: '进度安排', purpose: '帮助评委理解实施顺序', scoring_point_ids: [], value_anchor_ids: [],
    priority: 5, anchor: { type: 'section_end', section_id: sectionId, sequence: 0 }, ...overrides,
  };
}

function createContext(options = {}, aiImagesAvailable = true) {
  return buildIllustrationPlanningContext({
    outlineData: { outline: [{ id: '1.1', title: '实施方案', description: '', content: '实施范围。\n\n实施流程。' }] },
    sections: { '1.1': { status: 'success', content: '实施范围。\n\n实施流程。' } },
    options,
    aiImagesAvailable,
  });
}

test('AI 与 HTML 候选独立保留，不因另一类图片数量或相同作用被挤占', () => {
  const context = createContext({ useAiImages: true, useHtmlImages: true, htmlImageTypes: 'network' });
  const result = resolveIllustrationPlan({ items: [
    candidate({ kind: 'ai', image_type: 'engineering_diagram', title: '实施工程图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
    candidate({ kind: 'html', image_type: '进度网络图', title: '实施进度网络图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
  ] }, context);
  assert.deepEqual(result.plan.items.map((item) => item.kind), ['ai', 'html']);
  assert.deepEqual(result.stats.selected, { html: 1, ai: 1 });
  assert.equal(result.plan.plan_version, ILLUSTRATION_PLAN_VERSION);
});

test('图片编排只接受 HTML 和 AI 类型', () => {
  const context = createContext({ useHtmlImages: true, htmlImageTypes: 'network' }, false);
  assert.throws(() => resolveIllustrationPlan({ items: [candidate({ kind: 'unsupported' })] }, context), /图片候选类型未启用或无效/);
  const prompt = buildIllustrationPlanningPrompt();
  assert.match(prompt, /kind 只能是 html、ai/);
  assert.match(prompt, /Creative Brief/);
  assert.match(prompt, /yibiao-content-block/);
});

test('图片编排配置不再携带数量上限', () => {
  const context = createContext();
  assert.equal('limit' in context.config.html, false);
  assert.equal('limit' in context.config.ai, false);
  assert.equal(context.config.html.allowed_types.length, 17);
});

test('视觉节奏诊断只给出建议，不改变已选择图片计划', () => {
  const longContent = '实施说明。'.repeat(600);
  const context = buildIllustrationPlanningContext({
    outlineData: { outline: [
      { id: '1.1', title: '项目概述', content: '项目概述。' },
      { id: '2.1', title: '实施方案', content: longContent },
      { id: '3.1', title: '质量保障', content: '质量保障。' },
    ] },
    sections: {
      '1.1': { status: 'success', content: '项目概述。' },
      '2.1': { status: 'success', content: longContent },
      '3.1': { status: 'success', content: '质量保障。' },
    },
    options: { useHtmlImages: true, htmlImageTypes: 'network' },
    aiImagesAvailable: false,
    contentPlans: {
      '2.1': { scoring_point_ids: ['R1'] },
      '3.1': { value_anchor_ids: ['A1'] },
    },
  });
  const result = resolveIllustrationPlan({ items: [candidate({ section_ids: ['1.1'] })] }, context);
  assert.equal(result.plan.items.length, 1);
  assert.equal(result.plan.items[0].section_ids[0], '1.1');
  assert.ok(result.plan.visual_rhythm_diagnostics.some((item) => item.code === 'high-value-without-image'));
  assert.ok(result.plan.visual_rhythm_diagnostics.some((item) => item.code === 'long-text-without-image'));
  assert.ok(result.plan.visual_rhythm_diagnostics.some((item) => item.code === 'implementation-coverage'));
});

test('人工编辑章节不计入图片覆盖和视觉节奏诊断', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: { outline: [
      { id: '1.1', title: '人工编制章节', manual_input_required: true, content: '人工正文。'.repeat(500) },
      { id: '1.2', title: '实施方案', content: 'AI 正文。' },
    ] },
    sections: {
      '1.1': { status: 'success', content: '人工正文。'.repeat(500) },
      '1.2': { status: 'success', content: 'AI 正文。' },
    },
    options: { useHtmlImages: true, htmlImageTypes: 'network' },
    aiImagesAvailable: false,
  });
  assert.deepEqual(context.eligibleSectionIds, ['1.2']);
  const result = resolveIllustrationPlan({ items: [candidate({ section_ids: ['1.2'] })] }, context);
  assert.ok(result.plan.visual_rhythm_diagnostics.every((item) => !item.section_ids.includes('1.1')));
});

test('四级和五级正文叶子都可进入图片编排，人工五级叶子继续排除', () => {
  const context = buildIllustrationPlanningContext({
    outlineData: { outline: [{
      id: '1', title: '技术方案', children: [{
        id: '1.1', title: '服务方案', children: [{
          id: '1.1.1', title: '实施组织', children: [
            { id: '1.1.1.1', title: '四级正文叶子', content: '四级正文。' },
            { id: '1.1.1.2', title: '人员分工', children: [
              { id: '1.1.1.2.1', title: '五级正文叶子', content: '五级正文。' },
              { id: '1.1.1.2.2', title: '人工五级叶子', manual_input_required: true, content: '人工正文。' },
            ] },
          ],
        }],
      }],
    }] },
    sections: {
      '1.1.1.1': { status: 'success', content: '四级正文。' },
      '1.1.1.2.1': { status: 'success', content: '五级正文。' },
      '1.1.1.2.2': { status: 'success', content: '人工正文。' },
    },
    options: { useHtmlImages: true, htmlImageTypes: 'network' },
    aiImagesAvailable: false,
  });

  assert.deepEqual(context.eligibleSectionIds, ['1.1.1.1', '1.1.1.2.1']);
});
