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

export interface OutlineFormatConstraints {
  manual_input_required: boolean;
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
  empty_response_text?: string;
  missing_evidence_risk?: 'high' | 'potential-rejection';
  mapped_requirement_ids: string[];
}

export interface OutlineResponseState {
  template_values?: Record<string, unknown>;
  knowledge_item_ids: string[];
  response_status: ResponseStatus;
  compliance_risk: ComplianceRisk;
  compliance_message?: string;
}

export interface OutlineItem {
  id: string;
  title: string;
  description: string;
  manual_input_required?: boolean;
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
  empty_response_text?: string;
  missing_evidence_risk?: 'high' | 'potential-rejection';
  mapped_requirement_ids?: string[];
  template_values?: Record<string, unknown>;
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
