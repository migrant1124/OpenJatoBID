const assert = require('node:assert/strict');
const test = require('node:test');
const { renderChartToHtml } = require('./chartDslRenderer.cjs');

test('图表渲染器只产生应用模板中的静态 HTML', () => {
  const html = renderChartToHtml({ schema_version: 1, chart_type: 'table', title: '项目清单', theme: 'jato-business', layout: { width: 1240, density: 'normal', orientation: 'landscape' }, data: { columns: ['名称'], rows: [['安全&可靠']] } });
  assert.match(html, /安全&amp;可靠/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:/i);
});
