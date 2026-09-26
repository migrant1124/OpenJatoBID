const { assertValidChartDsl } = require('./chartDslValidator.cjs');

function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function graphItems(data) { return (data.nodes || []).map((node) => `<li><strong>${escapeHtml(node.label)}</strong>${node.group ? `<span>${escapeHtml(node.group)}</span>` : ''}</li>`).join(''); }
function tableRows(data) { return `<table><thead><tr>${(data.columns || []).map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${(data.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }

function graphDiagram(spec) {
  const nodes = spec.data.nodes || [];
  const edges = spec.data.edges || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  // Longest predecessor path keeps branches and real parent-child edges visible.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.min(nodes.length - 1, depth.get(edge.from) + 1);
      if (next > depth.get(edge.to)) { depth.set(edge.to, next); changed = true; }
    }
    if (!changed) break;
  }
  if (spec.chart_type === 'timeline' && !edges.length) nodes.forEach((node, index) => depth.set(node.id, index));
  const levels = new Map();
  for (const node of nodes) levels.set(depth.get(node.id), [...(levels.get(depth.get(node.id)) || []), node]);
  const horizontal = spec.chart_type === 'process' || spec.chart_type === 'timeline';
  const maxDepth = Math.max(0, ...depth.values());
  const positions = new Map();
  for (const [level, row] of levels) row.forEach((node, index) => {
    const x = horizontal ? 120 + level * (920 / Math.max(1, maxDepth)) : row.length === 1 ? 580 : 120 + index * (920 / (row.length - 1));
    const y = horizontal ? row.length === 1 ? 355 : 115 + index * (480 / (row.length - 1)) : 105 + level * (500 / Math.max(1, maxDepth));
    positions.set(node.id, { x, y });
  });
  const links = edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to)).map((edge) => {
    const from = positions.get(edge.from); const to = positions.get(edge.to);
    const x1 = horizontal ? from.x + 110 : from.x;
    const y1 = horizontal ? from.y : from.y + 46;
    const x2 = horizontal ? to.x - 110 : to.x;
    const y2 = horizontal ? to.y : to.y - 46;
    return `<g class="link"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle">${escapeHtml(edge.label || '')}</text></g>`;
  }).join('');
  const boxes = nodes.map((node) => {
    const { x, y } = positions.get(node.id);
    return `<g class="node"><rect x="${x - 110}" y="${y - 46}" width="220" height="92" rx="10"/><foreignObject x="${x - 104}" y="${y - 42}" width="208" height="84"><div xmlns="http://www.w3.org/1999/xhtml" class="node-text"><strong>${escapeHtml(node.label)}</strong>${node.group ? `<small>${escapeHtml(node.group)}</small>` : ''}</div></foreignObject></g>`;
  }).join('');
  return `<svg class="graph" viewBox="0 0 1160 660" role="img" aria-label="${escapeHtml(spec.title)}"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9" fill="none" stroke="#386ba8"/></marker></defs>${links}${boxes}</svg>`;
}

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
  if (['process', 'organization', 'timeline', 'architecture'].includes(spec.chart_type)) return graphDiagram(spec);
  return `<ul class="cards">${graphItems(spec.data)}</ul>`;
}

function renderChartToHtml(spec) {
  assertValidChartDsl(spec);
  return `<section class="jato-chart jato-chart-${escapeHtml(spec.chart_type)}"><h1>${escapeHtml(spec.title)}</h1>${renderChartBody(spec)}</section><style>
.jato-chart{width:1280px;padding:36px;background:#fff;color:#243048;font-family:"Microsoft YaHei",sans-serif}
.jato-chart h1{margin:0 0 24px;font-size:32px}
.jato-chart table{width:100%;border-collapse:collapse}.jato-chart th,.jato-chart td{padding:14px;border:1px solid #cfd8ee;text-align:left}.jato-chart th{background:#eef5ff}
.jato-chart .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:0;list-style:none}.jato-chart .cards li{min-height:94px;padding:18px;border:1px solid #cfd8ee;border-radius:10px;background:#f8fbff}.jato-chart .cards span{display:block;margin-top:8px;color:#536176}
.jato-chart .graph{width:100%;height:760px}.jato-chart-process .graph,.jato-chart-timeline .graph{height:560px}
.jato-chart .link line{stroke:#386ba8;stroke-width:2.5}.jato-chart .link text{font-size:24px;fill:#536176}
.jato-chart .node rect{fill:#eef5ff;stroke:#386ba8;stroke-width:2}.jato-chart .node-text{height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:24px;line-height:1.2}.jato-chart .node-text small{font-size:24px;color:#536176;margin-top:3px}
</style>`;
}

module.exports = { renderChartToHtml };
