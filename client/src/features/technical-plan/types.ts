import type {
  OutlineData,
  OutlineExpansionMode,
  OutlineMode,
  OutlineWordControlOptions,
} from '../../shared/types/outline';

export type TechnicalPlanStep = 'document-analysis' | 'bid-analysis' | 'outline-generation' | 'global-facts' | 'content-edit' | 'expand';
export type TechnicalPlanWorkflowKind = 'technical-plan' | 'existing-plan-expansion';
export type BidAnalysisMode = 'key' | 'full' | 'custom';
export type BidAnalysisTaskStatus = 'idle' | 'running' | 'success' | 'error';
export type BidSectionMode = 'single' | 'multiple';
export type BidSectionExtractionStatus = 'idle' | 'running' | 'success' | 'error';
export type BackgroundTaskType = 'bid-section-extraction' | 'bid-analysis' | 'outline-generation' | 'global-facts-generation' | 'content-generation';
export type BackgroundTaskStatus = 'running' | 'pausing' | 'paused' | 'success' | 'error';
export type ContentGenerationSectionStatus = 'idle' | 'running' | 'success' | 'error';
export type ContentGenerationPhase = 'planning' | 'restoring' | 'generating' | 'outline-expanding' | 'expanding' | 'original-auditing' | 'auditing' | 'table-cleaning' | 'illustration-planning' | 'illustration-confirmation' | 'illustration-generating' | 'done';
export type ContentTableRequirement = 'none' | 'light' | 'moderate' | 'heavy';
export type ConsistencyRepairMode = 'agent' | 'normal';
export type OriginalPlanCoverageRepairMode = 'agent' | 'normal';
export type SaveOutlineReason = 'sort' | 'edit' | 'delete' | 'add-root' | 'add-child' | 'replace';

export interface SaveOutlineRequest {
  outlineData: OutlineData;
  reason: SaveOutlineReason;
  idMap?: Record<string, string>;
  affectedNodeIds?: string[];
}

export interface ContentGenerationOptions {
  useAiImages: boolean;
  useHtmlImages: boolean;
  htmlImageTypes: string;
  tableRequirement: ContentTableRequirement;
  enableConsistencyAudit: boolean;
  consistencyRepairMode: ConsistencyRepairMode;
  enableOriginalPlanCoverageAudit: boolean;
  originalPlanCoverageRepairMode: OriginalPlanCoverageRepairMode;
}

export interface ContentGenerationProgressDetail {
  phase: ContentGenerationPhase;
  phase_label: string;
  phase_progress: number;
  completed: number;
  total: number;
  step: string;
  step_label: string;
}

export interface BackgroundTaskState {
  task_id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  progress: number;
  progress_detail?: ContentGenerationProgressDetail;
  logs: string[];
  started_at: string;
  updated_at: string;
  error?: string;
  stats?: {
    content?: {
      phase: ContentGenerationPhase;
      planning_total: number;
      planning_completed: number;
      generation_total: number;
      generation_completed: number;
      outline_expansion_total?: number;
      outline_expansion_completed?: number;
      outline_expansion_step_total?: number;
      outline_expansion_step_completed?: number;
      outline_expansion_round?: number;
      outline_expansion_round_total?: number;
      outline_expansion_step_label?: string;
      minimum_words?: number;
      current_words?: number;
      audit_group_total?: number;
      audit_group_completed?: number;
      audit_conflict_total?: number;
      audit_fix_total?: number;
      audit_fix_completed?: number;
      audit_fix_failed?: number;
      audit_repair_mode?: ConsistencyRepairMode | '';
      audit_agent_step_total?: number;
      audit_agent_step_completed?: number;
      audit_agent_step_label?: string;
      audit_agent_changed_sections?: number;
      audit_agent_failed_sections?: number;
      table_cleanup_total?: number;
      table_cleanup_completed?: number;
      table_cleanup_rewritten?: number;
      table_cleanup_skipped?: number;
      illustration_planning_step_total?: number;
      illustration_planning_step_completed?: number;
      illustration_planning_step_label?: string;
      illustration_candidate_ai?: number;
      illustration_candidate_chart?: number;
      illustration_candidate_html?: number;
      illustration_selected_ai?: number;
      illustration_selected_chart?: number;
      illustration_selected_html?: number;
      illustration_generation_total?: number;
      illustration_generation_completed?: number;
      illustration_generation_ai_total?: number;
      illustration_generation_ai_completed?: number;
      illustration_generation_chart_total?: number;
      illustration_generation_chart_completed?: number;
      illustration_generation_html_total?: number;
      illustration_generation_html_completed?: number;
      illustration_generation_step_label?: string;
    };
  };
}

