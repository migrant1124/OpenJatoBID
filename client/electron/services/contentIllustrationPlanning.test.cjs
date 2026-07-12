const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIllustrationPlanningContext,
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
  assert.deepEqual(result.stats.selected, { ai: 1, mermaid: 0, html: 0 });
});
