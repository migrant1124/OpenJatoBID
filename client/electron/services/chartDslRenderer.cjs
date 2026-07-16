const { assertValidChartDsl } = require('./chartDslValidator.cjs');

function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function graphItems(data) { return (data.nodes || []).map((node) => `<li><strong>${escapeHtml(node.label)}</strong>${node.group ? `<span>${escapeHtml(node.group)}</span>` : ''}</li>`).join(''); }
function tableRows(data) { return `<table><thead><tr>${(data.columns || []).map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${(data.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }

function renderChartBody(spec) {
  if (spec.chart_type === 'raci') {
    const { roles, activities, assignments } = spec.data;
    return `<table><thead><tr><th>活动</th>${roles.map((role) => `<th>${escapeHtml(role)}</th>`).join('')}</tr></thead><tbody>${activities.map((activity) => `<tr><th>${escapeHtml(activity)}</th>${roles.map((role) => `<td>${escapeHtml(assignments.find((item) => item.activity === activity && item.role === role)?.responsibility || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (spec.chart_type === 'table') return tableRows(spec.data);
  if (['bar', 'line'].includes(spec.chart_type)) return `<table><thead><tr><th>标签</th>${spec.data.series.map((item) => `<th>${escapeHtml(item.label)}</th>`).join('')}</tr></thead><tbody>${spec.data.labels.map((label, index) => `<tr><th>${escapeHtml(label)}</th>${spec.data.series.map((item) => `<td>${item.values[index]}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (spec.chart_type === 'pie') return `<ul class="cards">${spec.data.items.map((item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${item.value}</span></li>`).join('')}</ul>`;
  if (spec.chart_type === 'gantt') return `<ul class="cards">${spec.data.tasks.map((item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.start)} — ${escapeHtml(item.end)}</span></li>`).join('')}</ul>`;
  if (['swimlane', 'risk-matrix', 'responsibility'].includes(spec.chart_type)) return `<table><thead><tr><th></th>${spec.data.columns.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${spec.data.rows.map((row) => `<tr><th>${escapeHtml(row)}</th>${spec.data.columns.map((column) => `<td>${escapeHtml(spec.data.cells.find((cell) => cell.row === row && cell.column === column)?.label || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<ul class="cards">${graphItems(spec.data)}</ul>`;
}

function renderChartToHtml(spec) {
  assertValidChartDsl(spec);
  return `<section class="jato-chart jato-chart-${escapeHtml(spec.chart_type)}"><h1>${escapeHtml(spec.title)}</h1>${renderChartBody(spec)}</section><style>.jato-chart{width:1240px;padding:52px;background:#fff;color:#243048;font-family:"Microsoft YaHei",sans-serif}.jato-chart h1{margin:0 0 30px;font-size:32px}.jato-chart table{width:100%;border-collapse:collapse}.jato-chart th,.jato-chart td{padding:14px;border:1px solid #cfd8ee;text-align:left}.jato-chart th{background:#eef5ff}.jato-chart .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:0;list-style:none}.jato-chart .cards li{min-height:94px;padding:18px;border:1px solid #cfd8ee;border-radius:10px;background:#f8fbff}.jato-chart .cards span{display:block;margin-top:8px;color:#536176}</style>`;
}

module.exports = { renderChartToHtml };