export interface BidAnalysisTaskState {
  id: string;
  label: string;
  status: BidAnalysisTaskStatus;
  content: string;
  normalized_hash?: string;
  error?: string;
  analysis_context?: BidAnalysisTaskAnalysisContext;
  diagnostic?: BidAnalysisTaskDiagnostic;
  requires_manual_review?: boolean;
}

export type BidAnalysisTasks = Record<string, BidAnalysisTaskState>;

export interface RequirementSourceReference {
  source_type: 'tender' | 'appendix' | 'footnote' | 'original-plan' | 'knowledge' | 'user-input';
  document_id?: string;
  section?: string;
  block_id?: string;
  quote?: string;
  page?: number;
}

export interface AtomicScoringPoint {
  scoring_point_id: string;
  group_requirement_id: string;
  title: string;
  requirement_text: string;
  scoring_rule: string;
  score_value?: number;
  score_text?: string;
  source_refs: RequirementSourceReference[];
  mandatory_level: 'normal' | 'important' | 'high' | 'potential-rejection';
  expected_response_types: Array<'content' | 'table' | 'illustration' | 'evidence' | 'commitment' | 'manual'>;
  high_score_conditions: string[];
  suggested_section?: string;
  writing_focus?: string;
  mapped_node_ids: string[];
  primary_node_id?: string;
  status: 'unmapped' | 'mapped' | 'covered' | 'needs-review';
}

export interface RejectionRiskItem {
  risk_id: string;
  source_refs: RequirementSourceReference[];
  trigger: string;
  category: 'technical-response' | 'format' | 'attachment' | 'signature' | 'submission' | 'evidence' | 'other';
  risk_level: 'high' | 'potential-rejection';
  handling_route: 'outline' | 'fixed-form' | 'evidence' | 'export' | 'submission' | 'manual-review';
  mapped_node_ids: string[];
  mitigation: string;
  status: 'unhandled' | 'covered' | 'not-applicable' | 'needs-confirmation';
}

export interface HiddenRequirementItem {
  hidden_requirement_id: string;
  source_kind: 'appendix' | 'footnote' | 'table-note' | 'cross-reference' | 'upload-rule' | 'naming-rule' | 'other';
  requirement_text: string;
  source_refs: RequirementSourceReference[];
  handling_route: 'outline' | 'content' | 'fixed-form' | 'evidence' | 'export' | 'submission' | 'manual-review';
  mapped_node_ids: string[];
  status: 'unhandled' | 'covered' | 'not-applicable' | 'needs-confirmation';
}

export interface ValueAnchor {
  anchor_id: string;
  title: string;
  category: 'resilience-emergency' | 'quality-improvement' | 'schedule-assurance' | 'acceptance-readiness' | 'service-capability' | 'risk-governance' | 'data-closed-loop' | 'collaboration-governance' | 'creative-value' | 'visual-expression';
  base_scoring_point_ids: string[];
  business_value: string;
  directory_recommended: boolean;
  deep_writing_recommended: boolean;
  support_state: 'tender-supported' | 'original-plan-supported' | 'knowledge-supported' | 'industry-template' | 'needs-confirmation';
  content_requirements: string[];
  table_recommendations: string[];
  visual_recommendations: string[];
  risk_notes: string[];
  route: 'directory' | 'writing' | 'table' | 'illustration' | 'risk' | 'manual-review';
  status: 'candidate' | 'accepted' | 'rejected' | 'needs-confirmation';
  recommended_parent_id?: string;
  directory_gate: {
    scope_relevant: boolean;
    score_or_delivery_value: boolean;
    actionable: boolean;
    section_capacity: boolean;
    evidence_safe: boolean;
    non_duplicate: boolean;
    format_allowed: boolean;
  };
}

export interface RequirementResponseMatrix {
  schema_version: 1;
  revision: string;
  scoring_points: AtomicScoringPoint[];
  rejection_risks: RejectionRiskItem[];
  hidden_requirements: HiddenRequirementItem[];
  value_anchors: ValueAnchor[];
  updated_at: string;
}

