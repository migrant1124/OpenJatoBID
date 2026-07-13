export type NumberingPolicy = 'auto' | 'preserve-source' | 'none';

export type ResponseMode =
  | 'freeform-markdown'
  | 'fixed-markdown-table'
  | 'locked-commitment'
  | 'evidence-markdown'
  | 'container'
  | 'explicit-none';

export type ResponseStatus =
  | 'pending'
  | 'responded-substantive'
  | 'responded-none'
  | 'needs-manual-input'
  | 'missing-required-evidence';

export type ComplianceRisk = 'none' | 'warning' | 'high' | 'potential-rejection';

export interface RequirementSource {
  source_file_id: string;
  source_file_name?: string;
  section_hint?: string;
  markdown_line_start: number;
  markdown_line_end: number;
  page_hint?: string;
  excerpt?: string;
}

export interface LockedSegment {
  type: 'locked';
  text: string;
  hash?: string;
}

export interface TemplateSlot {
  type: 'slot';
  slot_id: string;
  label: string;
  value_source: 'project-info' | 'part-a-info' | 'company-knowledge' | 'manual';
  required: boolean;
}

export interface LockedCommitmentTemplate {
  kind: 'locked-commitment';
  segments: Array<LockedSegment | TemplateSlot>;
}

export interface LockedTemplateValues {
  template_id: string;
  slot_values: Record<string, string>;
  knowledge_item_ids: string[];
  missing_slots: string[];
}

export interface FixedTableCell {
  kind: 'locked' | 'slot';
  text?: string;
  slot_id?: string;
  label?: string;
  value_source?: 'project-info' | 'part-a-info' | 'company-knowledge' | 'manual';
  required?: boolean;
}

export interface FixedTableRow {
  row_id: string;
  cells: FixedTableCell[];
}

export interface RepeatableTableRegion {
  kind: 'repeatable-region';
  region_id: string;
  row_template: FixedTableRow;
  min_rows: number;
  max_rows?: number;
}

export interface FixedTableBodyRow {
  kind: 'row';
  row: FixedTableRow;
}

export type FixedTableBodyItem = FixedTableBodyRow | RepeatableTableRegion;

export interface FixedMarkdownTableTemplate {
  kind: 'fixed-markdown-table';
  table_title?: string;
  headers: string[];
  body: FixedTableBodyItem[];
  fixed_notes: string[];
  empty_response_text?: string;
}

export interface FixedTableValues {
  template_id: string;
  cell_values: Record<string, string>;
  repeatable_rows: Record<string, Array<Record<string, string>>>;
  knowledge_item_ids: string[];
  missing_fields: string[];
}

export interface ResponseTemplateRecord {
  template_id: string;
  kind: 'locked-commitment' | 'fixed-markdown-table';
  analysis_item_id: 'bidDocumentFormatRequirements';
  profile_id: string;
  format_node_id: string;
  source_title: string;
  source_location: RequirementSource;
  template: LockedCommitmentTemplate | FixedMarkdownTableTemplate;
  confirmed: boolean;
  locked_hash?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OutlineFormatConstraints {
  format_node_id?: string;
  source_number?: string;
  source_title?: string;
  numbering_policy: NumberingPolicy;
  required_in_outline: boolean;
  response_required: boolean;
  title_locked: boolean;
  order_locked: boolean;
  level_locked: boolean;
  response_mode: ResponseMode;
  allow_ai_children: boolean;
  template_id?: string;
  empty_response_text?: string;
  missing_evidence_risk?: 'high' | 'potential-rejection';
  mapped_requirement_ids: string[];
}

export interface OutlineResponseState {
  template_values?: LockedTemplateValues | FixedTableValues;
  knowledge_item_ids: string[];
  response_status: ResponseStatus;
  compliance_risk: ComplianceRisk;
  compliance_message?: string;
}

export interface OutlineItem {
  id: string;
  title: string;
  description: string;
  format_node_id?: string;
  source_number?: string;
  source_title?: string;
  numbering_policy?: NumberingPolicy;
  required_in_outline?: boolean;
  response_required?: boolean;
  title_locked?: boolean;
  order_locked?: boolean;
  level_locked?: boolean;
  response_mode?: ResponseMode;
  allow_ai_children?: boolean;
  template_id?: string;
  empty_response_text?: string;
  missing_evidence_risk?: 'high' | 'potential-rejection';
  mapped_requirement_ids?: string[];
  template_values?: LockedTemplateValues | FixedTableValues;
  response_status?: ResponseStatus;
  compliance_risk?: ComplianceRisk;
  compliance_message?: string;
  source_requirement_id?: string;
  source_requirement_title?: string;
  knowledge_item_ids?: string[];
  children?: OutlineItem[];
  content?: string;
}

export type OutlineMode = 'aligned';
export type OutlineExpansionMode = 'original-only' | 'ai-complement';

export interface OutlineData {
  outline: OutlineItem[];
  project_name?: string;
  project_overview?: string;
}

export interface TechnicalRequirementGroup {
  requirement_id: string;
  title: string;
  description: string;
  detail_points: string[];
}
