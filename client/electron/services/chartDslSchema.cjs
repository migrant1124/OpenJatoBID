const CHART_TYPES = ['gantt', 'network', 'organization', 'swimlane', 'raci', 'risk-matrix', 'architecture', 'wbs', 'fishbone', 'timeline', 'process', 'hierarchy', 'responsibility', 'bar', 'line', 'pie', 'table'];
const GRAPH_TYPES = new Set(['network', 'organization', 'architecture', 'wbs', 'fishbone', 'timeline', 'process', 'hierarchy']);
const MATRIX_TYPES = new Set(['swimlane', 'risk-matrix', 'responsibility']);
const SERIES_TYPES = new Set(['bar', 'line']);
const ROOT_FIELDS = new Set(['schema_version', 'chart_type', 'title', 'theme', 'layout', 'data']);
const LAYOUT_FIELDS = new Set(['width', 'density', 'orientation']);

module.exports = { CHART_TYPES, GRAPH_TYPES, LAYOUT_FIELDS, MATRIX_TYPES, ROOT_FIELDS, SERIES_TYPES };