export interface BidAnalysisTaskAnalysisContext {
  run_id?: string;
  document_id?: string;
  document_version?: string;
  prompt_version?: string;
  anchor_catalog_hash?: string;
}

export interface BidAnalysisTaskDiagnostic extends BidAnalysisTaskAnalysisContext {
  error_code: string;
  error_path?: string;
  message?: string;
  requires_manual_review?: boolean;
}

export interface BidAnalysisTaskDefinition {
  id: string;
  label: string;
  description: string;
  required: boolean;
  output: 'markdown' | 'json';
  group: 'key' | 'optional';
  schema_version?: number;
}

export interface GlobalFactGroupState {
  id: string;
  title: string;
  content: string;
  updated_at?: string;
}

export interface ContentGenerationSectionState {
  id: string;
  title: string;
  status: ContentGenerationSectionStatus;
  content: string;
  error?: string;
  updated_at?: string;
}

export type ContentGenerationSections = Record<string, ContentGenerationSectionState>;

export type ContentIllustrationKind = 'ai' | 'chart' | 'html';
export type ContentIllustrationPlacement = 'before' | 'after';
export type ContentIllustrationAnchorType = 'before_block' | 'after_block' | 'after_heading' | 'section_end';

export interface ContentIllustrationAnchor {
  type: ContentIllustrationAnchorType;
  section_id: string;
  block_id?: string;
  block_hash?: string;
  sequence: number;
}

export interface CreativeBrief {
  client_profile: string;
  project_goal: string;
  target_audience: string[];
  campaign_theme: string;
  key_message: string;
  event_type?: string;
  venue_and_scene?: string;
  mandatory_elements: string[];
  prohibited_elements: string[];
  style_keywords: string[];
  brand_colors: string[];
  brand_assets: string[];
  deliverable_type: string;
  aspect_ratio: string;
  source_scoring_point_ids: string[];
  source_value_anchor_ids: string[];
  needs_user_confirmation: string[];
}

export interface ContentPlanFingerprint {
  outline_node_hash: string;
  parent_outline_hash: string;
  scoring_matrix_revision: string;
  global_facts_revision: string;
  knowledge_document_revisions: string[];
  original_plan_hash?: string;
  prompt_version: string;
  writing_profile: 'standard' | 'deep' | 'creative-proposal';
}

export interface ContentGenerationPlanData {
  writing_focus?: string;
  writing_profile: 'standard' | 'deep' | 'creative-proposal';
  section_role: string;
  scoring_point_ids: string[];
  value_anchor_ids: string[];
  must_answer_questions: string[];
  key_claims: string[];
  implementation_steps: string[];
  quantitative_details: string[];
  deliverables: string[];
  acceptance_criteria: string[];
  evidence_requirements: string[];
  cross_section_boundaries: { owns: string[]; excludes: string[]; related_node_ids: string[] };
  knowledge: {
    item_ids: string[];
  };
  facts: {
    titles: string[];
  };
  table: {
    needed: boolean;
    purpose: string;
  };
  table_briefs: Array<{ id: string; title: string; purpose: string; columns?: string[] }>;
  illustration_briefs: Array<{ id: string; title: string; purpose: string; visual_role?: string }>;
  target_words: { min: number; preferred: number; max: number };
  forbidden_repetition: string[];
  chapter_task?: Record<string, unknown>;
  original_material?: {
    restored: boolean;
    optimized: boolean;
    source_ids: string[];
    source_titles: string[];
    source_hashes: string[];
    restored_chars: number;
    restored_at?: string;
    optimized_at?: string;
  };
}

export interface ContentGenerationPlanState {
  plan_version: number;
  plan: ContentGenerationPlanData;
  fingerprint?: ContentPlanFingerprint;
  table_requirement?: 'none' | 'light' | 'moderate' | 'heavy';
  updated_at?: string;
}

export type ContentGenerationPlans = Record<string, ContentGenerationPlanState>;

export interface ContentIllustrationPlanItem {
  item_id: string;
  kind: ContentIllustrationKind;
  image_type: string;
  title: string;
  section_ids: string[];
  placement?: ContentIllustrationPlacement;
  visual_role?: string;
  purpose?: string;
  scoring_point_ids?: string[];
  value_anchor_ids?: string[];
  anchor?: ContentIllustrationAnchor;
  aspect_ratio?: string;
  creative_brief?: CreativeBrief;
  priority: number;
  selected?: boolean;
  generation?: {
    status: 'pending' | 'running' | 'success' | 'error';
    mode?: 'normal' | 'agent';
    code?: string;
    source_path?: string;
    asset_url?: string;
    attempts?: number;
    visual_qa?: {
      status: 'rendered' | 'needs-manual-review';
      reason: string;
      width?: number;
      height?: number;
      layout_repair_attempts?: number;
    };
    error?: string;
    updated_at?: string;
  };
}

