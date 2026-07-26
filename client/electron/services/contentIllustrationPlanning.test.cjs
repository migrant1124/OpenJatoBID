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

test('HTML 在同一视觉角色冲突中优先于 AI，且使用图片计划 v5', () => {
  const context = createContext({ useAiImages: true, maxAiImages: 1, useHtmlImages: true, maxHtmlImages: 1, htmlImageTypes: 'network' });
  const result = resolveIllustrationPlan({ items: [
    candidate({ kind: 'ai', image_type: 'engineering_diagram', title: '实施工程图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
    candidate({ kind: 'html', image_type: '进度网络图', title: '实施进度网络图', visual_role: '总体概念', purpose: '帮助评委理解实施方案整体关系' }),
  ] }, context);
  assert.equal(result.plan.items[0].kind, 'html');
  assert.deepEqual(result.stats.selected, { html: 1, ai: 0 });
  assert.equal(result.plan.plan_version, ILLUSTRATION_PLAN_VERSION);
});

test('图片编排只接受 HTML 和 AI 类型', () => {
  const context = createContext({ useHtmlImages: true, maxHtmlImages: 1, htmlImageTypes: 'network' }, false);
  assert.throws(() => resolveIllustrationPlan({ items: [candidate({ kind: 'unsupported' })] }, context), /图片候选类型未启用或无效/);
  const prompt = buildIllustrationPlanningPrompt();
  assert.match(prompt, /kind 只能是 html、ai/);
  assert.match(prompt, /Creative Brief/);
  assert.match(prompt, /yibiao-content-block/);
});

test('未保存配置使用 HTML 30 与可用 AI 20 的上限', () => {
  const context = createContext();
  assert.equal(context.config.html.limit, 30);
  assert.equal(context.config.ai.limit, 20);
  assert.equal(context.config.html.allowed_types.length, 17);
});
