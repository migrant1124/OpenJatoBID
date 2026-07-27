import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { trackConfigUsage } from '../../../shared/analytics/analytics';
import { useToast } from '../../../shared/ui';
import type { BackgroundTaskState, SaveOutlineRequest, TechnicalPlanWorkflowKind } from '../types';
import type { KnowledgeBaseIndex, KnowledgeDocument } from '../../knowledge-base/types';
import type { OutlineData, OutlineExpansionMode, OutlineItem, OutlineWordControlOptions } from '../../../shared/types';
import type { ExportFormatConfig } from '../../../shared/types/exportFormat';
import { DEFAULT_EXPORT_FORMAT } from '../../../shared/types/exportFormat';
import {
  formatOutlineDisplayNumber,
  formatOutlineDisplayTitle,
  stripRepeatedSourceNumber,
} from '../../../shared/utils/outlineNumbering';

interface OutlineEditPageProps {
  workflowKind: TechnicalPlanWorkflowKind;
  projectOverview: string;
  techRequirements: string;
  outlineExpansionMode: OutlineExpansionMode;
  outlineWordControlOptions: OutlineWordControlOptions;
  outlineWordControlSnapshot?: OutlineWordControlOptions;
  formatRequirementsContent: string;
  referenceKnowledgeDocumentIds: string[];
  outlineData: OutlineData | null;
  task?: BackgroundTaskState;
  contentTaskStatus?: BackgroundTaskState['status'];
  onOutlineConfigChange: (config: { referenceKnowledgeDocumentIds: string[]; outlineExpansionMode: OutlineExpansionMode; wordControlOptions: OutlineWordControlOptions }) => Promise<void>;
  onOutlineSaved: (request: SaveOutlineRequest) => Promise<void>;
  onSortGuardChange?: (guard: OutlineSortGuard | null) => void;
}

interface OutlineSortGuard {
  hasUnsavedSort: () => boolean;
  saveSort: () => Promise<void>;
  discardSort: () => void;
}

interface RenumberResult {
  outline: OutlineItem[];
  idMap: Record<string, string>;
}

interface OutlineLocation {
  parentId: string | null;
  level: number;
  index: number;
}

interface DropTargetState {
  itemId: string;
  position: 'before' | 'after';
  valid: boolean;
}

const emptyKnowledgeIndex: KnowledgeBaseIndex = { folders: [], documents: [] };
const outlineExpansionModeLabels: Record<OutlineExpansionMode, string> = {
  'original-only': '仅参考原方案下级目录',
  'ai-complement': 'AI补充下级目录',
};
const outlineExpansionModeOptions: Array<{ value: OutlineExpansionMode; title: string; description: string }> = [
  {
    value: 'original-only',
    title: outlineExpansionModeLabels['original-only'],
    description: '一级目录仍按格式要求或所选知识库生成；原方案只用于补充二级及以下目录。',
  },
  {
    value: 'ai-complement',
    title: outlineExpansionModeLabels['ai-complement'],
    description: '一级目录仍按格式要求或所选知识库生成，并由 AI 综合评分项和原方案补充二级及以下目录。',
  },
];

const WORDS_PER_TEN_THOUSAND = 10000;

function formatTenThousandWords(value: number) {
  const normalized = Math.max(0, Number(value) || 0) / WORDS_PER_TEN_THOUSAND;
  return Number.isInteger(normalized) ? String(normalized) : String(Math.round(normalized * 100) / 100);
}

function parseTenThousandWords(value: string) {
  if (!/^\d*(?:\.\d{0,2})?$/u.test(value)) return null;
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * WORDS_PER_TEN_THOUSAND) : null;
}

function normalizeWordControlDraft({ minimumWords, maximumWords, sectionWords, strictSectionWords }: {
  minimumWords: string;
  maximumWords: string;
  sectionWords: string;
  strictSectionWords: boolean;
}): OutlineWordControlOptions {
  const minimum = parseTenThousandWords(minimumWords);
  const maximum = parseTenThousandWords(maximumWords);
  const section = parseTenThousandWords(sectionWords);
  if (minimum === null || maximum === null || section === null) {
    throw new Error('字数设置只允许填写最多两位小数的非负万字数');
  }
  if (minimum > 0 && maximum > 0 && maximum < minimum) {
    throw new Error('最多字数不能低于最少字数');
  }
  return {
    enabled: true,
    minimumWords: minimum,
    maximumWords: maximum,
    sectionWords: section,
    strictSectionWords: section > 0 && strictSectionWords,
  };
}

function collectOutlineIds(items: OutlineItem[], ids = new Set<string>()) {
  items.forEach((item) => {
    ids.add(item.id);
    if (item.children?.length) {
      collectOutlineIds(item.children, ids);
    }
  });
  return ids;
}

function collectRootIds(items: OutlineItem[]) {
  return new Set(items.map((item) => item.id));
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function renumberOutlineItemsWithIdMap(items: OutlineItem[], parentPrefix = ''): RenumberResult {
  const idMap: Record<string, string> = {};
  const outline = items.map((item, index) => {
    const id = parentPrefix ? `${parentPrefix}.${index + 1}` : `${index + 1}`;
    const childResult = item.children?.length ? renumberOutlineItemsWithIdMap(item.children, id) : null;
    idMap[item.id] = id;
    if (childResult) {
      Object.assign(idMap, childResult.idMap);
    }
    return {
      ...item,
      id,
      children: childResult?.outline,
    };
  });

  return { outline, idMap };
}

function createIdentityIdMap(items: OutlineItem[], idMap: Record<string, string> = {}) {
  items.forEach((item) => {
    idMap[item.id] = item.id;
    if (item.children?.length) {
      createIdentityIdMap(item.children, idMap);
    }
  });
  return idMap;
}

function composeIdMap(baseMap: Record<string, string>, stepMap: Record<string, string>) {
  return Object.fromEntries(Object.entries(baseMap).map(([oldId, currentId]) => [oldId, stepMap[currentId] || currentId]));
}

function findOutlineLocation(items: OutlineItem[], itemId: string, parentId: string | null = null, level = 0): OutlineLocation | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.id === itemId) {
      return { parentId, level, index };
    }
    if (item.children?.length) {
      const child = findOutlineLocation(item.children, itemId, item.id, level + 1);
      if (child) return child;
    }
  }
  return null;
}

function reorderSiblingItems(items: OutlineItem[], draggedId: string, targetId: string, position: 'before' | 'after') {
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return items;
  }

  const next = [...items];
  const [dragged] = next.splice(draggedIndex, 1);
  const adjustedTargetIndex = next.findIndex((item) => item.id === targetId);
  const insertIndex = position === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  next.splice(insertIndex, 0, dragged);
  return next;
}

