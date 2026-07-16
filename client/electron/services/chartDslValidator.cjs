const { CHART_TYPES, GRAPH_TYPES, LAYOUT_FIELDS, MATRIX_TYPES, ROOT_FIELDS, SERIES_TYPES } = require('./chartDslSchema.cjs');

function issue(errors, path, code, message) { errors.push({ path, code, message }); }
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function uniqueStrings(values) { return Array.isArray(values) && values.every((value) => typeof value === 'string' && value.trim()) && new Set(values).size === values.length; }
function safeText(value) {
  return typeof value === 'string' && value.trim() && !/[<>]/.test(value) && !/(?:javascript:|https?:|\b(?:script|style|on\w+)\s*=)/i.test(value);
}
function checkKeys(errors, path, value, allowed) {
  if (!isObject(value)) { issue(errors, path, 'TYPE', '必须是对象'); return false; }
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(errors, `${path}.${key}`, 'FIELD', '包含未允许字段');
  return true;
}
function checkText(errors, path, value) { if (!safeText(value)) issue(errors, path, 'TEXT', '必须是安全纯文本'); }
function checkFinite(errors, path, value) { if (!Number.isFinite(value)) issue(errors, path, 'NUMBER', '必须是有限数值'); }

function validateGraphData(data, errors) {
  if (!checkKeys(errors, 'data', data, new Set(['nodes', 'edges']))) return;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) { issue(errors, 'data', 'TYPE', 'nodes 和 edges 必须为数组'); return; }
  const ids = new Set();
  for (const [index, node] of data.nodes.entries()) {
    const nodePath = `data.nodes[${index}]`;
    if (!checkKeys(errors, nodePath, node, new Set(['id', 'label', 'group']))) continue;
    checkText(errors, `${nodePath}.id`, node.id); checkText(errors, `${nodePath}.label`, node.label);
    if (node.group !== undefined) checkText(errors, `${nodePath}.group`, node.group);
    if (ids.has(node.id)) issue(errors, `${nodePath}.id`, 'DUPLICATE_ID', '节点 ID 必须唯一');
    ids.add(node.id);
  }
  for (const [index, edge] of data.edges.entries()) {
    const edgePath = `data.edges[${index}]`;
    if (!checkKeys(errors, edgePath, edge, new Set(['from', 'to', 'label']))) continue;
    checkText(errors, `${edgePath}.from`, edge.from); checkText(errors, `${edgePath}.to`, edge.to);
    if (!ids.has(edge.from) || !ids.has(edge.to)) issue(errors, edgePath, 'EDGE_REFERENCE', '边必须引用存在节点');
    if (edge.label !== undefined) checkText(errors, `${edgePath}.label`, edge.label);
  }
}

function validateRaci(data, errors) {
  if (!checkKeys(errors, 'data', data, new Set(['roles', 'activities', 'assignments']))) return;
  if (!uniqueStrings(data.roles) || !uniqueStrings(data.activities) || !Array.isArray(data.assignments)) { issue(errors, 'data', 'RACI_DIMENSION', '角色、活动必须为非重复文本数组，assignments 必须为数组'); return; }
  for (const [index, item] of data.assignments.entries()) {
    const itemPath = `data.assignments[${index}]`;
    if (!checkKeys(errors, itemPath, item, new Set(['activity', 'role', 'responsibility']))) continue;
    if (!data.activities.includes(item.activity) || !data.roles.includes(item.role) || !['R', 'A', 'C', 'I'].includes(item.responsibility)) issue(errors, itemPath, 'RACI_REFERENCE', 'RACI 维度或责任标记无效');
  }
}

function validateMatrix(data, errors) {
  if (!checkKeys(errors, 'data', data, new Set(['rows', 'columns', 'cells']))) return;
  if (!uniqueStrings(data.rows) || !uniqueStrings(data.columns) || !Array.isArray(data.cells)) { issue(errors, 'data', 'MATRIX_DIMENSION', '矩阵行列必须为非重复文本数组'); return; }
  for (const [index, cell] of data.cells.entries()) {
    const cellPath = `data.cells[${index}]`;
    if (!checkKeys(errors, cellPath, cell, new Set(['row', 'column', 'label']))) continue;
    if (!data.rows.includes(cell.row) || !data.columns.includes(cell.column)) issue(errors, cellPath, 'MATRIX_REFERENCE', '矩阵单元格必须引用既有行列');
    checkText(errors, `${cellPath}.label`, cell.label);
  }
}

function validateSeries(data, errors) {
  if (!checkKeys(errors, 'data', data, new Set(['labels', 'series']))) return;
  if (!uniqueStrings(data.labels) || !Array.isArray(data.series)) { issue(errors, 'data', 'SERIES', 'labels 和 series 无效'); return; }
  const ids = new Set();
  for (const [index, series] of data.series.entries()) {
    const itemPath = `data.series[${index}]`;
    if (!checkKeys(errors, itemPath, series, new Set(['id', 'label', 'values']))) continue;
    checkText(errors, `${itemPath}.id`, series.id); checkText(errors, `${itemPath}.label`, series.label);
    if (ids.has(series.id)) issue(errors, `${itemPath}.id`, 'DUPLICATE_ID', '序列 ID 必须唯一');
    ids.add(series.id);
    if (!Array.isArray(series.values) || series.values.length !== data.labels.length) issue(errors, `${itemPath}.values`, 'SERIES_DIMENSION', '序列值数量必须与标签一致');
    for (const [valueIndex, value] of (series.values || []).entries()) checkFinite(errors, `${itemPath}.values[${valueIndex}]`, value);
  }
}

