const assert = require('node:assert/strict');
const test = require('node:test');
const { validateChartDsl } = require('./chartDslValidator.cjs');

function raciSpec() { return { schema_version: 1, chart_type: 'raci', title: '项目职责矩阵', theme: 'jato-business', layout: { width: 1240, density: 'normal', orientation: 'landscape' }, data: { roles: ['项目经理'], activities: ['启动'], assignments: [{ activity: '启动', role: '项目经理', responsibility: 'A' }] } }; }

test('接受受控 RACI JSON DSL', () => { assert.equal(validateChartDsl(raciSpec()).valid, true); });
test('拒绝 HTML、未知字段和不存在的边引用', () => {
  const spec = { schema_version: 1, chart_type: 'process', title: '<script>', theme: 'jato-business', layout: { width: 1240, density: 'normal', orientation: 'landscape' }, data: { nodes: [{ id: 'a', label: '开始', href: 'https://bad' }], edges: [{ from: 'a', to: 'missing' }] } };
  const result = validateChartDsl(spec);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'FIELD'));
  assert.ok(result.errors.some((error) => error.code === 'EDGE_REFERENCE'));
});
