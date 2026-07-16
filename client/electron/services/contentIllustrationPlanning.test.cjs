const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIllustrationPlanningContext,
  buildIllustrationPlanningPrompt,
  resolveIllustrationPlan,
} = require('./contentIllustrationPlanning.cjs');

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
      {
        kind: 'mermaid',
        image_type: 'process',
        title: '实施流程',
        section_ids: ['1.1'],
        placement: 'after',
        priority: 5,
      },
      {
        kind: 'ai',
        image_type: 'engineering_diagram',
        title: '实施架构',
        section_ids: ['1.1'],
        placement: 'after',
        priority: 1,
      },
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
    items: [{
      kind: 'html',
      image_type: '进度网络图',
      title: '实施网络关系图',
      section_ids: ['1.1'],
      placement: 'after',
      priority: 1,
    }],
  }, context), /image_type 无效/);
});

test('HTML wins section conflicts and the planning prompt keeps the upstream three-kind rules', () => {
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
      { kind: 'mermaid', image_type: 'process', title: '实施流程图', section_ids: ['1.1'], placement: 'after', priority: 5 },
      { kind: 'ai', image_type: 'engineering_diagram', title: '实施工程图', section_ids: ['1.1'], placement: 'after', priority: 5 },
      { kind: 'html', image_type: '进度网络图', title: '实施进度网络图', section_ids: ['1.1'], placement: 'after', priority: 1 },
    ],
  }, context);

  assert.equal(result.plan.items[0].kind, 'html');
  assert.deepEqual(result.stats.selected, { html: 1, ai: 0, mermaid: 0 });
  const prompt = buildIllustrationPlanningPrompt();
  assert.match(prompt, /kind 只能是 html、mermaid、ai/);
  assert.match(prompt, /优先级html>AI生成图片>mermaid/);
  assert.match(prompt, /HTML 多节说明类图片使用 before/);
  assert.doesNotMatch(prompt, /kind 只能是[^\n]*chart/);
});