export interface ContentIllustrationVisualRhythmDiagnostic {
  code: string;
  message: string;
  section_ids: string[];
}

export interface ContentIllustrationPlanState {
  plan_version: number;
  revision: string;
  items: ContentIllustrationPlanItem[];
  confirmation_status?: 'pending' | 'confirmed';
  recommended_visual_style?: string;
  visual_style?: string;
  visual_rhythm_diagnostics?: ContentIllustrationVisualRhythmDiagnostic[];
  updated_at?: string;
}

export interface ContentGenerationRuntimeState {
  phase?: string;
  touched_item_ids?: string[];
  outline_expansion_completed?: number;
  expansion_cycle_item_ids?: string[];
  expansion_attempted_item_ids?: string[];
  expansion_cycle_start_words?: number;
  target_item_id?: string;
  regenerate_requirement?: string;
  updated_at?: string;
}

export interface TechnicalPlanTenderFile {
  fileName: string;
  markdownPath: string;
  markdownChars: number;
  contentHash: string;
  originalMarkdownPath?: string;
  originalMarkdownChars?: number;
  originalContentHash?: string;
  parserLabel?: string;
  importedAt?: string;
  selectedSectionId?: string;
  selectedSectionTitle?: string;
  updatedAt: string;
}

export interface TechnicalPlanTenderSourceFile {
  id: string;
  fileName: string;
  markdownPath: string;
  markdownChars: number;
  contentHash: string;
  parserLabel?: string;
  importedAt?: string;
  updatedAt: string;
}

export interface TechnicalPlanOriginalPlanFile {
  fileName: string;
  markdownPath: string;
  markdownChars: number;
  contentHash: string;
  parserLabel?: string;
  importedAt?: string;
  updatedAt: string;
}

export interface BidSectionLineRange {
  startLine: number;
  endLine: number;
  reason?: string;
}

export interface DetectedBidSection {
  id: string;
  index: number;
  unit: string;
  title: string;
  headLine: string;
  description: string;
  includeRanges?: BidSectionLineRange[];
  evidence?: string[];
}

export interface TechnicalPlanState {
  workflowKind: TechnicalPlanWorkflowKind;
  step: TechnicalPlanStep;
  tenderFile: TechnicalPlanTenderFile | null;
  tenderFiles: TechnicalPlanTenderSourceFile[];
  originalPlanFile: TechnicalPlanOriginalPlanFile | null;
  projectOverview: string;
  techRequirements: string;
  bidAnalysisMode: BidAnalysisMode;
  bidAnalysisSelectedTaskIds: string[];
  bidAnalysisTaskDefinitions: BidAnalysisTaskDefinition[];
  bidAnalysisTasks: BidAnalysisTasks;
  bidAnalysisProgress: number;
  bidSectionMode: BidSectionMode;
  bidSections: DetectedBidSection[];
  bidSectionExtractionStatus: BidSectionExtractionStatus;
  bidSectionExtractionError?: string;
  outlineMode: OutlineMode;
  outlineExpansionMode: OutlineExpansionMode;
  outlineWordControlOptions: OutlineWordControlOptions;
  outlineWordControlSnapshot?: OutlineWordControlOptions;
  referenceKnowledgeDocumentIds: string[];
  bidSectionExtractionTask?: BackgroundTaskState;
  bidAnalysisTask?: BackgroundTaskState;
  outlineGenerationTask?: BackgroundTaskState;
  globalFactsTask?: BackgroundTaskState;
  globalFacts: GlobalFactGroupState[];
  contentGenerationTask?: BackgroundTaskState;
  contentGenerationOptions?: ContentGenerationOptions;
  contentGenerationSections: ContentGenerationSections;
  contentGenerationPlans: ContentGenerationPlans;
  contentIllustrationPlan?: ContentIllustrationPlanState;
  contentGenerationRuntime?: ContentGenerationRuntimeState;
  requirementResponseMatrix?: RequirementResponseMatrix;
  outlineQualityReview?: Record<string, unknown>;
  outlineData: OutlineData | null;
}