function reorderOutlineSiblings(items: OutlineItem[], parentId: string | null, draggedId: string, targetId: string, position: 'before' | 'after'): OutlineItem[] {
  if (parentId === null) {
    return reorderSiblingItems(items, draggedId, targetId, position);
  }

  return items.map((item) => {
    if (item.id === parentId) {
      return {
        ...item,
        children: reorderSiblingItems(item.children || [], draggedId, targetId, position),
      };
    }
    return item.children?.length
      ? { ...item, children: reorderOutlineSiblings(item.children, parentId, draggedId, targetId, position) }
      : item;
  });
}

function updateOutlineItem(items: OutlineItem[], itemId: string, updater: (item: OutlineItem) => OutlineItem): OutlineItem[] {
  return items.map((item) => {
    if (item.id === itemId) {
      return updater(item);
    }

    return {
      ...item,
      children: item.children ? updateOutlineItem(item.children, itemId, updater) : undefined,
    };
  });
}

function deleteOutlineItem(items: OutlineItem[], itemId: string): OutlineItem[] {
  return items.flatMap((item) => {
    if (item.id === itemId) {
      return [];
    }

    return [{
      ...item,
      children: item.children ? deleteOutlineItem(item.children, itemId) : undefined,
    }];
  });
}

function findOutlineItem(items: OutlineItem[], itemId: string): OutlineItem | null {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }
    const child = item.children ? findOutlineItem(item.children, itemId) : null;
    if (child) {
      return child;
    }
  }
  return null;
}

function findOutlineItemLevel(items: OutlineItem[], itemId: string, level = 1): number {
  for (const item of items) {
    if (item.id === itemId) {
      return level;
    }
    const childLevel = item.children ? findOutlineItemLevel(item.children, itemId, level + 1) : 0;
    if (childLevel) {
      return childLevel;
    }
  }
  return 0;
}

function isOutlinePositionLocked(item: OutlineItem) {
  return Boolean(item.order_locked || item.level_locked);
}

function getOutlineConstraintLabels(item: OutlineItem) {
  const hasFormatConstraints = Boolean(
    item.manual_input_required
    || item.format_node_id
    || item.required_in_outline
    || item.title_locked
    || item.order_locked
    || item.level_locked
    || item.response_required === false
    || item.allow_ai_children === false,
  );
  if (!hasFormatConstraints) return [];

  const labels: string[] = [];
  if (item.format_node_id) labels.push('固定目录');
  if (item.required_in_outline) labels.push('不可删除');
  if (item.title_locked) labels.push('标题锁定');
  if (item.order_locked) labels.push('顺序锁定');
  if (item.level_locked) labels.push('层级锁定');
  if (item.response_required === false) labels.push('只保留标题');

  return labels;
}

function updateOutlineSubtreeManual(items: OutlineItem[], itemId: string, manualInputRequired: boolean): OutlineItem[] {
  return items.map((item) => {
    if (item.id === itemId) {
      const applyToSubtree = (node: OutlineItem): OutlineItem => ({
        ...node,
        manual_input_required: manualInputRequired,
        children: node.children?.map(applyToSubtree),
      });
      return applyToSubtree(item);
    }
    return item.children?.length
      ? { ...item, children: updateOutlineSubtreeManual(item.children, itemId, manualInputRequired) }
      : item;
  });
}

function getOutlineWritingLabel(item: OutlineItem) {
  return item.manual_input_required ? '人工撰写' : 'AI 撰写';
}

function getOutlineFocusLabel(item: OutlineItem) {
  return item.focus_priority ? '重点' : undefined;
}

function getInitialExpandedKnowledgeFolders(index: KnowledgeBaseIndex) {
  const firstAvailableFolder = index.folders.find((folder) => (
    index.documents.some((document) => document.folder_id === folder.id && document.status === 'success')
  ));
  return new Set(firstAvailableFolder ? [firstAvailableFolder.id] : []);
}

function includesKeyword(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword);
}