function validateGantt(data, errors) {
  if (!checkKeys(errors, 'data', data, new Set(['tasks'])) || !Array.isArray(data?.tasks)) { issue(errors, 'data.tasks', 'TYPE', 'tasks 必须为数组'); return; }
  const ids = new Set();
  for (const [index, task] of data.tasks.entries()) {
    const taskPath = `data.tasks[${index}]`;
    if (!checkKeys(errors, taskPath, task, new Set(['id', 'label', 'start', 'end', 'depends_on']))) continue;
    for (const key of ['id', 'label', 'start', 'end']) checkText(errors, `${taskPath}.${key}`, task[key]);
    if (ids.has(task.id)) issue(errors, `${taskPath}.id`, 'DUPLICATE_ID', '任务 ID 必须唯一');
    ids.add(task.id);
    if (task.depends_on !== undefined && (!Array.isArray(task.depends_on) || task.depends_on.some((id) => !safeText(id)))) issue(errors, `${taskPath}.depends_on`, 'DEPENDENCY', '依赖任务必须为文本数组');
  }
  for (const [index, task] of data.tasks.entries()) for (const id of task.depends_on || []) if (!ids.has(id)) issue(errors, `data.tasks[${index}].depends_on`, 'DEPENDENCY', '依赖任务必须存在');
}

function validateChartDsl(spec) {
  const errors = [];
  if (!checkKeys(errors, '$', spec, ROOT_FIELDS)) return { valid: false, errors };
  if (spec.schema_version !== 1) issue(errors, 'schema_version', 'VERSION', '仅支持 schema_version 1');
  if (!CHART_TYPES.includes(spec.chart_type)) issue(errors, 'chart_type', 'TYPE', '图表类型不受支持');
  checkText(errors, 'title', spec.title);
  if (spec.theme !== 'jato-business') issue(errors, 'theme', 'THEME', '仅支持 jato-business 主题');
  if (checkKeys(errors, 'layout', spec.layout, LAYOUT_FIELDS)) {
    if (spec.layout?.width !== 1240) issue(errors, 'layout.width', 'WIDTH', '版式宽度必须为 1240');
    if (!['compact', 'normal', 'relaxed'].includes(spec.layout?.density)) issue(errors, 'layout.density', 'DENSITY', '密度无效');
    if (!['landscape', 'portrait'].includes(spec.layout?.orientation)) issue(errors, 'layout.orientation', 'ORIENTATION', '方向无效');
  }
  if (GRAPH_TYPES.has(spec.chart_type)) validateGraphData(spec.data, errors);
  else if (spec.chart_type === 'gantt') validateGantt(spec.data, errors);
  else if (spec.chart_type === 'raci') validateRaci(spec.data, errors);
  else if (MATRIX_TYPES.has(spec.chart_type)) validateMatrix(spec.data, errors);
  else if (SERIES_TYPES.has(spec.chart_type)) validateSeries(spec.data, errors);
  else if (spec.chart_type === 'pie') {
    if (!checkKeys(errors, 'data', spec.data, new Set(['items'])) || !Array.isArray(spec.data?.items)) issue(errors, 'data.items', 'TYPE', 'items 必须为数组');
    for (const [index, item] of (spec.data?.items || []).entries()) { checkKeys(errors, `data.items[${index}]`, item, new Set(['id', 'label', 'value'])); checkText(errors, `data.items[${index}].id`, item?.id); checkText(errors, `data.items[${index}].label`, item?.label); checkFinite(errors, `data.items[${index}].value`, item?.value); }
  } else if (spec.chart_type === 'table') {
    if (!checkKeys(errors, 'data', spec.data, new Set(['columns', 'rows'])) || !uniqueStrings(spec.data?.columns) || !Array.isArray(spec.data?.rows)) issue(errors, 'data', 'TABLE', '表格列和行无效');
    for (const [index, row] of (spec.data?.rows || []).entries()) if (!Array.isArray(row) || row.length !== spec.data.columns.length || row.some((cell) => !safeText(cell))) issue(errors, `data.rows[${index}]`, 'TABLE_ROW', '表格行必须与列一致且为安全纯文本');
  }
  return { valid: errors.length === 0, errors };
}

function assertValidChartDsl(spec) {
  const result = validateChartDsl(spec);
  if (!result.valid) throw new Error(`结构化图表无效：${result.errors[0].path} ${result.errors[0].message}`);
  return spec;
}

module.exports = { assertValidChartDsl, validateChartDsl };
