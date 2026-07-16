export const CHART_TYPES = ['gantt', 'network', 'organization', 'swimlane', 'raci', 'risk-matrix', 'architecture', 'wbs', 'fishbone', 'timeline', 'process', 'hierarchy', 'responsibility', 'bar', 'line', 'pie', 'table'] as const;

export type ChartType = typeof CHART_TYPES[number];
export interface ChartLayout { width: 1240; density: 'compact' | 'normal' | 'relaxed'; orientation: 'landscape' | 'portrait'; }
export interface ChartNode { id: string; label: string; group?: string; }
export interface ChartEdge { from: string; to: string; label?: string; }
export interface GraphChartData { nodes: ChartNode[]; edges: ChartEdge[]; }
export interface GanttChartData { tasks: Array<{ id: string; label: string; start: string; end: string; depends_on?: string[] }>; }
export interface RaciChartData { roles: string[]; activities: string[]; assignments: Array<{ activity: string; role: string; responsibility: 'R' | 'A' | 'C' | 'I' }>; }
export interface MatrixChartData { rows: string[]; columns: string[]; cells: Array<{ row: string; column: string; label: string }>; }
export interface SeriesChartData { labels: string[]; series: Array<{ id: string; label: string; values: number[] }>; }
export interface PieChartData { items: Array<{ id: string; label: string; value: number }>; }
export interface TableChartData { columns: string[]; rows: string[][]; }
export type ChartData = GraphChartData | GanttChartData | RaciChartData | MatrixChartData | SeriesChartData | PieChartData | TableChartData;
export interface ChartDsl { schema_version: 1; chart_type: ChartType; title: string; theme: 'jato-business'; layout: ChartLayout; data: ChartData; }
export interface ChartDslValidationIssue { path: string; code: string; message: string; }
export interface ChartDslValidationResult { valid: boolean; errors: ChartDslValidationIssue[]; }
