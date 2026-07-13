import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { trackConfigUsage } from '../../../shared/analytics/analytics';
import { areRequiredBidAnalysisTasksReady, getBidAnalysisTasks, isBidAnalysisTaskResultValid } from '../services/bidAnalysisWorkflow';
import { MarkdownFullscreenViewer, MarkdownRenderer, useToast } from '../../../shared/ui';
import type { ResponseTemplateRecord } from '../../../shared/types/outline';
import BidSectionSelectorDialog from '../components/BidSectionSelectorDialog';
import type { BackgroundTaskState, BidAnalysisMode, BidAnalysisTaskDefinition, BidAnalysisTasks, BidAnalysisTaskState, BidSectionExtractionStatus, BidSectionMode, DetectedBidSection, TechnicalPlanState } from '../types';

interface BidAnalysisPageProps {
  hasTenderFile: boolean;
  hasFormatDependentWork: boolean;
  mode: BidAnalysisMode;
  selectedTaskIds: string[];
  bidSectionMode: BidSectionMode;
  bidSections: DetectedBidSection[];
  bidSectionExtractionTask?: BackgroundTaskState;
  bidSectionExtractionStatus: BidSectionExtractionStatus;
  bidSectionExtractionError?: string;
  selectedSectionTitle?: string;
  taskDefinitions: BidAnalysisTaskDefinition[];
  responseTemplates: ResponseTemplateRecord[];
  tasks: BidAnalysisTasks;
  task?: BackgroundTaskState;
  progress: number;
  onProgressChange: (progress: number) => void;
  onConfigSaved: (state: TechnicalPlanState) => void;
}

const modeOptions: Array<{ id: 'key' | 'full'; title: string; badge: string }> = [
  {
    id: 'key',
    title: '只解析关键项',
    badge: '默认',
  },
  {
    id: 'full',
    title: '完整解析',
    badge: '更多 Token',
  },
];

function normalizeSelectedTaskIds(definitions: readonly BidAnalysisTaskDefinition[], taskIds: string[]) {
  const allBidAnalysisTaskIds = definitions.map((task) => task.id);
  const requiredBidAnalysisTaskIdSet = new Set(definitions.filter((task) => task.required).map((task) => task.id));
  const requestedIds = new Set(taskIds);
  return allBidAnalysisTaskIds.filter((taskId) => requiredBidAnalysisTaskIdSet.has(taskId) || requestedIds.has(taskId));
}

function getSelectedTaskIdsForMode(definitions: readonly BidAnalysisTaskDefinition[], mode: BidAnalysisMode, taskIds: string[]) {
  const allBidAnalysisTaskIds = definitions.map((task) => task.id);
  const requiredBidAnalysisTaskIds = definitions.filter((task) => task.required).map((task) => task.id);
  if (mode === 'full') {
    return allBidAnalysisTaskIds;
  }
  if (mode === 'custom') {
    return normalizeSelectedTaskIds(definitions, taskIds);
  }
  return requiredBidAnalysisTaskIds;
}

function getModeForSelection(definitions: readonly BidAnalysisTaskDefinition[], taskIds: string[]): BidAnalysisMode {
  const requiredBidAnalysisTaskIdSet = new Set(definitions.filter((task) => task.required).map((task) => task.id));
  const selectedIds = normalizeSelectedTaskIds(definitions, taskIds);
  if (selectedIds.length === definitions.length) {
    return 'full';
  }
  if (selectedIds.some((taskId) => !requiredBidAnalysisTaskIdSet.has(taskId))) {
    return 'custom';
  }
  return 'key';
}

function getModeLabel(mode: BidAnalysisMode) {
  if (mode === 'full') return '完整解析';
  if (mode === 'custom') return '自定义解析';
  return '只解析关键项';
}

const statusLabel: Record<BidAnalysisTaskState['status'], string> = {
  idle: '待解析',
  running: '解析中',
  success: '已完成',
  error: '失败',
};

const jsonFieldLabels: Record<string, string> = {
  project_name: '项目名称',
  project_number: '项目编号',
  project_type: '项目类型',
  project_budget: '项目预算',
  project_address: '项目地址',
  company_name: '公司名称',
  address: '地址',
  contact_person: '联系人',
  contact_phone: '联系电话',
  email: '联系邮箱',
  bank_account_name: '银行账户名称',
  bank_account_number: '银行账户账号',
  bank_account_address: '银行账户开户行',
  bank_account_address_detail: '银行账户开户行地址',
  bid_announcement_time: '招标公告发布日期',
  bid_file_get_way: '招标文件获取方式',
  bid_file_price: '招标文件售价',
  get_bid_file_time: '获取招标文件时间',
  bid_document_submission_location: '投标文件提交地点',
  bid_submission_deadline: '投标截止时间',
  bid_opening_time: '开标时间',
  bid_opening_address: '开标地点',
  other_notes: '其他注意事项',
  bidding_deposit: '投标保证金',
  payment_method: '缴纳方式',
  due_date: '截止日期',
  refund_conditions: '退还条件',
  non_refundable_conditions: '不予退还的情形',
  time_place: '时间地点',
  part_req: '参与要求',
  invalid_bid: '无效标认定',
  objection: '异议处理',
  bid_process: '开标流程',
  committee: '评标委员会组成',
  duties: '评标委员会职责',
  scoring: '评分构成',
  method: '评标方法类型',
  principles: '评标原则和方法细节',
  others: '其他信息',
  bid_notice: '中标公示',
  contract_sign: '合同签订',
  performance_bond: '履约保证金',
  contract_text: '合同文本',
  breach_termination: '违约解除',
  force_majeure: '不可抗力',
  contract_termination: '合同终止',
  dispute_resolution: '争议解决',
  implementation_period: '实施周期/工期/交付期限',
  delivery_scope: '交付范围',
  delivery_location: '交付/实施地点',
  acceptance_requirements: '验收要求',
  warranty_period: '质保期',
  after_sales_service: '售后服务要求',
  response_time: '响应时限',
  training_requirements: '培训要求',
  documentation_requirements: '资料/文档交付要求',
};

function tryParseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '没有提及';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function JsonResultTable({ content }: { content: string }) {
  const data = tryParseJsonObject(content);

  if (!data) {
    return (
      <div className="markdown-empty-state bid-analysis-empty">
        <strong>解析结果格式无效</strong>
        <p>该 JSON 结果未通过格式校验，请重新解析此项。</p>
      </div>
    );
  }

  return (
    <div className="bid-analysis-json-table-wrap">
      <table className="bid-analysis-json-table">
        <tbody>
          {Object.entries(data).map(([key, value]) => (
            <tr key={key}>
              <th>{jsonFieldLabels[key] || key}</th>
              <td>{formatJsonValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function formatApplicableScope(value: unknown) {
  const scope = asJsonRecord(value);
  if (!scope) return '全局';
  const labels = [scope.section_title, ...(Array.isArray(scope.package_names) ? scope.package_names : [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return labels.length ? labels.join(' / ') : '全局';
}

function FormatOutlineTree({ nodes }: { nodes: unknown[] }) {
  if (!nodes.length) return <p>当前范围没有明确固定目录，Step03 将按技术评分回退。</p>;
  return (
    <ul className="bid-analysis-structured-tree">
      {nodes.map((value, index) => {
        const node = asJsonRecord(value);
        if (!node) return null;
        const children = Array.isArray(node.children) ? node.children : [];
        return (
          <li key={String(node.format_node_id || `${node.source_title || 'node'}-${index}`)}>
            <div>
              <strong>{[node.source_number, node.source_title].filter(Boolean).join(' ')}</strong>
              <span>{String(node.response_mode || 'freeform-markdown')}</span>
              {node.title_locked === true && <em>标题锁定</em>}
              {node.required_in_outline === true && <em>必须保留</em>}
            </div>
            {asJsonRecord(node.source) && (
              <small>
                {String(asJsonRecord(node.source)?.source_file_name || asJsonRecord(node.source)?.source_file_id || '来源')}
                {' · 行 '}{String(asJsonRecord(node.source)?.markdown_line_start || '?')}-{String(asJsonRecord(node.source)?.markdown_line_end || '?')}
              </small>
            )}
            {children.length > 0 && <FormatOutlineTree nodes={children} />}
          </li>
        );
      })}
    </ul>
  );
}

function FormatRequirementsResult({
  content,
  templates,
  onReviewTemplate,
}: {
  content: string;
  templates: ResponseTemplateRecord[];
  onReviewTemplate: (template: ResponseTemplateRecord) => void;
}) {
  const data = tryParseJsonObject(content);
  if (!data || !Array.isArray(data.profiles)) return <JsonResultTable content={content} />;
  return (
    <div className="bid-analysis-structured-result">
      <div className="bid-analysis-structured-summary">
        <strong>{data.has_explicit_technical_format === true ? '已识别明确技术文件格式' : '未发现明确技术文件格式'}</strong>
        <span>{data.profiles.length} 个适用 profile</span>
      </div>
      {data.profiles.map((value, index) => {
        const profile = asJsonRecord(value);
        if (!profile) return null;
        return (
          <section key={String(profile.profile_id || index)} className="bid-analysis-structured-card">
            <header>
              <strong>{String(profile.document_title || `格式 Profile ${index + 1}`)}</strong>
              <span>{formatApplicableScope(profile.applicable_scope)}</span>
              <em>{String(profile.format_strength || '')}</em>
            </header>
            <FormatOutlineTree nodes={Array.isArray(profile.outline) ? profile.outline : []} />
          </section>
        );
      })}
      <section className="bid-analysis-structured-card">
        <header><strong>固定响应模板</strong><span>{templates.length} 项</span></header>
        {templates.length ? (
          <ul className="bid-analysis-template-list">
            {templates.map((template) => (
              <li key={template.template_id}>
                <strong>{template.source_title}</strong>
                <span>{template.kind === 'locked-commitment' ? '固定承诺函' : '固定表格'}</span>
                <em>{template.confirmed ? '已锁定' : '待核对'}</em>
                <button type="button" className="secondary-action" onClick={() => onReviewTemplate(template)}>
                  {template.confirmed ? '重新核对' : '核对并锁定'}
                </button>
              </li>
            ))}
          </ul>
        ) : <p>当前格式没有固定承诺函或固定表格。</p>}
      </section>
    </div>
  );
}

function BidAnalysisPage({
  hasTenderFile,
  hasFormatDependentWork,
  mode,
  selectedTaskIds,
  bidSectionMode,
  bidSections,
  bidSectionExtractionTask,
  bidSectionExtractionStatus,
  bidSectionExtractionError,
  selectedSectionTitle,
  responseTemplates,
  taskDefinitions,
  tasks,
  task,
  progress,
  onProgressChange,
  onConfigSaved,
}: BidAnalysisPageProps) {
  const [running, setRunning] = useState(false);
  const [fullRerunLocked, setFullRerunLocked] = useState(false);
  const [fullRerunSeenRunning, setFullRerunSeenRunning] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState('projectOverview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSelectedTaskIds, setDraftSelectedTaskIds] = useState<string[]>(() => getSelectedTaskIdsForMode(taskDefinitions, mode, selectedTaskIds));
  const [draftBidSectionMode, setDraftBidSectionMode] = useState<BidSectionMode>(bidSectionMode);
  const [sectionSelectorOpen, setSectionSelectorOpen] = useState(false);
  const [selectingSection, setSelectingSection] = useState(false);
  const [pendingAnalysisAfterSection, setPendingAnalysisAfterSection] = useState<{ taskIds?: string[]; nextTaskIds: string[] } | null>(null);
  const [pendingFormatReset, setPendingFormatReset] = useState<{
    taskIds?: string[];
    nextTaskIds: string[];
    options: { skipCheck?: boolean; overrideMode?: BidSectionMode };
  } | null>(null);
  const [reviewingTemplate, setReviewingTemplate] = useState<ResponseTemplateRecord | null>(null);
  const [templateDraft, setTemplateDraft] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sectionModeWarning, setSectionModeWarning] = useState<{
    type: 'single-suspected-multiple' | 'multiple-not-detected';
    taskIds?: string[];
    nextTaskIds: string[];
  } | null>(null);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const { showToast } = useToast();
  const bidAnalysisTasks = taskDefinitions;
  const allBidAnalysisTaskIds = useMemo(() => taskDefinitions.map((definition) => definition.id), [taskDefinitions]);
  const requiredBidAnalysisTaskIds = useMemo(
    () => taskDefinitions.filter((definition) => definition.required).map((definition) => definition.id),
    [taskDefinitions],
  );
  const requiredBidAnalysisTaskIdSet = useMemo(() => new Set(requiredBidAnalysisTaskIds), [requiredBidAnalysisTaskIds]);
  const taskGroups = useMemo(() => [
    { title: '关键项', group: 'key' as const },
    { title: '其他项', group: 'optional' as const },
  ], []);
  const effectiveSelectedTaskIds = useMemo(
    () => getSelectedTaskIdsForMode(taskDefinitions, mode, selectedTaskIds),
    [mode, selectedTaskIds, taskDefinitions],
  );
  const selectedTasks = useMemo(() => {
    const selectedIdSet = new Set(effectiveSelectedTaskIds);
    return bidAnalysisTasks.filter((task) => selectedIdSet.has(task.id));
  }, [effectiveSelectedTaskIds]);
  const requiredTasks = useMemo(() => getBidAnalysisTasks(taskDefinitions, 'key'), [taskDefinitions]);
  const visibleSelectedTaskId = selectedTasks.some((task) => task.id === selectedTaskId)
    ? selectedTaskId
    : selectedTasks[0]?.id || 'projectOverview';
  const activeTask = selectedTasks.find((task) => task.id === visibleSelectedTaskId) || selectedTasks[0];
  const activeTaskState = activeTask ? tasks[activeTask.id] : undefined;
  const activeTaskStatus = activeTaskState?.status === 'success' && activeTask && !isBidAnalysisTaskResultValid(activeTask, activeTaskState)
    ? 'error'
    : activeTaskState?.status || 'idle';
  const activeTaskContent = activeTaskState?.content || '';
  const failedTaskCount = selectedTasks.filter((definition) => {
    const state = tasks[definition.id];
    return state?.status === 'error' || (state?.status === 'success' && !isBidAnalysisTaskResultValid(definition, state));
  }).length;
  const doneCount = selectedTasks.filter((task) => {
    const status = tasks[task.id]?.status;
    return status === 'success' || status === 'error';
  }).length;
  const sectionTaskRunning = bidSectionExtractionTask?.status === 'running' || bidSectionExtractionTask?.status === 'pausing';
  const taskRunning = running || fullRerunLocked || sectionTaskRunning || task?.status === 'running';
  const requiredDone = areRequiredBidAnalysisTasksReady(taskDefinitions, tasks);
  const missingRequiredLabels = requiredTasks
    .filter((definition) => !isBidAnalysisTaskResultValid(definition, tasks[definition.id]))
    .map((definition) => definition.label);
  const isPromptCacheOptimizing = taskRunning
    && selectedTasks.length > 1
    && selectedTasks.some((task) => task.id === 'projectOverview')
    && tasks.projectOverview?.status === 'running'
    && doneCount === 0;
  const progressMessage = isPromptCacheOptimizing
    ? '正在优化提示词缓存'
    : requiredDone && taskRunning
      ? '关键项已解析完成，等待当前解析任务结束后进入下一步。'
      : requiredDone ? '招标文件解析任务已结束，可以进入下一步。' : `等待 7 个关键项解析成功${missingRequiredLabels.length ? `：${missingRequiredLabels.join('、')}` : ''}。`;
  const bidSectionConfigLabel = bidSectionMode === 'multiple'
    ? selectedSectionTitle ? `多标段 · ${selectedSectionTitle}` : '多标段 · 待选择'
    : '单标段';
  const configLabel = `${bidSectionConfigLabel} · ${getModeLabel(mode)}`;

  const syncProgressForSelection = (nextTaskIds: string[]) => {
    const selectedIdSet = new Set(normalizeSelectedTaskIds(taskDefinitions, nextTaskIds));
    const nextTasks = bidAnalysisTasks.filter((task) => selectedIdSet.has(task.id));
    const nextDoneCount = nextTasks.filter((task) => {
      const status = tasks[task.id]?.status;
      return status === 'success' || status === 'error';
    }).length;
    onProgressChange(Math.round((nextDoneCount / nextTasks.length) * 100));
  };

  useEffect(() => {
    if (!fullRerunLocked) {
      return;
    }

    if (task?.status === 'running') {
      setFullRerunSeenRunning(true);
      return;
    }

    if (fullRerunSeenRunning && task?.status) {
      setFullRerunLocked(false);
      setFullRerunSeenRunning(false);
    }
  }, [fullRerunLocked, fullRerunSeenRunning, task?.status]);

  useEffect(() => {
    setDraftBidSectionMode(bidSectionMode);
  }, [bidSectionMode]);

  useEffect(() => {
    if (bidSectionMode === 'multiple' && bidSectionExtractionStatus === 'success' && bidSections.length >= 2 && !selectedSectionTitle && !sectionTaskRunning) {
      setSectionSelectorOpen(true);
    }
  }, [bidSectionMode, bidSectionExtractionStatus, bidSections.length, selectedSectionTitle, sectionTaskRunning]);

  useEffect(() => {
    if (pendingAnalysisAfterSection && bidSectionExtractionStatus === 'error') {
      setPendingAnalysisAfterSection(null);
      showToast(bidSectionExtractionError || '多标段识别失败，请重新识别或改用单标段解析', 'error');
    }
  }, [bidSectionExtractionError, bidSectionExtractionStatus, pendingAnalysisAfterSection, showToast]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    setDraftSelectedTaskIds(effectiveSelectedTaskIds);
    setDraftBidSectionMode(bidSectionMode);
  }, [bidSectionMode, effectiveSelectedTaskIds, settingsOpen]);

  const openSettingsDialog = () => {
    if (taskRunning) {
      showToast('招标文件解析任务正在运行，请等待任务结束后再调整配置', 'info');
      return;
    }
    setDraftSelectedTaskIds(effectiveSelectedTaskIds);
    setDraftBidSectionMode(bidSectionMode);
    setSettingsOpen(true);
  };

  const saveConfig = async (nextTaskIds = draftSelectedTaskIds, closeDialog = true, nextBidSectionMode = draftBidSectionMode) => {
    const normalizedTaskIds = normalizeSelectedTaskIds(taskDefinitions, nextTaskIds);
    const nextMode = getModeForSelection(taskDefinitions, normalizedTaskIds);
    const saved = await window.yibiao?.technicalPlan.saveBidAnalysisConfig({ mode: nextMode, selectedTaskIds: normalizedTaskIds, bidSectionMode: nextBidSectionMode });
    if (saved) {
      onConfigSaved(saved);
    }
    syncProgressForSelection(normalizedTaskIds);
    if (closeDialog) {
      setSettingsOpen(false);
      showToast('招标文件解析配置已保存', 'success');
    }
    return { mode: nextMode, selectedTaskIds: normalizedTaskIds, bidSectionMode: nextBidSectionMode };
  };

  const startBidAnalysisOnly = async (taskIds: string[] | undefined, nextTaskIds: string[], nextBidSectionMode: BidSectionMode) => {
    if (!hasTenderFile) {
      showToast('请先上传招标文件', 'info');
      return;
    }

    const normalizedTaskIds = normalizeSelectedTaskIds(taskDefinitions, nextTaskIds);
    const nextSelectedIdSet = new Set(normalizedTaskIds);
    const nextSelectedTasks = bidAnalysisTasks.filter((task) => nextSelectedIdSet.has(task.id));
    const retryTask = taskIds?.length === 1 ? nextSelectedTasks.find((task) => task.id === taskIds[0]) : undefined;
    const forceRerun = !taskIds?.length
      && nextSelectedTasks.length > 0
      && nextSelectedTasks.every((definition) => isBidAnalysisTaskResultValid(definition, tasks[definition.id]));

    try {
      setRunning(true);
      if (forceRerun) {
        setFullRerunSeenRunning(false);
        setFullRerunLocked(true);
      }
      const configState = await saveConfig(normalizedTaskIds, false, nextBidSectionMode);
      const config = await window.yibiao?.config.load();
      await window.yibiao?.tasks.startBidAnalysis({
        mode: configState.mode,
        selected_task_ids: configState.selectedTaskIds,
        task_ids: taskIds,
        force_rerun: forceRerun,
      });
      trackConfigUsage({ bid_analysis_mode: configState.mode }, config);
      setSettingsOpen(false);
      showToast(retryTask ? `${retryTask.label}重新解析任务已在后台启动` : '招标文件解析任务已在后台启动', 'success');
    } catch (error) {
      if (forceRerun) {
        setFullRerunLocked(false);
        setFullRerunSeenRunning(false);
      }
      showToast(error instanceof Error ? error.message : '启动解析任务失败', 'error');
    } finally {
      setRunning(false);
    }
  };

  const startAnalysis = async (
    taskIds?: string[],
    nextTaskIds = draftSelectedTaskIds,
    options: { skipCheck?: boolean; overrideMode?: BidSectionMode; formatResetConfirmed?: boolean } = {},
  ) => {
    if (!hasTenderFile) {
      showToast('请先上传招标文件', 'info');
      return;
    }

    const nextBidSectionMode = options.overrideMode || draftBidSectionMode;
    const normalizedTaskIds = normalizeSelectedTaskIds(taskDefinitions, nextTaskIds);
    const includesFormatAnalysis = taskIds?.length
      ? taskIds.includes('bidDocumentFormatRequirements')
      : normalizedTaskIds.includes('bidDocumentFormatRequirements');
    if (hasFormatDependentWork && includesFormatAnalysis && !options.formatResetConfirmed) {
      setPendingFormatReset({ taskIds, nextTaskIds: normalizedTaskIds, options });
      return;
    }

    if (!options.skipCheck) {
      try {
        const detection = await window.yibiao?.technicalPlan.checkBidSections();
        if (nextBidSectionMode === 'single' && detection?.hasMultiple) {
          setSectionModeWarning({ type: 'single-suspected-multiple', taskIds, nextTaskIds: normalizedTaskIds });
          return;
        }
        if (nextBidSectionMode === 'multiple' && detection && !detection.hasMultiple) {
          setSectionModeWarning({ type: 'multiple-not-detected', taskIds, nextTaskIds: normalizedTaskIds });
          return;
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '标段校验失败', 'error');
        return;
      }
    }

    if (nextBidSectionMode === 'multiple' && !selectedSectionTitle) {
      try {
        await saveConfig(normalizedTaskIds, false, 'multiple');
        setPendingAnalysisAfterSection({ taskIds, nextTaskIds: normalizedTaskIds });
        if (bidSectionExtractionStatus === 'success' && bidSections.length >= 2) {
          setSettingsOpen(false);
          setSectionSelectorOpen(true);
          return;
        }
        setSettingsOpen(false);
        await window.yibiao?.tasks.startBidSectionExtraction({});
        showToast('多标段识别任务已在后台启动', 'success');
      } catch (error) {
        setPendingAnalysisAfterSection(null);
        showToast(error instanceof Error ? error.message : '启动多标段识别失败', 'error');
      }
      return;
    }

    await startBidAnalysisOnly(taskIds, normalizedTaskIds, nextBidSectionMode);
  };

  const retryActiveTask = () => {
    if (!activeTask || activeTaskStatus !== 'error') {
      showToast('当前解析项没有失败，无需单独重试', 'info');
      return;
    }

    startAnalysis([activeTask.id], effectiveSelectedTaskIds);
  };

  const continueFromSectionModeWarning = (nextBidSectionMode: BidSectionMode) => {
    if (!sectionModeWarning) return;
    const pending = sectionModeWarning;
    setSectionModeWarning(null);
    setDraftBidSectionMode(nextBidSectionMode);
    void startAnalysis(pending.taskIds, pending.nextTaskIds, { skipCheck: true, overrideMode: nextBidSectionMode });
  };

  const startSectionExtractionOnly = async () => {
    if (!hasTenderFile) {
      showToast('请先上传招标文件', 'info');
      return;
    }
    try {
      await saveConfig(draftSelectedTaskIds, false, 'multiple');
      setSettingsOpen(false);
      await window.yibiao?.tasks.startBidSectionExtraction({});
      showToast('多标段识别任务已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动多标段识别失败', 'error');
    }
  };

  const handleSectionSelect = async (sectionId: string) => {
    const selectedSection = bidSections.find((section) => section.id === sectionId);
    if (!selectedSection) {
      showToast('未找到选择的投标范围', 'error');
      return;
    }
    try {
      setSelectingSection(true);
      const result = await window.yibiao?.technicalPlan.selectBidSection(selectedSection);
      if (!result?.success || !result.state) {
        showToast(result?.message || '投标范围选择失败', 'error');
        return;
      }
      onConfigSaved(result.state);
      setSectionSelectorOpen(false);
      showToast(result.message || '已选择投标范围', 'success');
      if (pendingAnalysisAfterSection) {
        const pending = pendingAnalysisAfterSection;
        setPendingAnalysisAfterSection(null);
        await startBidAnalysisOnly(pending.taskIds, pending.nextTaskIds, 'multiple');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '投标范围选择失败', 'error');
    } finally {
      setSelectingSection(false);
    }
  };

  const handleSectionCancel = () => {
    setPendingAnalysisAfterSection(null);
    setSectionSelectorOpen(false);
  };

  const toggleDraftTask = (taskId: string) => {
    if (requiredBidAnalysisTaskIdSet.has(taskId) || taskRunning) {
      return;
    }

    setDraftSelectedTaskIds((prev) => {
      const selectedSet = new Set(normalizeSelectedTaskIds(taskDefinitions, prev));
      if (selectedSet.has(taskId)) {
        selectedSet.delete(taskId);
      } else {
        selectedSet.add(taskId);
      }
      return allBidAnalysisTaskIds.filter((id) => selectedSet.has(id));
    });
  };

  const selectPreset = (preset: 'key' | 'full') => {
    setDraftSelectedTaskIds(preset === 'full' ? allBidAnalysisTaskIds : requiredBidAnalysisTaskIds);
  };

  const openSectionSelectorFromConfig = async () => {
    try {
      await saveConfig(draftSelectedTaskIds, false, 'multiple');
      setSettingsOpen(false);
      setSectionSelectorOpen(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打开标段选择失败', 'error');
    }
  };

  const copyActiveResult = async () => {
    if (!activeTaskContent) {
      showToast('当前没有可复制的解析结果', 'info');
      return;
    }

    await navigator.clipboard.writeText(activeTaskContent);
    showToast('解析结果已复制', 'success');
  };

  const openTemplateReview = (template: ResponseTemplateRecord) => {
    setReviewingTemplate(template);
    setTemplateDraft(JSON.stringify(template.template, null, 2));
  };

  const confirmTemplate = async () => {
    if (!reviewingTemplate) return;
    try {
      setSavingTemplate(true);
      const parsed = JSON.parse(templateDraft) as ResponseTemplateRecord['template'];
      const saved = await window.yibiao?.technicalPlan.confirmResponseTemplate({
        templateId: reviewingTemplate.template_id,
        template: parsed,
      });
      if (saved) onConfigSaved(saved);
      setReviewingTemplate(null);
      showToast('固定模板已由 Main 校验并锁定', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '固定模板核对失败', 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  const renderConfigTask = (definition: BidAnalysisTaskDefinition) => {
    const selected = normalizeSelectedTaskIds(taskDefinitions, draftSelectedTaskIds).includes(definition.id);
    const required = definition.required;

    return (
      <label className={`bid-analysis-config-item${selected ? ' is-selected' : ''}${required ? ' is-required' : ''}`} key={definition.id}>
        <input
          type="checkbox"
          checked={selected}
          disabled={required || taskRunning}
          onChange={() => toggleDraftTask(definition.id)}
        />
        <span>
          <strong>{definition.label}</strong>
        </span>
        {required && <em>必选</em>}
      </label>
    );
  };

  const draftMode = getModeForSelection(taskDefinitions, draftSelectedTaskIds);
  const draftSelectedCount = normalizeSelectedTaskIds(taskDefinitions, draftSelectedTaskIds).length;
  const hasExtractedBidSections = bidSectionExtractionStatus === 'success' && bidSections.length >= 2;
  const bidSectionActionLabel = sectionTaskRunning
    ? '识别中...'
    : hasExtractedBidSections
      ? selectedSectionTitle ? '更换' : '选择标段'
      : bidSectionExtractionStatus === 'error' ? '重新识别标段' : '识别标段';

  return (
    <div className="plan-step-body bid-analysis-page">
      <section className="bid-analysis-command-bar">
        <div>
          <span className="section-kicker">STEP 02</span>
          <strong>招标文件解析</strong>
          <p>并发解析招标文件，全部选中解析项结束后进入目录生成。</p>
        </div>
        <div className="bid-analysis-config-chip" title="当前解析配置">
          <span>{configLabel}</span>
          <small>{selectedTasks.length} 项</small>
        </div>
        <div className="bid-analysis-command-actions">
          <button
            type="button"
            className="outline-config-action"
            onClick={openSettingsDialog}
            disabled={taskRunning}
            aria-label="打开招标文件解析配置"
            title="招标文件解析配置"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 8.93a1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 10 3.01V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
          <button type="button" className="primary-action" onClick={openSettingsDialog} disabled={taskRunning}>
            {sectionTaskRunning ? '识别中...' : taskRunning ? '解析中...' : failedTaskCount > 0 ? `重试失败项(${failedTaskCount})` : progress > 0 ? '重新解析' : '开始解析'}
          </button>
        </div>
      </section>

      <section className="bid-analysis-workspace">
        <aside className="bid-analysis-task-pane" aria-label="解析任务列表">
          <div className="analysis-result-head bid-analysis-task-head">
            <strong>核心信息</strong>
            <span>{doneCount}/{selectedTasks.length} 项</span>
          </div>
          <div className={`content-outline-stats bid-analysis-progress-summary${progressCollapsed ? ' is-collapsed' : ''}`}>
            <button type="button" onClick={() => setProgressCollapsed((prev) => !prev)} aria-expanded={!progressCollapsed}>
              <span>解析进度</span>
              <strong>{doneCount}/{selectedTasks.length}</strong>
              <em>{progressCollapsed ? '展开' : '折叠'}</em>
            </button>
            {!progressCollapsed && (
              <div className="content-outline-stats-body">
                <div className="content-generation-progress-track" aria-label={`解析进度 ${progress}%`}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p>{progressMessage}</p>
              </div>
            )}
          </div>
          <div className="bid-analysis-task-list">
            {taskGroups.map((group) => {
              const groupTasks = selectedTasks.filter((task) => task.group === group.group);
              if (!groupTasks.length) {
                return null;
              }

              return (
                <div className="bid-analysis-task-group" key={group.title}>
                  <span>{group.title}</span>
                  {groupTasks.map((task) => {
                    const taskState = tasks[task.id];
                    const status = taskState?.status === 'success' && !isBidAnalysisTaskResultValid(task, taskState)
                      ? 'error'
                      : taskState?.status || 'idle';
                    const content = taskState?.content || '';

                    return (
                      <button
                        type="button"
                        className={`bid-analysis-task-item is-${status}${visibleSelectedTaskId === task.id ? ' is-active' : ''}`}
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <strong>{task.label}</strong>
                        <small>{content ? `${content.length} 字` : task.description}</small>
                        <em>{statusLabel[status]}</em>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>

        <article className="bid-analysis-reader">
          <div className="bid-analysis-reader-head">
            <div>
              <span className="section-kicker">解析结果</span>
              <strong>{activeTask?.label || '解析结果'}</strong>
              <p>{activeTask?.description || '选择左侧任务查看解析结果。'}</p>
            </div>
            <div className="bid-analysis-reader-actions">
              <span className={`bid-analysis-status is-${activeTaskStatus}`}>{statusLabel[activeTaskStatus]}</span>
              {activeTaskStatus === 'error' && (
                <button type="button" className="secondary-action" onClick={retryActiveTask} disabled={taskRunning || !hasTenderFile}>重新解析此项</button>
              )}
              <button type="button" className="secondary-action" onClick={copyActiveResult} disabled={!activeTaskContent}>复制</button>
            </div>
          </div>

          {activeTaskContent ? (
            activeTask?.output === 'json' ? (
              activeTask.id === 'bidDocumentFormatRequirements'
                ? <FormatRequirementsResult content={activeTaskContent} templates={responseTemplates} onReviewTemplate={openTemplateReview} />
                : <JsonResultTable content={activeTaskContent} />
            ) : (
              <MarkdownFullscreenViewer className="markdown-viewer bid-analysis-output" title={`${activeTask?.label || '解析结果'}全屏预览`}>
                <MarkdownRenderer>
                  {activeTaskContent}
                </MarkdownRenderer>
              </MarkdownFullscreenViewer>
            )
          ) : (
            <div className="markdown-empty-state bid-analysis-empty">
              <strong>{activeTaskStatus === 'error' ? activeTaskState?.error || '解析失败' : '等待解析结果'}</strong>
              <p>{activeTaskStatus === 'idle' ? '点击开始解析后，左侧任务会并发运行；选择任一任务查看实时输出。' : '正在等待模型返回内容。'}</p>
            </div>
          )}
        </article>
      </section>

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="bid-analysis-config-card">
            <Dialog.Title className="sr-only">招标文件解析配置</Dialog.Title>
            <Dialog.Description className="sr-only">选择本次招标文件需要解析的项目。</Dialog.Description>

            <header className="bid-analysis-config-head">
              <div>
                <span className="section-kicker">解析配置</span>
                <strong>招标文件解析配置</strong>
              </div>
            </header>

            <div className="bid-analysis-config-body">
              <section className="bid-analysis-config-section is-compact">
                <div className="bid-analysis-config-section-head">
                  <strong>投标范围</strong>
                  <span>{draftBidSectionMode === 'multiple' ? '多标段' : '默认单标段'}</span>
                </div>
                <div className="bid-analysis-config-presets" role="group" aria-label="投标范围模式">
                  <button
                    type="button"
                    className={`bid-analysis-config-preset${draftBidSectionMode === 'single' ? ' is-active' : ''}`}
                    onClick={() => setDraftBidSectionMode('single')}
                    disabled={taskRunning}
                  >
                    <span>单标段</span>
                    <small>默认</small>
                  </button>
                  <button
                    type="button"
                    className={`bid-analysis-config-preset${draftBidSectionMode === 'multiple' ? ' is-active' : ''}`}
                    onClick={() => setDraftBidSectionMode('multiple')}
                    disabled={taskRunning}
                  >
                    <span>多标段</span>
                    <small>AI 识别</small>
                  </button>
                </div>
                {draftBidSectionMode === 'multiple' && (
                  <div className="bid-analysis-section-action">
                    {selectedSectionTitle && (
                      <>
                        <span className="bid-analysis-section-label">当前选择的标段</span>
                        <span className="bid-analysis-section-chip">{selectedSectionTitle}</span>
                      </>
                    )}
                    <button
                      type="button"
                      className="secondary-action bid-analysis-section-change"
                      onClick={() => {
                        if (hasExtractedBidSections) {
                          void openSectionSelectorFromConfig();
                          return;
                        }
                        void startSectionExtractionOnly();
                      }}
                      disabled={!hasTenderFile || taskRunning}
                    >
                      {bidSectionActionLabel}
                    </button>
                  </div>
                )}
              </section>

              <section className="bid-analysis-config-section is-compact">
                <div className="bid-analysis-config-section-head">
                  <strong>解析范围</strong>
                  <span>{getModeLabel(draftMode)}</span>
                </div>
                <div className="bid-analysis-config-presets" role="group" aria-label="快速选择解析项">
                  {modeOptions.map((option) => (
                    <button
                      type="button"
                      className={`bid-analysis-config-preset${draftMode === option.id ? ' is-active' : ''}`}
                      key={option.id}
                      onClick={() => selectPreset(option.id)}
                      disabled={taskRunning}
                    >
                      <span>{option.title}</span>
                      <small>{option.badge}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="bid-analysis-config-section">
                <div className="bid-analysis-config-section-head">
                  <strong>关键项</strong>
                  <span>{requiredBidAnalysisTaskIds.length} 项必选</span>
                </div>
                <div className="bid-analysis-config-grid">
                  {bidAnalysisTasks.filter((definition) => definition.required).map(renderConfigTask)}
                </div>
              </section>

              <section className="bid-analysis-config-section">
                <div className="bid-analysis-config-section-head">
                  <strong>其他项</strong>
                  <span>当前共选择 {draftSelectedCount} 项</span>
                </div>
                <div className="bid-analysis-config-grid">
                  {bidAnalysisTasks.filter((definition) => !definition.required).map(renderConfigTask)}
                </div>
              </section>
            </div>

            <div className="content-regenerate-actions bid-analysis-config-actions">
              <Dialog.Close className="secondary-action" type="button">取消</Dialog.Close>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  void saveConfig().catch((error) => showToast(error instanceof Error ? error.message : '保存解析配置失败', 'error'));
                }}
                disabled={taskRunning}
              >
                保存配置
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => { void startAnalysis(undefined, draftSelectedTaskIds); }}
                disabled={taskRunning || !hasTenderFile}
              >
                开始解析
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(sectionModeWarning)} onOpenChange={(open) => { if (!open) setSectionModeWarning(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="content-regenerate-card">
            <Dialog.Title className="content-regenerate-title">投标范围确认</Dialog.Title>
            <Dialog.Description className="content-regenerate-description">
              {sectionModeWarning?.type === 'single-suspected-multiple'
                ? '系统检测到招标文件疑似包含多个标段，建议切换为多标段解析，先选择本次投标范围后再解析。'
                : '系统没有通过规则检测到明确多标段结构，是否仍继续使用 AI 识别多标段？'}
            </Dialog.Description>
            <div className="content-regenerate-actions">
              {sectionModeWarning?.type === 'single-suspected-multiple' ? (
                <>
                  <button type="button" className="secondary-action" onClick={() => continueFromSectionModeWarning('single')}>继续单标段</button>
                  <button type="button" className="primary-action" onClick={() => continueFromSectionModeWarning('multiple')}>切换多标段</button>
                </>
              ) : (
                <>
                  <button type="button" className="secondary-action" onClick={() => continueFromSectionModeWarning('single')}>改为单标段</button>
                  <button type="button" className="primary-action" onClick={() => continueFromSectionModeWarning('multiple')}>继续 AI 识别</button>
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(pendingFormatReset)} onOpenChange={(open) => { if (!open) setPendingFormatReset(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="content-regenerate-card">
            <Dialog.Title className="content-regenerate-title">确认补充或重做格式解析</Dialog.Title>
            <Dialog.Description className="content-regenerate-description">
              当前工作区已有目录或正文。只有新的完整格式分析结果与原 Hash 不同时，系统才会清理旧目录、全局事实和正文；相同结果会原样保留。是否继续？
            </Dialog.Description>
            <div className="content-regenerate-actions">
              <button type="button" className="secondary-action" onClick={() => setPendingFormatReset(null)}>取消</button>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  const pending = pendingFormatReset;
                  setPendingFormatReset(null);
                  if (pending) {
                    void startAnalysis(pending.taskIds, pending.nextTaskIds, { ...pending.options, formatResetConfirmed: true });
                  }
                }}
              >继续解析</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(reviewingTemplate)} onOpenChange={(open) => { if (!open && !savingTemplate) setReviewingTemplate(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="content-regenerate-card bid-analysis-template-review-card">
            <Dialog.Title className="content-regenerate-title">核对并锁定：{reviewingTemplate?.source_title}</Dialog.Title>
            <Dialog.Description className="content-regenerate-description">
              只修正文档转 Markdown 造成的原文、标点、槽位或表格结构错误。确认后 Main 将重新校验模板并计算锁定 Hash；不要改写招标文件固定内容。
            </Dialog.Description>
            <textarea
              className="bid-analysis-template-review-editor"
              value={templateDraft}
              onChange={(event) => setTemplateDraft(event.target.value)}
              spellCheck={false}
              disabled={savingTemplate}
              aria-label="固定模板结构"
            />
            <div className="content-regenerate-actions">
              <button type="button" className="secondary-action" onClick={() => setReviewingTemplate(null)} disabled={savingTemplate}>取消</button>
              <button type="button" className="primary-action" onClick={() => { void confirmTemplate(); }} disabled={savingTemplate}>
                {savingTemplate ? '锁定中...' : '确认并锁定'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <BidSectionSelectorDialog
        open={sectionSelectorOpen}
        sections={bidSections}
        onSelect={handleSectionSelect}
        onCancel={handleSectionCancel}
        busy={selectingSection}
      />
    </div>
  );
}

export default BidAnalysisPage;
