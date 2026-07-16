export type DiagnosticStatus = 'idle' | 'running' | 'ok' | 'warning' | 'error' | 'not-configured' | 'skipped' | 'cancelled';
export interface DiagnosticItemResult { id: string; status: DiagnosticStatus; message: string; impact: string; action: string; checked_at: string; duration_ms: number; }
export interface DiagnosticsSnapshot { status: DiagnosticStatus; checked_at: string; results: DiagnosticItemResult[]; }
