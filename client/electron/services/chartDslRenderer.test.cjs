const test = require('node:test');
const assert = require('node:assert/strict');
const { renderChartToHtml } = require('./chartDslRenderer.cjs');

for (const type of ['process', 'organization', 'timeline', 'architecture']) {
  test(`${type} renders nodes and source edges rather than flat cards`, () => {
    const html = renderChartToHtml({
      schema_version: 1,
      chart_type: type,
      title: '项目关系',
      theme: 'jato-business',
      layout: { width: 1240, density: 'normal', orientation: 'landscape' },
      data: {
        nodes: [{ id: 'a', label: '开始', group: '阶段一' }, { id: 'b', label: '分支甲' }, { id: 'c', label: '分支乙' }],
        edges: [{ from: 'a', to: 'b', label: '路径甲' }, { from: 'a', to: 'c', label: '路径乙' }],
      },
    });
    assert.match(html, /class="graph"/);
    assert.equal((html.match(/class="link"/g) || []).length, 2);
    assert.match(html, /路径甲/);
    assert.match(html, /路径乙/);
    assert.match(html, /阶段一/);
    assert.doesNotMatch(html, /<ul class="cards">/);
  });
}
