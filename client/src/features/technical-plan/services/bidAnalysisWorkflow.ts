import type {
  BidAnalysisMode,
  BidAnalysisTaskDefinition,
  BidAnalysisTaskState,
  BidAnalysisTasks,
} from '../types';

export function getBidAnalysisTasks(
  definitions: readonly BidAnalysisTaskDefinition[],
  mode: BidAnalysisMode,
) {
  return mode === 'full' ? [...definitions] : definitions.filter((task) => task.required);
}

export function getBidAnalysisTaskById(
  definitions: readonly BidAnalysisTaskDefinition[],
  taskId: string,
) {
  return definitions.find((task) => task.id === taskId);
}

export function isBidAnalysisTaskResultValid(
  definition: BidAnalysisTaskDefinition,
  state?: BidAnalysisTaskState,
) {
  if (state?.status !== 'success' || !String(state.content || '').trim()) {
    return false;
  }

  if (definition.id === 'responseFileRequirements') {
    const firstLine = String(state.content || '').replace(/^\uFEFF/u, '').trimStart().split(/\r?\n/u, 1)[0].trim();
    return firstLine === '【技术文件目录状态】：明确' || firstLine === '【技术文件目录状态】：未明确';
  }

  if (definition.output !== 'json') {
    return true;
  }

  try {
    const parsed = JSON.parse(state.content);
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function areRequiredBidAnalysisTasksReady(
  definitions: readonly BidAnalysisTaskDefinition[],
  tasks: BidAnalysisTasks,
) {
  const requiredDefinitions = definitions.filter((definition) => definition.required);
  return requiredDefinitions.length === 7
    && requiredDefinitions.every((definition) => isBidAnalysisTaskResultValid(definition, tasks[definition.id]));
}
