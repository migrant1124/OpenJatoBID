'use strict';

const CONTENT_SNAPSHOT_FIELDS = [
  'outlineData',
  'contentGenerationSections',
  'contentGenerationPlans',
  'contentIllustrationPlan',
  'contentGenerationRuntime',
];

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function singleLine(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function titleKey(value) {
  return singleLine(value).replace(/[\s，。；：、,.!！?？()（）【】\[\]《》<>]/gu, '').toLowerCase();
}

function createServiceProxy(service, overrides = {}) {
  if (!service || typeof service !== 'object') return service;
  return new Proxy(service, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createStagedWorkspaceStore(realStore, initialState) {
  let state = cloneValue(initialState || {});
  const store = createServiceProxy(realStore, {
    loadTechnicalPlan() {
      return cloneValue(state);
    },
    updateTechnicalPlan(partial = {}) {
      state = { ...state, ...cloneValue(partial) };
      return cloneValue(state);
    },
  });
  return {
    store,
    getState: () => cloneValue(state),
  };
}

function createTerminalHoldingUpdateTask(updateTask) {
  let terminal = null;
  return {
    updateTask(partial = {}, workspaceState, eventPatch) {
      if (partial.status === 'success' || partial.status === 'error') {
        terminal = {
          partial: cloneValue(partial),
          workspaceState: cloneValue(workspaceState),
          eventPatch: cloneValue(eventPatch),
        };
        const runningPartial = {
          ...partial,
          status: 'running',
          progress: Math.min(99, Math.max(0, Number(partial.progress ?? 99) || 99)),
          pause_requested: false,
        };
        delete runningPartial.error;
        return updateTask(runningPartial, workspaceState, eventPatch);
      }
      return updateTask(partial, workspaceState, eventPatch);
    },
    getTerminal: () => cloneValue(terminal),
  };
}

function appendTaskLog({ workspaceStore, updateTask, taskField, message, progress = 99 }) {
  const state = workspaceStore.loadTechnicalPlan() || {};
  const task = state[taskField] || {};
  const logs = [...(Array.isArray(task.logs) ? task.logs : []), message];
  return updateTask({ status: 'running', progress, logs }, state);
}

function extractBalancedJson(text, startIndex = 0) {
  const source = String(text || '');
  const start = source.slice(startIndex).search(/[\[{]/u);
  if (start < 0) return '';
  const absoluteStart = startIndex + start;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = absoluteStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') stack.push('}');
    else if (character === '[') stack.push(']');
    else if (character === '}' || character === ']') {
      if (stack.pop() !== character) return '';
      if (!stack.length) return source.slice(absoluteStart, index + 1);
    }
  }
  return '';
}

function parseJsonCandidate(value) {
  if (value && typeof value === 'object') return value;
  const source = String(value || '').replace(/^\uFEFF/u, '').trim();
  const candidates = [source];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/giu.exec(source);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const balanced = extractBalancedJson(source);
  if (balanced) candidates.push(balanced);
  let lastError;
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`未返回可解析 JSON：${lastError?.message || '内容为空'}`);
}

function extractOutlinePayload(value) {
  const parsed = parseJsonCandidate(value);
  if (Array.isArray(parsed)) return { outline: parsed };
  if (Array.isArray(parsed?.outline)) return { outline: parsed.outline };
  if (Array.isArray(parsed?.result?.outline)) return { outline: parsed.result.outline };
  throw new Error('目录结果缺少 outline 数组');
}

function collectLeafItems(items, result = []) {
  for (const item of items || []) {
    if (item?.children?.length) collectLeafItems(item.children, result);
    else result.push(item);
  }
  return result;
}

function findOutlineItem(items, itemId) {
  for (const item of items || []) {
    if (String(item?.id || '') === String(itemId || '')) return item;
    const child = findOutlineItem(item?.children, itemId);
    if (child) return child;
  }
  return null;
}

function updateOutlineItemContent(items, itemId, content) {
  return (items || []).map((item) => {
    if (String(item?.id || '') === String(itemId || '')) return { ...item, content: String(content || '') };
    return item?.children?.length
      ? { ...item, children: updateOutlineItemContent(item.children, itemId, content) }
      : item;
  });
}

function parseSourceBlocks(text) {
  const result = new Map();
  const source = String(text || '');
  const pattern = /<source\s+id="([^"]+)">([\s\S]*?)<\/source>/giu;
  let match;
  while ((match = pattern.exec(source))) {
    const id = String(match[1] || '').trim();
    if (!id) continue;
    const block = match[2] || '';
    const countMatch = /字符数：\s*(\d+)/u.exec(block);
    const chars = Number(countMatch?.[1] || 0);
    const original = block.split(/原文：/u).slice(1).join('原文：').trim();
    const visible = original
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !/^#{1,6}\s+/u.test(line) && !/^(?:第[一二三四五六七八九十百千万\d]+[章节篇部分卷]|[一二三四五六七八九十]+[、.．]|\(?[一二三四五六七八九十\d]+\)?[、.．]?)\s*[^，。；：]{0,30}$/u.test(line))
      .join('');
    result.set(id, { id, chars, substantive: chars >= 80 || visible.length >= 60 });
  }
  return result;
}

function parseAssignments(value) {
  let parsed;
  try {
    parsed = parseJsonCandidate(value);
  } catch {
    return [];
  }
  const source = parsed?.result && typeof parsed.result === 'object' ? parsed.result : parsed || {};
  const assignments = Array.isArray(source) ? source : Array.isArray(source.assignments) ? source.assignments : [];
  return assignments.flatMap((assignment) => Array.isArray(assignment?.source_ids || assignment?.sourceIds)
    ? assignment.source_ids || assignment.sourceIds
    : []
  ).map((id) => String(id || '').trim()).filter(Boolean);
}

function snapshotPatch(state, fields = CONTENT_SNAPSHOT_FIELDS) {
  return Object.fromEntries(fields.map((field) => [field, cloneValue(state?.[field])]));
}

function hasSubstantiveContent(state) {
  return collectLeafItems(state?.outlineData?.outline || []).some((item) => String(item?.content || '').trim())
    || Object.values(state?.contentGenerationSections || {}).some((section) => String(section?.content || '').trim());
}

function unionPlanSourceIds(plans) {
  const ids = new Set();
  for (const storedPlan of Object.values(plans || {})) {
    const material = storedPlan?.plan?.original_material || storedPlan?.original_material || {};
    for (const id of material.source_ids || material.sourceIds || []) {
      const normalized = String(id || '').trim();
      if (normalized) ids.add(normalized);
    }
  }
  return ids;
}

module.exports = {
  appendTaskLog,
  cloneValue,
  collectLeafItems,
  createServiceProxy,
  createStagedWorkspaceStore,
  createTerminalHoldingUpdateTask,
  extractBalancedJson,
  extractOutlinePayload,
  findOutlineItem,
  hasSubstantiveContent,
  parseAssignments,
  parseJsonCandidate,
  parseSourceBlocks,
  sameValue,
  singleLine,
  snapshotPatch,
  titleKey,
  unionPlanSourceIds,
  updateOutlineItemContent,
};