function OutlineEditPage({
  workflowKind,
  projectOverview,
  techRequirements,
  outlineExpansionMode,
  outlineWordControlOptions,
  outlineWordControlSnapshot,
  formatRequirementsContent,
  referenceKnowledgeDocumentIds,
  outlineData,
  task,
  contentTaskStatus,
  onOutlineConfigChange,
  onOutlineSaved,
  onSortGuardChange,
}: OutlineEditPageProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editManualInputRequired, setEditManualInputRequired] = useState(false);
  const [startingOutline, setStartingOutline] = useState(false);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false);
  const [draftOutlineExpansionMode, setDraftOutlineExpansionMode] = useState<OutlineExpansionMode>(outlineExpansionMode);
  const [draftKnowledgeDocumentIds, setDraftKnowledgeDocumentIds] = useState<string[]>(referenceKnowledgeDocumentIds);
  const [draftMinimumWords, setDraftMinimumWords] = useState(formatTenThousandWords(outlineWordControlOptions.minimumWords));
  const [draftMaximumWords, setDraftMaximumWords] = useState(formatTenThousandWords(outlineWordControlOptions.maximumWords));
  const [draftSectionWords, setDraftSectionWords] = useState(formatTenThousandWords(outlineWordControlOptions.sectionWords));
  const [draftStrictSectionWords, setDraftStrictSectionWords] = useState(outlineWordControlOptions.strictSectionWords);
  const [developerMode, setDeveloperMode] = useState(false);
  const [draftForceOutlineAgentRepair, setDraftForceOutlineAgentRepair] = useState(false);
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const [expandedKnowledgeFolderIds, setExpandedKnowledgeFolderIds] = useState<Set<string>>(new Set());
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeBaseIndex>(emptyKnowledgeIndex);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [localStartAt, setLocalStartAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [sorting, setSorting] = useState(false);
  const [draftOutlineData, setDraftOutlineData] = useState<OutlineData | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormatConfig>(DEFAULT_EXPORT_FORMAT);
  const [sortDirty, setSortDirty] = useState(false);
  const [savingSort, setSavingSort] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const logListRef = useRef<HTMLDivElement | null>(null);
  const sortIdMapRef = useRef<Record<string, string>>({});
  const { showToast } = useToast();
  const formatStatusLine = formatRequirementsContent.replace(/^\uFEFF/u, '').trimStart().split(/\r?\n/u, 1)[0].trim();
  const hasExplicitFormat = formatStatusLine === '【技术文件目录状态】：明确';
  const hasUnspecifiedFormat = formatStatusLine === '【技术文件目录状态】：未明确';
  const missingRequiredKnowledge = hasUnspecifiedFormat && draftKnowledgeDocumentIds.length === 0;
  const activeOutlineData = sorting ? draftOutlineData : outlineData;
  const selectedItem = activeOutlineData && selectedItemId ? findOutlineItem(activeOutlineData.outline, selectedItemId) : null;
  const selectedItemLevel = selectedItem && activeOutlineData
    ? findOutlineItemLevel(activeOutlineData.outline, selectedItem.id)
    : 0;
  const taskRunning = task?.status === 'running';
  const taskFailed = task?.status === 'error';
  const generating = startingOutline || taskRunning;
  const isExpansionWorkflow = workflowKind === 'existing-plan-expansion';
  const knowledgePickingDisabled = generating;
  const contentMutationLocked = contentTaskStatus === 'running' || contentTaskStatus === 'pausing' || contentTaskStatus === 'paused';
  const outlineMutationLocked = generating || contentMutationLocked || savingSort;
  const progressLogs = task?.logs || [];
  const latestLog = progressLogs[progressLogs.length - 1];
  const progress = generating
    ? Math.max(5, Math.min(99, task?.progress || 5))
    : taskFailed
      ? Math.max(0, Math.min(99, task?.progress || 0))
      : outlineData || task?.status === 'success'
        ? 100
        : 0;
  const statusText = generating ? '运行中' : taskFailed ? '失败' : outlineData ? '已完成' : '未开始';
  const aiStatusTitle = generating ? 'AI 正在工作' : taskFailed ? '生成失败' : outlineData ? '目录已生成' : '等待生成';
  const statusMessage = taskFailed ? task?.error || latestLog || '目录生成失败，请查看开发者日志。' : latestLog || '点击生成目录后，这里会显示目录生成、审核和修正过程。';
  const startedAt = task?.started_at ? Date.parse(task.started_at) : NaN;
  const updatedAt = task?.updated_at ? Date.parse(task.updated_at) : NaN;
  const effectiveStartedAt = Number.isFinite(startedAt) ? startedAt : localStartAt;
  const elapsedText = generating && effectiveStartedAt ? `已运行 ${formatDuration(nowTick - effectiveStartedAt)}` : '';
  const staleText = generating && Number.isFinite(updatedAt) ? `最近更新 ${Math.floor(Math.max(0, nowTick - updatedAt) / 1000)} 秒前` : '';
  const wordControlChanged = Boolean(outlineData && (
    !outlineWordControlSnapshot
    || parseTenThousandWords(draftMinimumWords) !== outlineWordControlSnapshot.minimumWords
    || parseTenThousandWords(draftMaximumWords) !== outlineWordControlSnapshot.maximumWords
    || parseTenThousandWords(draftSectionWords) !== outlineWordControlSnapshot.sectionWords
    || (Boolean(parseTenThousandWords(draftSectionWords)) && draftStrictSectionWords) !== outlineWordControlSnapshot.strictSectionWords
  ));
  const draftMinimumWordsValue = parseTenThousandWords(draftMinimumWords) || 0;
  const draftMaximumWordsValue = parseTenThousandWords(draftMaximumWords) || 0;
  const estimatedPageWords = draftMinimumWordsValue > 0 && draftMaximumWordsValue > 0
    ? (draftMinimumWordsValue + draftMaximumWordsValue) / 2
    : draftMinimumWordsValue || draftMaximumWordsValue;
  const estimatedPages = estimatedPageWords > 0 ? Math.ceil(estimatedPageWords / 650) : null;

  const resetWordControlDraft = () => {
    setDraftMinimumWords(formatTenThousandWords(outlineWordControlOptions.minimumWords));
    setDraftMaximumWords(formatTenThousandWords(outlineWordControlOptions.maximumWords));
    setDraftSectionWords(formatTenThousandWords(outlineWordControlOptions.sectionWords));
    setDraftStrictSectionWords(outlineWordControlOptions.strictSectionWords);
  };

  useEffect(() => {
    let cancelled = false;
    window.yibiao?.config.load().then((cfg) => {
      if (cancelled) return;
      setDeveloperMode(Boolean(cfg?.developer_mode));
      if (!cfg?.developer_mode) {
        setDraftForceOutlineAgentRepair(false);
      }
      if (cfg?.export_format) {
        setExportFormat(cfg.export_format);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activeOutlineData?.outline?.length) {
      const validIds = collectOutlineIds(activeOutlineData.outline);
      setExpandedItems((prev) => {
        const next = new Set([...prev].filter((id) => validIds.has(id)));
        return next.size || sorting ? next : collectRootIds(activeOutlineData.outline);
      });
      setSelectedItemId((prev) => (prev && validIds.has(prev) ? prev : activeOutlineData.outline[0]?.id || null));
      return;
    }

    setExpandedItems(new Set());
    setSelectedItemId(null);
  }, [activeOutlineData]);

  useEffect(() => {
    if (task?.status) {
      setStartingOutline(false);
      if (task.status !== 'running') {
        setLocalStartAt(null);
      }
    }
  }, [task?.status]);

  useEffect(() => {
    if (!generating) {
      return;
    }

    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    if (logListRef.current) {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [progressLogs.length]);

  useEffect(() => {
    if (!generationDialogOpen) {
      return;
    }

    setDraftOutlineExpansionMode(isExpansionWorkflow ? outlineExpansionMode : 'ai-complement');
    setDraftKnowledgeDocumentIds(referenceKnowledgeDocumentIds);
    resetWordControlDraft();
    setDraftForceOutlineAgentRepair(false);
    setKnowledgeSearch('');
    void loadKnowledgeIndex();
  }, [generationDialogOpen, isExpansionWorkflow, outlineExpansionMode, outlineWordControlOptions, referenceKnowledgeDocumentIds]);

  const loadKnowledgeIndex = async () => {
    try {
      setLoadingKnowledge(true);
      const data = await window.yibiao?.knowledgeBase.list();
      setKnowledgeIndex(data || emptyKnowledgeIndex);
      setExpandedKnowledgeFolderIds(getInitialExpandedKnowledgeFolders(data || emptyKnowledgeIndex));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取知识库失败', 'error');
      setKnowledgeIndex(emptyKnowledgeIndex);
      setExpandedKnowledgeFolderIds(new Set());
    } finally {
      setLoadingKnowledge(false);
    }
  };

  const openGenerationDialog = () => {
    if (sorting) {
      showToast('请先保存当前目录排序', 'info');
      return;
    }
    const lockMessage = getMutationLockMessage();
    if (lockMessage) {
      showToast(lockMessage, 'info');
      return;
    }
    if (!projectOverview || !techRequirements) {
      showToast('请先完成招标文件解析', 'info');
      return;
    }

    setDraftOutlineExpansionMode(isExpansionWorkflow ? outlineExpansionMode : 'ai-complement');
    setDraftKnowledgeDocumentIds(referenceKnowledgeDocumentIds);
    resetWordControlDraft();
    setKnowledgeSearch('');
    setGenerationDialogOpen(true);
  };

  const getWordControlOptions = () => normalizeWordControlDraft({
    minimumWords: draftMinimumWords,
    maximumWords: draftMaximumWords,
    sectionWords: draftSectionWords,
    strictSectionWords: draftStrictSectionWords,
  });

  const saveOutlineConfig = async () => {
    try {
      await onOutlineConfigChange({
        referenceKnowledgeDocumentIds: draftKnowledgeDocumentIds,
        outlineExpansionMode: isExpansionWorkflow ? draftOutlineExpansionMode : 'ai-complement',
        wordControlOptions: getWordControlOptions(),
      });
      setGenerationDialogOpen(false);
      showToast('目录生成配置已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存目录配置失败', 'error');
    }
  };

  const generateOutline = async () => {
    const lockMessage = getMutationLockMessage();
    if (lockMessage) {
      throw new Error(lockMessage);
    }
    if (!projectOverview || !techRequirements) {
      showToast('请先完成招标文件解析', 'info');
      return;
    }
    if (missingRequiredKnowledge) {
      showToast('招标文件未规定明确目录格式，请至少选择一份参考知识库文档后生成目录。', 'info');
      return;
    }

    try {
      const wordControlOptions = getWordControlOptions();
      const startedNow = Date.now();
      setStartingOutline(true);
      setLocalStartAt(startedNow);
      setNowTick(startedNow);
      const nextOutlineExpansionMode = isExpansionWorkflow ? draftOutlineExpansionMode : 'ai-complement';
      await onOutlineConfigChange({
        referenceKnowledgeDocumentIds: draftKnowledgeDocumentIds,
        outlineExpansionMode: nextOutlineExpansionMode,
        wordControlOptions,
      });
      setGenerationDialogOpen(false);
      await window.yibiao?.tasks.startOutlineGeneration({
        reference_knowledge_document_ids: draftKnowledgeDocumentIds,
        outline_expansion_mode: nextOutlineExpansionMode,
        word_control_options: wordControlOptions,
        debug_force_outline_agent_repair: developerMode && draftForceOutlineAgentRepair,
      });
      trackConfigUsage({ outline_mode: isExpansionWorkflow ? nextOutlineExpansionMode : 'aligned' });
      showToast('目录生成任务已在后台启动', 'success');
    } catch (error) {
      setStartingOutline(false);
      setLocalStartAt(null);
      showToast(error instanceof Error ? error.message : '启动目录生成任务失败', 'error');
    }
  };

  const toggleDraftKnowledgeDocument = (document: KnowledgeDocument) => {
    if (document.status !== 'success' || knowledgePickingDisabled) {
      return;
    }

    setDraftKnowledgeDocumentIds((prev) => (
      prev.includes(document.id)
        ? prev.filter((id) => id !== document.id)
        : [...prev, document.id]
    ));
  };

  const toggleKnowledgeFolder = (folderId: string) => {
    setExpandedKnowledgeFolderIds((prev) => (prev.has(folderId) ? new Set() : new Set([folderId])));
  };

  const selectFolderDocuments = (documents: KnowledgeDocument[]) => {
    if (knowledgePickingDisabled) {
      return;
    }
    const ids = documents.filter((document) => document.status === 'success').map((document) => document.id);
    setDraftKnowledgeDocumentIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
  };

  const clearFolderDocuments = (documents: KnowledgeDocument[]) => {
    if (knowledgePickingDisabled) {
      return;
    }
    const ids = new Set(documents.map((document) => document.id));
    setDraftKnowledgeDocumentIds((prev) => prev.filter((id) => !ids.has(id)));
  };

  const removeDraftKnowledgeDocument = (documentId: string) => {
    if (knowledgePickingDisabled) {
      return;
    }
    setDraftKnowledgeDocumentIds((prev) => prev.filter((id) => id !== documentId));
  };

  const clearDraftKnowledgeDocuments = () => {
    if (knowledgePickingDisabled) {
      return;
    }
    setDraftKnowledgeDocumentIds([]);
  };

  const getMutationLockMessage = () => {
    if (generating) return '目录生成任务正在运行，当前目录暂不可编辑';
    if (contentMutationLocked) return '正文生成任务正在运行或暂停中，请结束后再调整目录';
    return '';
  };

  const saveOutlineChange = async (outline: OutlineItem[], reason: SaveOutlineRequest['reason'], affectedNodeIds: string[] = []) => {
    if (!outlineData) {
      return;
    }
    const lockMessage = getMutationLockMessage();
    if (lockMessage) {
      showToast(lockMessage, 'info');
      return;
    }

    const renumbered = renumberOutlineItemsWithIdMap(outline);
    await onOutlineSaved({
      outlineData: { ...outlineData, outline: renumbered.outline },
      reason,
      idMap: renumbered.idMap,
      affectedNodeIds,
    });
  };

  const changeManualAuthoring = async (item: OutlineItem, manualInputRequired: boolean) => {
    if (!outlineData || outlineMutationLocked || sorting) return;
    try {
      await saveOutlineChange(
        updateOutlineSubtreeManual(outlineData.outline, item.id, manualInputRequired),
        'edit',
        [item.id],
      );
      showToast(manualInputRequired ? '已设为人工撰写，全部下级目录同步更新' : '已设为 AI 撰写，全部下级目录同步更新', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '更新编制方式失败', 'error');
    }
  };

  const startEditing = (item: OutlineItem) => {
    if (sorting || outlineMutationLocked || item.title_locked) {
      return;
    }
    setSelectedItemId(item.id);
    setEditingItemId(item.id);
    setEditTitle(stripRepeatedSourceNumber(item.title, item.source_number));
    setEditDescription(item.description);
    setEditManualInputRequired(item.manual_input_required === true);
  };

  const saveEditing = async () => {
    if (!outlineData || !editingItemId || sorting || outlineMutationLocked) {
      return;
    }

    const editingItem = findOutlineItem(outlineData.outline, editingItemId);
    if (editingItem?.title_locked) {
      setEditingItemId(null);
      showToast('该节点标题来自招标文件，不能修改', 'info');
      return;
    }
    try {
      const editedOutline = updateOutlineItem(outlineData.outline, editingItemId, (item) => ({
        ...item,
        title: editTitle.trim() || item.title,
        description: editDescription.trim(),
      }));
      await saveOutlineChange(
        updateOutlineSubtreeManual(editedOutline, editingItemId, editManualInputRequired),
        'edit',
        [editingItemId],
      );
      setEditingItemId(null);
      showToast('目录项已更新，相关正文已清空', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存目录项失败', 'error');
    }
  };

  const addRootItem = async () => {
    if (!outlineData || sorting || outlineMutationLocked) {
      return;
    }

    const newItem: OutlineItem = {
      id: `${outlineData.outline.length + 1}`,
      title: '新目录项',
      description: '请编辑描述',
    };
    try {
      await saveOutlineChange([...outlineData.outline, newItem], 'add-root');
      setSelectedItemId(newItem.id);
      setEditingItemId(newItem.id);
      setEditTitle(newItem.title);
      setEditDescription(newItem.description);
      showToast('一级目录已添加', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '添加一级目录失败', 'error');
    }
  };

  const addChildItem = async (parentId: string) => {
    if (!outlineData || sorting || outlineMutationLocked) {
      return;
    }

    const parent = findOutlineItem(outlineData.outline, parentId);
    if (parent?.allow_ai_children === false) {
      showToast('该固定目录不允许添加子目录', 'info');
      return;
    }
    if (findOutlineItemLevel(outlineData.outline, parentId) >= 5) {
      showToast('目录最多五级，五级目录不能新增子目录', 'info');
      return;
    }
    const nextIndex = (parent?.children?.length || 0) + 1;
    const newItem: OutlineItem = {
      id: `${parentId}.${nextIndex}`,
      title: '新目录项',
      description: '请编辑描述',
      manual_input_required: parent?.manual_input_required === true,
    };

    try {
      await saveOutlineChange(updateOutlineItem(outlineData.outline, parentId, (item) => ({
        ...item,
        children: [...(item.children || []), newItem],
      })), 'add-child', [parentId]);
      setExpandedItems((prev) => new Set(prev).add(parentId));
      setSelectedItemId(newItem.id);
      setEditingItemId(newItem.id);
      setEditTitle(newItem.title);
      setEditDescription(newItem.description);
      showToast('子目录已添加，父目录正文已清空', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '添加子目录失败', 'error');
    }
  };

  const removeItem = async (itemId: string) => {
    if (!outlineData || sorting || outlineMutationLocked) {
      return;
    }
    try {
      const removedItem = findOutlineItem(outlineData.outline, itemId);
      if (removedItem?.required_in_outline) {
        showToast('该节点属于招标文件固定目录，不能删除', 'info');
        return;
      }
      const removedIds = removedItem ? [...collectOutlineIds([removedItem])] : [itemId];
      const nextOutline = deleteOutlineItem(outlineData.outline, itemId);
      if (!nextOutline.length) {
        showToast('至少保留一个目录项', 'info');
        return;
      }
      await saveOutlineChange(nextOutline, 'delete', removedIds);
      setSelectedItemId(null);
      showToast('目录项已删除', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除目录项失败', 'error');
    }
  };

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const expandAllItems = () => {
    if (activeOutlineData?.outline?.length) {
      setExpandedItems(collectOutlineIds(activeOutlineData.outline));
    }
  };

  const collapseAllItems = () => {
    setExpandedItems(new Set());
  };

  const startSorting = () => {
    if (!outlineData?.outline?.length) {
      return;
    }
    const lockMessage = getMutationLockMessage();
    if (lockMessage) {
      showToast(lockMessage, 'info');
      return;
    }

    setDraftOutlineData(outlineData);
    sortIdMapRef.current = createIdentityIdMap(outlineData.outline);
    setSorting(true);
    setSortDirty(false);
    setEditingItemId(null);
    setDraggingItemId(null);
    setDropTarget(null);
    showToast('仅支持同级目录排序；顺序或层级锁定的目录不可拖动，点击保存排序后才会写入数据库。', 'info');
  };

  const discardSorting = () => {
    setSorting(false);
    setDraftOutlineData(null);
    setSortDirty(false);
    setSavingSort(false);
    setDraggingItemId(null);
    setDropTarget(null);
    sortIdMapRef.current = {};
  };

  const saveSorting = async () => {
    if (!draftOutlineData?.outline?.length) {
      discardSorting();
      return;
    }
    if (!sortDirty) {
      discardSorting();
      return;
    }
    const lockMessage = getMutationLockMessage();
    if (lockMessage) {
      throw new Error(lockMessage);
    }

    setSavingSort(true);
    try {
      await onOutlineSaved({
        outlineData: draftOutlineData,
        reason: 'sort',
        idMap: sortIdMapRef.current,
      });
      discardSorting();
      showToast('目录排序已保存', 'success');
    } finally {
      setSavingSort(false);
    }
  };

  useEffect(() => {
    if (!onSortGuardChange) return;
    onSortGuardChange({
      hasUnsavedSort: () => sorting && sortDirty,
      saveSort: saveSorting,
      discardSort: discardSorting,
    });
    return () => onSortGuardChange(null);
  }, [onSortGuardChange, sorting, sortDirty, draftOutlineData]);

  const getDropPosition = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  const canDropOnTarget = (draggedId: string, targetId: string) => {
    if (!activeOutlineData?.outline?.length || draggedId === targetId) return false;
    const dragged = findOutlineLocation(activeOutlineData.outline, draggedId);
    const target = findOutlineLocation(activeOutlineData.outline, targetId);
    if (!dragged || !target || dragged.parentId !== target.parentId || dragged.level !== target.level) return false;

    const siblings = dragged.parentId === null
      ? activeOutlineData.outline
      : findOutlineItem(activeOutlineData.outline, dragged.parentId)?.children;
    if (!siblings) return false;
    const start = Math.min(dragged.index, target.index);
    const end = Math.max(dragged.index, target.index);
    return !siblings.slice(start, end + 1).some(isOutlinePositionLocked);
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, item: OutlineItem) => {
    if (!sorting || isOutlinePositionLocked(item)) {
      event.preventDefault();
      return;
    }
    setDraggingItemId(item.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, item: OutlineItem) => {
    if (!sorting || !draggingItemId) {
      return;
    }
    event.preventDefault();
    const valid = canDropOnTarget(draggingItemId, item.id);
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    setDropTarget({ itemId: item.id, position: getDropPosition(event), valid });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, item: OutlineItem) => {
    event.preventDefault();
    if (!sorting || !draftOutlineData?.outline?.length || !draggingItemId) {
      return;
    }

    const valid = canDropOnTarget(draggingItemId, item.id);
    if (!valid) {
      setDraggingItemId(null);
      setDropTarget(null);
      showToast('只能同级目录排序', 'info');
      return;
    }

    const sourceLocation = findOutlineLocation(draftOutlineData.outline, draggingItemId);
    if (!sourceLocation) {
      setDraggingItemId(null);
      setDropTarget(null);
      return;
    }

    const position = dropTarget?.itemId === item.id ? dropTarget.position : getDropPosition(event);
    const reordered = reorderOutlineSiblings(draftOutlineData.outline, sourceLocation.parentId, draggingItemId, item.id, position);
    const renumbered = renumberOutlineItemsWithIdMap(reordered);
    sortIdMapRef.current = composeIdMap(sortIdMapRef.current, renumbered.idMap);
    setDraftOutlineData({ ...draftOutlineData, outline: renumbered.outline });
    setExpandedItems((prev) => new Set([...prev].map((id) => renumbered.idMap[id] || id)));
    setSelectedItemId((prev) => (prev ? renumbered.idMap[prev] || prev : prev));
    setSortDirty(true);
    setDraggingItemId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggingItemId(null);
    setDropTarget(null);
  };

  const renderItem = (item: OutlineItem, level = 0) => {
    const hasChildren = Boolean(item.children?.length);
    const isExpanded = expandedItems.has(item.id);
    const isActive = selectedItemId === item.id;
    const isDragging = draggingItemId === item.id;
    const isDropTarget = dropTarget?.itemId === item.id;
    const heading = exportFormat.headings[Math.min(item.id.split('.').length - 1, 5)];
    const displayTitle = formatOutlineDisplayTitle(item, heading);
    const constraintLabels = getOutlineConstraintLabels(item);
    const writingLabel = getOutlineWritingLabel(item);
    const focusLabel = getOutlineFocusLabel(item);
    const positionLocked = isOutlinePositionLocked(item);
    const dropClass = isDropTarget
      ? dropTarget.valid
        ? ` is-drop-${dropTarget.position}`
        : ' is-drop-invalid'
      : '';

    return (
      <div className="outline-tree-node" key={item.id} style={{ '--outline-level': level } as CSSProperties}>
        <div
          className={`outline-tree-item${isActive ? ' is-active' : ''}${sorting ? ' is-sorting' : ''}${isDragging ? ' is-dragging' : ''}${dropClass}`}
          draggable={sorting && !positionLocked}
          onDragStart={(event) => handleDragStart(event, item)}
          onDragOver={(event) => handleDragOver(event, item)}
          onDrop={(event) => handleDrop(event, item)}
          onDragEnd={handleDragEnd}
        >
          {sorting && <span className="outline-tree-drag-handle" aria-hidden="true">{positionLocked ? '锁' : '⋮⋮'}</span>}
          <button
            type="button"
            className={`outline-tree-toggle${hasChildren ? '' : ' is-leaf'}${isExpanded ? ' is-expanded' : ''}`}
            onClick={() => hasChildren && toggleExpanded(item.id)}
            disabled={!hasChildren}
            aria-label={hasChildren ? `${isExpanded ? '折叠' : '展开'} ${displayTitle}` : `${displayTitle} 无子目录`}
          >
            {hasChildren ? '›' : '•'}
          </button>
          <button
            type="button"
            className="outline-tree-content"
            onClick={() => setSelectedItemId(item.id)}
            onDoubleClick={() => hasChildren && toggleExpanded(item.id)}
          >
            <strong>{displayTitle}</strong>
            <span className="outline-tree-writing-chip">{writingLabel}</span>
            {focusLabel && <span className="outline-tree-focus-chip">{focusLabel}</span>}
            {constraintLabels.length > 0 && <span className="outline-tree-constraint-chip">{constraintLabels.join(' · ')}</span>}
          </button>
          {level < 3 && (
            <label className="outline-tree-manual-toggle" onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={item.manual_input_required === true}
                disabled={outlineMutationLocked || sorting}
                onChange={(event) => { void changeManualAuthoring(item, event.target.checked); }}
              />
              <span>人工撰写</span>
            </label>
          )}
        </div>
        {hasChildren && isExpanded && item.children?.map((child) => renderItem(child, level + 1))}
      </div>
    );
  };

  const renderOutlineExpansionModePicker = () => {
    if (!isExpansionWorkflow) {
      return null;
    }

    return (
      <section className="outline-generation-config-section outline-expansion-mode-section">
        <div className="outline-generation-config-head">
          <strong>原方案目录使用方式</strong>
          <span>{outlineExpansionModeLabels[draftOutlineExpansionMode]}</span>
        </div>
        <div className="outline-expansion-mode-switch">
          {outlineExpansionModeOptions.map((option) => {
            const selected = draftOutlineExpansionMode === option.value;
            return (
              <button
                type="button"
                className={`outline-expansion-mode-option${selected ? ' is-selected' : ''}`}
                key={option.value}
                onClick={() => setDraftOutlineExpansionMode(option.value)}
                disabled={generating}
                aria-pressed={selected}
              >
                <strong>{option.title}</strong>
                <span>{option.description}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  const renderKnowledgePicker = () => {
    if (loadingKnowledge) {
      return <div className="outline-knowledge-empty">正在读取知识库...</div>;
    }

    const keyword = knowledgeSearch.trim().toLowerCase();
    const availableDocuments = knowledgeIndex.documents.filter((document) => document.status === 'success');
    const selectedDocuments = draftKnowledgeDocumentIds
      .map((documentId) => knowledgeIndex.documents.find((document) => document.id === documentId))
      .filter((document): document is KnowledgeDocument => Boolean(document));
    const visibleFolders = knowledgeIndex.folders.flatMap((folder) => {
      const folderDocuments = availableDocuments.filter((document) => document.folder_id === folder.id);
      const folderMatched = keyword ? includesKeyword(folder.name, keyword) : false;
      const documents = keyword
        ? folderDocuments.filter((document) => folderMatched || includesKeyword(document.file_name, keyword))
        : folderDocuments;

      return documents.length ? [{ folder, documents }] : [];
    });
    const visibleDocumentCount = visibleFolders.reduce((total, group) => total + group.documents.length, 0);

    if (!availableDocuments.length) {
      return <div className="outline-knowledge-empty">暂无已完成的知识库文档，可先到知识库上传并处理完成后再选择。</div>;
    }

    return (
      <div className="outline-knowledge-compact">
        <div className="outline-knowledge-search-row">
          <input
            className="outline-knowledge-search"
            value={knowledgeSearch}
            onChange={(event) => setKnowledgeSearch(event.target.value)}
            disabled={knowledgePickingDisabled}
            placeholder="搜索文件夹或文档"
          />
          <span>{keyword ? `匹配 ${visibleDocumentCount} 个文档` : `共 ${availableDocuments.length} 个可用文档`}</span>
        </div>
        <div className="outline-knowledge-grid">
          <div className="outline-knowledge-browser">
            <div className="outline-knowledge-pane-head">
              <strong>知识库</strong>
              <span>{visibleFolders.length} 个文件夹</span>
            </div>
            <div className="outline-knowledge-folder-list compact">
              {visibleFolders.length ? visibleFolders.map(({ folder, documents }) => {
                const expanded = keyword ? true : expandedKnowledgeFolderIds.has(folder.id);
                const selectedCount = documents.filter((document) => draftKnowledgeDocumentIds.includes(document.id)).length;

                return (
                  <section className="outline-knowledge-folder compact" key={folder.id}>
                    <div className="outline-knowledge-folder-head compact">
                      <button type="button" onClick={() => toggleKnowledgeFolder(folder.id)} disabled={Boolean(keyword)} aria-expanded={expanded}>
                        <span>{expanded ? '▾' : '▸'}</span>
                        <strong>{folder.name}</strong>
                      </button>
                      <small>{documents.length} 个 / 已选 {selectedCount}</small>
                      <div className="outline-knowledge-folder-actions">
                        <button type="button" onClick={() => selectFolderDocuments(documents)} disabled={knowledgePickingDisabled}>全选</button>
                        <button type="button" onClick={() => clearFolderDocuments(documents)} disabled={knowledgePickingDisabled || !selectedCount}>取消</button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="outline-knowledge-document-list compact">
                        {documents.map((document) => {
                          const selected = draftKnowledgeDocumentIds.includes(document.id);

                          return (
                            <label className={`outline-knowledge-document compact${selected ? ' is-selected' : ''}`} key={document.id}>
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={knowledgePickingDisabled}
                                onChange={() => toggleDraftKnowledgeDocument(document)}
                              />
                              <strong title={document.file_name}>{document.file_name}</strong>
                              <small>{document.item_count || 0} 条</small>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              }) : <div className="outline-knowledge-empty compact">没有匹配的知识库文档</div>}
            </div>
          </div>
          <aside className="outline-knowledge-selected-pane">
            <div className="outline-knowledge-pane-head">
              <strong>本次已选</strong>
              <button type="button" onClick={clearDraftKnowledgeDocuments} disabled={knowledgePickingDisabled || !draftKnowledgeDocumentIds.length}>清空</button>
            </div>
            {selectedDocuments.length ? (
              <div className="outline-knowledge-selected-list">
                {selectedDocuments.map((document) => (
                  <div className="outline-knowledge-selected-item" key={document.id}>
                    <strong title={document.file_name}>{document.file_name}</strong>
                    <button type="button" onClick={() => removeDraftKnowledgeDocument(document.id)} disabled={knowledgePickingDisabled}>移除</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="outline-knowledge-empty compact">未选择知识库文档</div>
            )}
          </aside>
        </div>
      </div>
    );
  };

  return (
    <div className="plan-step-body outline-generation-page">
      <section className="outline-command-bar">
        <div>
          <span className="section-kicker">STEP 03</span>
          <strong>目录生成</strong>
          <p>{isExpansionWorkflow ? `当前原方案目录使用方式：${outlineExpansionModeLabels[outlineExpansionMode]}；参考知识库：${referenceKnowledgeDocumentIds.length ? `已选择 ${referenceKnowledgeDocumentIds.length} 个文档` : '未选择'}。` : `生成前选择参考知识库；当前参考知识库：${referenceKnowledgeDocumentIds.length ? `已选择 ${referenceKnowledgeDocumentIds.length} 个文档` : '未选择'}。`}</p>
        </div>
        <div className="outline-command-actions">
          <button
            type="button"
            className="outline-config-action"
            onClick={openGenerationDialog}
            disabled={generating || sorting || contentMutationLocked || !projectOverview || !techRequirements}
            aria-label="打开目录生成配置"
            title="目录生成配置"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 8.93a1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 10 3.01V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
          <button type="button" className="primary-action" onClick={openGenerationDialog} disabled={generating || sorting || contentMutationLocked || !projectOverview || !techRequirements}>
            {generating ? 'AI 正在生成目录' : outlineData ? '重新生成目录' : '生成目录'}
          </button>
        </div>
      </section>

      <section className="outline-generation-workspace">
        <aside className="outline-progress-panel">
          <div className="analysis-result-head">
            <strong>生成过程</strong>
            <span>{statusText}</span>
          </div>
          <div className={`content-outline-stats outline-progress-summary${progressCollapsed ? ' is-collapsed' : ''}`}>
            <button type="button" onClick={() => setProgressCollapsed((prev) => !prev)} aria-expanded={!progressCollapsed}>
              <span>生成进度</span>
              <strong>{progress}%</strong>
              <em>{progressCollapsed ? '展开' : '折叠'}</em>
            </button>
            {!progressCollapsed && (
              <div className="content-outline-stats-body">
                <div className="content-generation-progress-track" aria-label={`目录生成进度 ${progress}%`}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p>{statusMessage}</p>
                {(elapsedText || staleText) && (
                  <div className="outline-progress-meta">
                    {elapsedText && <span>{elapsedText}</span>}
                    {staleText && <span>{staleText}</span>}
                  </div>
                )}
                {taskFailed && <small>{task?.error || latestLog || '目录生成失败'}</small>}
              </div>
            )}
          </div>
          <div className="outline-progress-log" ref={logListRef}>
            {progressLogs.length ? progressLogs.map((item, index) => (
              <p className={index === progressLogs.length - 1 ? 'is-latest' : ''} key={`${item}-${index}`}>{item}</p>
            )) : <p>等待生成任务启动。</p>}
          </div>
        </aside>

        <section className="outline-tree-panel">
          <div className="analysis-result-head outline-tree-head">
            <div>
              <strong>目录结构</strong>
              <span>{activeOutlineData?.outline?.length || 0} 个一级目录{sorting ? ' · 排序中' : ''}</span>
            </div>
            <div className="outline-tree-tools">
              {sorting ? (
                <>
                  <button type="button" className="outline-save-sort-action" onClick={() => { void saveSorting().catch((error) => showToast(error instanceof Error ? error.message : '保存排序失败', 'error')); }} disabled={savingSort}>
                    {savingSort ? '正在保存...' : '保存排序'}
                  </button>
                  <button type="button" onClick={expandAllItems} disabled={!activeOutlineData?.outline?.length}>全部展开</button>
                  <button type="button" onClick={collapseAllItems} disabled={!activeOutlineData?.outline?.length}>全部折叠</button>
                </>
              ) : (
                <>
                {outlineData && (
                <button type="button" className="outline-add-root-action" onClick={() => { void addRootItem(); }} disabled={outlineMutationLocked}>
                  添加一级目录
                </button>
                )}
                {outlineData && (
                  <button type="button" onClick={startSorting} disabled={outlineMutationLocked || !outlineData?.outline?.length}>目录排序</button>
                )}
                <button type="button" onClick={expandAllItems} disabled={!activeOutlineData?.outline?.length}>全部展开</button>
                <button type="button" onClick={collapseAllItems} disabled={!activeOutlineData?.outline?.length}>全部折叠</button>
                </>
              )}
            </div>
          </div>
          {activeOutlineData?.outline?.length ? (
            <div className={`outline-tree-list${sorting ? ' is-sorting' : ''}`}>
              {activeOutlineData.outline.map((item) => renderItem(item))}
            </div>
          ) : (
            <div className="markdown-empty-state outline-empty-state">
              <strong>尚未生成目录</strong>
              <p>先完成招标文件解析，再生成技术方案目录。</p>
            </div>
          )}
        </section>

        <aside className="outline-detail-panel">
          <div className="analysis-result-head">
            <div>
              <strong>目录项详情</strong>
              <span>{selectedItem ? formatOutlineDisplayNumber(selectedItem, exportFormat.headings[Math.min(selectedItem.id.split('.').length - 1, 5)]) || '无编号' : '未选择'}</span>
            </div>
          </div>
          {selectedItem ? (
            <div className="outline-detail-body">
              {(generating || contentMutationLocked || sorting) && (
                <div className="outline-detail-lock">
                  {sorting
                    ? '目录排序中，当前目录暂不可编辑。'
                    : contentMutationLocked
                      ? '正文生成任务正在运行或暂停中，当前目录暂不可编辑。'
                      : '目录生成任务正在运行，当前目录暂不可编辑，避免覆盖后台生成结果。'}
                </div>
              )}
              {editingItemId === selectedItem.id ? (
                <>
                  <label>
                    <span>标题</span>
                    <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} disabled={outlineMutationLocked || sorting} />
                  </label>
                  <label>
                    <span>描述</span>
                    <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} disabled={outlineMutationLocked || sorting} />
                  </label>
                  <label>
                    <span>正文填写方式</span>
                    <select
                      value={editManualInputRequired ? 'manual' : 'ai'}
                      onChange={(event) => setEditManualInputRequired(event.target.value === 'manual')}
                      disabled={outlineMutationLocked || sorting}
                    >
                      <option value="ai">AI 撰写</option>
                      <option value="manual">人工撰写</option>
                    </select>
                  </label>
                  <div className="outline-detail-actions">
                    <button type="button" className="primary-action" onClick={() => { void saveEditing(); }} disabled={outlineMutationLocked || sorting}>保存</button>
                    <button type="button" className="secondary-action" onClick={() => setEditingItemId(null)}>取消</button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{formatOutlineDisplayTitle(selectedItem, exportFormat.headings[Math.min(selectedItem.id.split('.').length - 1, 5)])}</h3>
                  <p>{selectedItem.description || '无描述'}</p>
                  {selectedItem.source_requirement_title && <small>来源评分项：{selectedItem.source_requirement_title}</small>}
                   {getOutlineConstraintLabels(selectedItem).length > 0 && (
                    <div className="outline-detail-actions" aria-label="目录约束状态">
                      {getOutlineConstraintLabels(selectedItem).map((label) => <span className="bid-analysis-section-chip" key={label}>{label}</span>)}
                    </div>
                   )}
                  <div className="outline-detail-actions" aria-label="正文填写方式">
                    <span className="bid-analysis-section-chip">{getOutlineWritingLabel(selectedItem)}</span>
                    {getOutlineFocusLabel(selectedItem) && <span className="bid-analysis-section-chip">{getOutlineFocusLabel(selectedItem)}</span>}
                  </div>
                  <div className="outline-detail-actions">
                    {!selectedItem.title_locked && <button type="button" className="primary-action" onClick={() => startEditing(selectedItem)} disabled={outlineMutationLocked || sorting}>编辑</button>}
                    {selectedItem.allow_ai_children !== false && <button type="button" className="secondary-action" onClick={() => { void addChildItem(selectedItem.id); }} disabled={outlineMutationLocked || sorting || selectedItemLevel >= 5} title={selectedItemLevel >= 5 ? '目录最多五级' : undefined}>添加子目录</button>}
                    {!selectedItem.required_in_outline && <button type="button" className="danger-action" onClick={() => { void removeItem(selectedItem.id); }} disabled={outlineMutationLocked || sorting}>删除</button>}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="markdown-empty-state outline-empty-state">
              <strong>选择一个目录项</strong>
              <p>在左侧目录树中选择章节后，可查看并编辑标题和描述。</p>
            </div>
          )}
        </aside>
      </section>

      <Dialog.Root open={generationDialogOpen} onOpenChange={setGenerationDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="outline-generation-config-card">
            <Dialog.Title className="sr-only">{outlineData ? '重新生成目录' : '生成目录'}</Dialog.Title>
            <Dialog.Description className="sr-only">选择本次目录生成方式和参考知识库。</Dialog.Description>

            <div className={`outline-generation-config-body${isExpansionWorkflow ? ' has-expansion-mode' : ''}${developerMode ? ' has-dev-tools' : ''}`}>
              {renderOutlineExpansionModePicker()}
              {developerMode && (
                <section className="outline-generation-config-section outline-agent-debug-section">
                  <label className="outline-agent-debug-option">
                    <span>
                      <strong>强制 Agent 修复目录</strong>
                      <small>本次目录生成会在最终保存前强制进入 OpenCode Agent 修复链路，用于验证 Agent workspace、结果 JSON 和程序校验。</small>
                    </span>
                    <span className="yb-switch-control">
                      <input
                        type="checkbox"
                        checked={draftForceOutlineAgentRepair}
                        onChange={(event) => setDraftForceOutlineAgentRepair(event.target.checked)}
                      />
                      <span className="yb-switch-track" aria-hidden="true">
                        <span className="yb-switch-thumb" />
                      </span>
                    </span>
                  </label>
                </section>
              )}
              <div className="outline-generation-config-main">
                <section className="outline-generation-config-section outline-word-control-section">
                  <div className="outline-generation-config-head">
                    <div>
                      <strong className="outline-config-section-title">全文字数/页数预设</strong>
                      <small>在目录生成阶段，预先设定全文生成的字数（单位：万字）</small>
                    </div>
                  </div>
                  <div className="outline-word-control-grid">
                    <label><span>最少字数（万）</span><input inputMode="decimal" value={draftMinimumWords} onChange={(event) => /^\d*(?:\.\d{0,2})?$/u.test(event.target.value) && setDraftMinimumWords(event.target.value)} /></label>
                    <label><span>最多字数（万）</span><input inputMode="decimal" value={draftMaximumWords} onChange={(event) => /^\d*(?:\.\d{0,2})?$/u.test(event.target.value) && setDraftMaximumWords(event.target.value)} /></label>
                    <label><span>每小节字数（万）</span><input inputMode="decimal" value={draftSectionWords} onChange={(event) => /^\d*(?:\.\d{0,2})?$/u.test(event.target.value) && setDraftSectionWords(event.target.value)} /></label>
                  </div>
                  <small className="outline-word-control-helper">0 表示不限制；每小节为 0 时不控制小节字数。</small>
                  <label className="outline-word-control-switch"><span><strong>严格控制单节字数</strong><small>允许范围为目标字数上下 20%</small></span><span className="yb-switch-control"><input type="checkbox" checked={draftStrictSectionWords} disabled={!Boolean(parseTenThousandWords(draftSectionWords))} onChange={(event) => setDraftStrictSectionWords(event.target.checked)} /><span className="yb-switch-track" aria-hidden="true"><span className="yb-switch-thumb" /></span></span></label>
                  <div className="outline-word-control-pages"><strong>预估页数</strong>{estimatedPages ? <span>约 {estimatedPages} 页</span> : <em>填写最少或最多字数后显示</em>}<small>页数和排版有关，无法精确预估。</small></div>
                  {wordControlChanged && <small className="outline-word-control-change-note">当前目录仍使用上次生效的字数规则；重新生成目录后才会应用新设置。</small>}
                </section>
                <section className="outline-generation-config-section outline-knowledge-picker">
                  <div className="outline-generation-config-head">
                    <strong className="outline-config-section-title">参考知识库</strong>
                    <span>已选择 {draftKnowledgeDocumentIds.length} 个文档</span>
                  </div>
                  {renderKnowledgePicker()}
                </section>
              </div>
            </div>

            <div className="content-regenerate-actions">
              <Dialog.Close className="secondary-action" type="button">取消</Dialog.Close>
              <button type="button" className="secondary-action" onClick={() => { void saveOutlineConfig(); }} disabled={generating || contentMutationLocked}>
                保存配置
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={generateOutline}
                disabled={generating || contentMutationLocked || !projectOverview || !techRequirements || missingRequiredKnowledge || (!hasExplicitFormat && !hasUnspecifiedFormat)}
              >
                开始生成
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  );
}

export default OutlineEditPage;
