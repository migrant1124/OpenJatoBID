const crypto = require('node:crypto');
const {
  hasSourceAnchorReference,
  resolveSourceAnchorReference,
} = require('./bidAnalysisSourceAnchors.cjs');

const FORMAT_STRENGTHS = new Set(['strict', 'fixed-roots', 'none']);
const NUMBERING_POLICIES = new Set(['auto', 'preserve-source', 'none']);
const RESPONSE_MODES = new Set([
  'freeform-markdown',
  'fixed-markdown-table',
  'locked-commitment',
  'evidence-markdown',
  'container',
  'explicit-none',
]);
const DOCUMENT_TYPES = new Set(['technical', 'quotation', 'business', 'qualification', 'other']);
const VALUE_SOURCES = new Set(['project-info', 'part-a-info', 'company-knowledge', 'manual']);
const QUOTE_MODES = new Set(['total', 'unit', 'discount-rate', 'downward-rate', 'fee-rate', 'mixed', 'not-specified']);
const LIMIT_TYPES = new Set(['budget', 'ceiling', 'unit-ceiling', 'rate-ceiling', 'other']);
const PRICING_BASES = new Set(['tax-included', 'tax-excluded', 'both', 'not-specified']);
const ROUNDING_MODES = new Set(['half-up', 'half-even', 'truncate', 'not-specified']);
const RUNTIME_HASH_KEYS = new Set(['confirmed', 'locked_hash', 'created_at', 'updated_at']);

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, '必须是对象');
  }
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) {
    fail(path, '必须是数组');
  }
  return value;
}

function string(value, path, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    fail(path, '必须是非空字符串');
  }
  return value.replace(/\r\n?/g, '\n');
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, '必须是布尔值');
  return value;
}

function integer(value, path, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(path, `必须是大于等于 ${minimum} 的整数`);
  }
  return value;
}

function enumeration(value, allowed, path) {
  if (!allowed.has(value)) fail(path, `非法枚举值 ${JSON.stringify(value)}`);
  return value;
}

function optionalString(value, path) {
  if (value === undefined || value === null || value === '') return undefined;
  return string(value, path);
}

function stringArray(value, path) {
  const seen = new Set();
  return array(value, path).map((item, index) => string(item, `${path}[${index}]`)).filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function orderedStringArray(value, path) {
  return array(value, path).map((item, index) => string(item, `${path}[${index}]`));
}

function normalizeForStableJson(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n');
  if (Array.isArray(value)) return value.map((item) => normalizeForStableJson(item, seen));
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) throw new TypeError('stableStringify 不支持循环引用');
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (RUNTIME_HASH_KEYS.has(key)) continue;
    const normalized = normalizeForStableJson(value[key], seen);
    if (normalized !== undefined) result[key] = normalized;
  }
  seen.delete(value);
  return result;
}

function stableStringify(value) {
  return JSON.stringify(normalizeForStableJson(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableSha256(value) {
  return sha256Hex(stableStringify(value));
}

function stableId(prefix, value) {
  return `${prefix}-${stableSha256(value).slice(0, 20)}`;
}

function parseRaw(raw, path) {
  if (typeof raw !== 'string') return object(raw, path);
  try {
    return object(JSON.parse(raw), path);
  } catch (error) {
    fail(path, `不是合法 JSON：${error.message}`);
  }
}

function buildWhitespaceSearchIndex(markdown) {
  const characters = [];
  const offsets = [];
  let pendingWhitespace;

  for (let offset = 0; offset < markdown.length; offset += 1) {
    const character = markdown[offset];
    if (/\s/u.test(character)) {
      if (characters.length > 0 && pendingWhitespace === undefined) {
        pendingWhitespace = offset;
      }
    } else {
      if (pendingWhitespace !== undefined) {
        characters.push(' ');
        offsets.push(pendingWhitespace);
        pendingWhitespace = undefined;
      }
      characters.push(character);
      offsets.push(offset);
    }
  }

  return { text: characters.join(''), offsets };
}

function markdownLineNumberAtOffset(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return high + 1;
}

function sourceLineHint(value) {
  if (Number.isInteger(value) && value >= 1) return value;
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
  }
  return undefined;
}

function findSourceMatches(tenderSource, excerpt) {
  const { searchIndex } = tenderSource;
  const needle = whitespaceNormalized(excerpt);
  if (!needle) return [];
  const matches = [];
  let offset = 0;
  while ((offset = searchIndex.text.indexOf(needle, offset)) !== -1) {
    const lastOffset = offset + needle.length - 1;
    const sourceOffsetStart = searchIndex.offsets[offset];
    const sourceOffsetEnd = searchIndex.offsets[lastOffset] + 1;
    matches.push({
      markdownLineStart: markdownLineNumberAtOffset(tenderSource.lineStarts, sourceOffsetStart),
      markdownLineEnd: markdownLineNumberAtOffset(tenderSource.lineStarts, sourceOffsetEnd - 1),
      sourceOffsetStart,
      sourceOffsetEnd,
    });
    offset += 1;
  }
  return matches;
}

function resolveSourceExcerpt(tenderSource, rawExcerpt, rawSource, path) {
  const excerpt = string(rawExcerpt, `${path}.excerpt`);
  let matches = findSourceMatches(tenderSource, excerpt);
  if (matches.length === 0) {
    const withoutDisplayLineNumbers = excerpt.replace(/^\s*\d+\s*\|\s?/gmu, '');
    if (withoutDisplayLineNumbers !== excerpt) {
      matches = findSourceMatches(tenderSource, withoutDisplayLineNumbers);
    }
  }
  if (matches.length === 0) {
    fail(`${path}.excerpt`, '必须能在源文件中按空白归一化后定位；不要包含输入中的“行号|”前缀');
  }

  const hintedStart = sourceLineHint(rawSource.markdown_line_start);
  const hintedEnd = sourceLineHint(rawSource.markdown_line_end);
  if (matches.length > 1 && hintedStart && hintedEnd && hintedStart <= hintedEnd) {
    const hintedMatches = matches.filter((match) => (
      match.markdownLineStart >= hintedStart && match.markdownLineEnd <= hintedEnd
    ));
    if (hintedMatches.length === 1) matches = hintedMatches;
  }
  if (matches.length !== 1) {
    fail(`${path}.excerpt`, '在源文件中存在多处匹配，且无法通过行号提示唯一定位');
  }

  const match = matches[0];
  return {
    markdownLineStart: match.markdownLineStart,
    markdownLineEnd: match.markdownLineEnd,
    excerpt: tenderSource.markdown.slice(match.sourceOffsetStart, match.sourceOffsetEnd),
  };
}

function createSourceContext(tenderSources, sourceAnchors) {
  const byId = new Map();
  array(tenderSources, 'tenderSources').forEach((rawSource, index) => {
    const source = object(rawSource, `tenderSources[${index}]`);
    const id = string(source.id, `tenderSources[${index}].id`);
    if (byId.has(id)) fail(`tenderSources[${index}].id`, 'source ID 重复');
    const markdown = typeof source.markdown === 'string' ? source.markdown.replace(/\r\n?/g, '\n') : fail(`tenderSources[${index}].markdown`, '必须是字符串');
    byId.set(id, {
      id,
      fileName: string(source.fileName, `tenderSources[${index}].fileName`),
      markdown,
      lines: markdown.split('\n'),
      lineStarts: [0, ...Array.from(markdown.matchAll(/\n/gu), (match) => match.index + 1)],
      searchIndex: buildWhitespaceSearchIndex(markdown),
    });
  });
  byId.sourceAnchors = sourceAnchors;
  return byId;
}

function whitespaceNormalized(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function normalizeSource(rawSource, sourceContext, path, { excerptRequired = true } = {}) {
  const source = object(rawSource, path);
  if (hasSourceAnchorReference(source)) {
    if (!sourceContext.sourceAnchors) fail(path, '来源锚点上下文缺失');
    const resolved = resolveSourceAnchorReference(source, sourceContext.sourceAnchors, path);
    const declaredSourceFileId = optionalString(source.source_file_id, `${path}.source_file_id`);
    if (declaredSourceFileId && declaredSourceFileId !== resolved.sourceFileId) {
      fail(`${path}.source_file_id`, '与来源锚点所属源文件不一致');
    }
    const sectionHint = optionalString(source.section_hint, `${path}.section_hint`);
    const pageHint = optionalString(source.page_hint, `${path}.page_hint`);
    return {
      source_file_id: resolved.sourceFileId,
      source_file_name: resolved.sourceFileName,
      ...(sectionHint ? { section_hint: sectionHint } : {}),
      markdown_line_start: resolved.markdownLineStart,
      markdown_line_end: resolved.markdownLineEnd,
      ...(pageHint ? { page_hint: pageHint } : {}),
      excerpt: resolved.excerpt,
    };
  }
  const sourceFileId = string(source.source_file_id, `${path}.source_file_id`);
  const tenderSource = sourceContext.get(sourceFileId);
  if (!tenderSource) fail(`${path}.source_file_id`, `未知 source ${sourceFileId}`);
  const excerpt = optionalString(source.excerpt, `${path}.excerpt`);
  if (excerptRequired && !excerpt) fail(`${path}.excerpt`, '必须是非空字符串');
  const resolvedExcerpt = excerpt ? resolveSourceExcerpt(tenderSource, excerpt, source, path) : undefined;
  const start = resolvedExcerpt?.markdownLineStart
    ?? integer(source.markdown_line_start, `${path}.markdown_line_start`, 1);
  const end = resolvedExcerpt?.markdownLineEnd
    ?? integer(source.markdown_line_end, `${path}.markdown_line_end`, 1);
  if (start > end) fail(path, 'markdown 行区间反向');
  if (end > tenderSource.lines.length) fail(path, `markdown 行区间越界，源文件共 ${tenderSource.lines.length} 行`);
  return {
    source_file_id: sourceFileId,
    source_file_name: tenderSource.fileName,
    ...(optionalString(source.section_hint, `${path}.section_hint`) ? { section_hint: optionalString(source.section_hint, `${path}.section_hint`) } : {}),
    markdown_line_start: start,
    markdown_line_end: end,
    ...(optionalString(source.page_hint, `${path}.page_hint`) ? { page_hint: optionalString(source.page_hint, `${path}.page_hint`) } : {}),
    ...(resolvedExcerpt ? { excerpt: resolvedExcerpt.excerpt } : {}),
  };
}

function comparableEvidenceText(value) {
  return String(value ?? '').replace(/\s+/gu, '');
}

function validateLockedCommitmentEvidence(template, resolvedSource, path) {
  const evidence = comparableEvidenceText(resolvedSource.canonicalEvidenceText);
  let sourceOffset = 0;
  template.segments.forEach((segment, index) => {
    const segmentPath = `${path}.template.segments[${index}]`;
    if (segment.type === 'locked') {
      const text = comparableEvidenceText(segment.text);
      if (/[_＿]/u.test(text)) fail(`${segmentPath}.text`, 'locked 片段不得吞并来源留空位，留空位必须由 slot 对应');
      if (!evidence.startsWith(text, sourceOffset)) {
        fail(`${segmentPath}.text`, 'locked 固定内容必须按原顺序逐字覆盖来源原文');
      }
      sourceOffset += text.length;
      return;
    }
    const placeholder = evidence.slice(sourceOffset).match(/^[_＿]+/u)?.[0];
    if (!placeholder) fail(segmentPath, 'slot 必须与来源中同一位置的明确留空标记一一对应');
    sourceOffset += placeholder.length;
  });
  if (sourceOffset !== evidence.length) {
    fail(`${path}.template.segments`, '模板必须完整覆盖来源原文，且每个明确留空位都必须由同一位置的 slot 对应');
  }
}

function markdownTableCells(rawText) {
  const line = String(rawText || '').trim();
  if (!line.includes('|') || (!line.startsWith('|') && !line.endsWith('|') && (line.match(/\|/gu) || []).length < 2)) return undefined;
  const cells = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\\' && line[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (line[index] === '|') {
      cells.push(current);
      current = '';
    } else {
      current += line[index];
    }
  }
  cells.push(current);
  if (line.startsWith('|')) cells.shift();
  if (line.endsWith('|')) cells.pop();
  const normalized = cells.map((cell) => cell.trim());
  if (normalized.length < 2 || normalized.every((cell) => /^:?-{3,}:?$/u.test(cell))) return undefined;
  return normalized;
}

function tableCellsFromAnchor(anchor) {
  if (Array.isArray(anchor.tableCells)) return anchor.tableCells;
  if (anchor.kind === 'markdown-line') return markdownTableCells(anchor.rawText);
  return undefined;
}

function sourceTableRowsFromAnchors(anchors) {
  const rows = [];
  let activeSpans = [];
  for (const anchor of anchors) {
    if (!Array.isArray(anchor.tableCellSpans)) {
      activeSpans = [];
      const cells = tableCellsFromAnchor(anchor);
      if (cells) rows.push(cells);
      continue;
    }
    const row = [];
    const nextSpans = [];
    let columnIndex = 0;
    const consumeActiveSpan = () => {
      const span = activeSpans[columnIndex];
      if (!span) return false;
      row[columnIndex] = span.text;
      if (span.rowsLeft > 1) nextSpans[columnIndex] = { text: span.text, rowsLeft: span.rowsLeft - 1 };
      columnIndex += 1;
      return true;
    };
    for (const cell of anchor.tableCellSpans) {
      while (activeSpans[columnIndex]) consumeActiveSpan();
      for (let spanColumn = 0; spanColumn < cell.colspan; spanColumn += 1) {
        while (activeSpans[columnIndex]) consumeActiveSpan();
        row[columnIndex] = cell.text;
        if (cell.rowspan > 1) nextSpans[columnIndex] = { text: cell.text, rowsLeft: cell.rowspan - 1 };
        columnIndex += 1;
      }
    }
    while (columnIndex < activeSpans.length) {
      if (!consumeActiveSpan()) columnIndex += 1;
    }
    rows.push(Array.from({ length: row.length }, (_item, index) => row[index] || ''));
    activeSpans = nextSpans;
  }
  return rows;
}

function tableCellMatches(templateCell, sourceCell) {
  const sourceValue = comparableEvidenceText(sourceCell);
  if (templateCell.kind === 'locked') {
    const lockedValue = comparableEvidenceText(templateCell.text);
    return !/[_＿]/u.test(lockedValue) && lockedValue === sourceValue;
  }
  return sourceValue === '' || /^[_＿]+$/u.test(sourceValue);
}

function tableRowMatches(templateRow, sourceRow) {
  return templateRow.cells.length === sourceRow.length
    && templateRow.cells.every((cell, index) => tableCellMatches(cell, sourceRow[index]));
}

function tableBodyMatches(templateBody, sourceRows, templateIndex = 0, sourceIndex = 0) {
  if (templateIndex === templateBody.length) return sourceIndex === sourceRows.length;
  const item = templateBody[templateIndex];
  const row = item.kind === 'row' ? item.row : item.row_template;
  if (item.kind === 'row') {
    return sourceIndex < sourceRows.length
      && tableRowMatches(row, sourceRows[sourceIndex])
      && tableBodyMatches(templateBody, sourceRows, templateIndex + 1, sourceIndex + 1);
  }
  let maximumSourceIndex = sourceIndex;
  while (maximumSourceIndex < sourceRows.length && tableRowMatches(row, sourceRows[maximumSourceIndex])) {
    maximumSourceIndex += 1;
  }
  const minimumMatches = row.cells.some((cell) => cell.kind === 'locked') ? 1 : 0;
  for (let nextSourceIndex = maximumSourceIndex; nextSourceIndex >= sourceIndex + minimumMatches; nextSourceIndex -= 1) {
    if (tableBodyMatches(templateBody, sourceRows, templateIndex + 1, nextSourceIndex)) return true;
  }
  return false;
}

function validateFixedTableEvidence(template, resolvedSource, path) {
  const sourceRows = sourceTableRowsFromAnchors(resolvedSource.anchors);
  const headerIndex = sourceRows.findIndex((row) => row.length === template.headers.length
    && template.headers.every((header, index) => comparableEvidenceText(header) === comparableEvidenceText(row[index])));
  if (headerIndex < 0) fail(`${path}.template.headers`, '固定表头必须按来源列顺序逐格一致');
  const noteValues = new Set([
    ...template.fixed_notes,
    ...(template.empty_response_text ? [template.empty_response_text] : []),
  ].map(comparableEvidenceText));
  const bodyRows = sourceRows.slice(headerIndex + 1).filter((row) => {
    const cellValues = row.map(comparableEvidenceText).filter(Boolean);
    return !noteValues.has(comparableEvidenceText(row.join('')))
      && !(cellValues.length > 0 && new Set(cellValues).size === 1 && noteValues.has(cellValues[0]));
  });
  if (!tableBodyMatches(template.body, bodyRows)) {
    fail(`${path}.template.body`, '固定表格 body 必须按来源行列逐格对应，slot 只能占据空单元格或明确留空标记');
  }
  const evidence = comparableEvidenceText(resolvedSource.canonicalEvidenceText);
  const orderedValues = [
    ...(template.table_title ? [{ value: template.table_title, path: `${path}.template.table_title` }] : []),
    ...template.fixed_notes.map((value, index) => ({ value, path: `${path}.template.fixed_notes[${index}]` })),
  ];
  let searchOffset = 0;
  for (const item of orderedValues) {
    const value = comparableEvidenceText(item.value);
    const matchOffset = evidence.indexOf(value, searchOffset);
    if (matchOffset < 0) fail(item.path, '固定内容必须按原顺序逐字来自 source_location 引用的来源锚点');
    searchOffset = matchOffset + value.length;
  }
  if (template.empty_response_text && !evidence.includes(comparableEvidenceText(template.empty_response_text))) {
    fail(`${path}.template.empty_response_text`, '固定内容必须逐字来自 source_location 引用的来源锚点');
  }
}

function validateTemplateEvidence(template, rawSourceLocation, sourceContext, path) {
  if (!hasSourceAnchorReference(rawSourceLocation)) return;
  const resolvedSource = resolveSourceAnchorReference(
    rawSourceLocation,
    sourceContext.sourceAnchors,
    `${path}.source_location`,
  );
  if (template.kind === 'locked-commitment') validateLockedCommitmentEvidence(template, resolvedSource, path);
  else validateFixedTableEvidence(template, resolvedSource, path);
}

function normalizeScope(rawScope, path, requiredDocumentType) {
  const scope = object(rawScope, path);
  const documentType = enumeration(scope.document_type, DOCUMENT_TYPES, `${path}.document_type`);
  if (requiredDocumentType && documentType !== requiredDocumentType) {
    fail(`${path}.document_type`, `必须为 ${requiredDocumentType}`);
  }
  const sectionId = optionalString(scope.section_id, `${path}.section_id`);
  const sectionTitle = optionalString(scope.section_title, `${path}.section_title`);
  return {
    ...(sectionId ? { section_id: sectionId } : {}),
    ...(sectionTitle ? { section_title: sectionTitle } : {}),
    package_ids: stringArray(scope.package_ids, `${path}.package_ids`),
    package_names: stringArray(scope.package_names, `${path}.package_names`),
    document_type: documentType,
  };
}

function isGlobalScope(scope) {
  return !scope.section_id && !scope.section_title && scope.package_ids.length === 0 && scope.package_names.length === 0;
}

function normalizeFormatNode(rawNode, context, path, parentStableId) {
  const node = object(rawNode, path);
  if (Object.prototype.hasOwnProperty.call(node, 'optional_omit')) fail(`${path}.optional_omit`, '不允许 optional_omit');
  const rawNodeId = optionalString(node.format_node_id ?? node.node_id, `${path}.format_node_id`);
  const sourceNumber = optionalString(node.source_number, `${path}.source_number`);
  const sourceTitle = string(node.source_title, `${path}.source_title`);
  const numberingPolicy = enumeration(node.numbering_policy, NUMBERING_POLICIES, `${path}.numbering_policy`);
  if (numberingPolicy === 'preserve-source' && !sourceNumber) fail(`${path}.source_number`, 'preserve-source 节点必须有源编号');
  if (sourceNumber && sourceTitle.trim().startsWith(sourceNumber.trim())) fail(`${path}.source_title`, '不得包含 source_number 前缀');
  const responseMode = enumeration(node.response_mode, RESPONSE_MODES, `${path}.response_mode`);
  const source = normalizeSource(node.source, context.sourceContext, `${path}.source`);
  const formatNodeId = stableId('format-node', {
    profile_id: context.profileId,
    parent_id: parentStableId || null,
    source_number: sourceNumber || null,
    source_title: sourceTitle,
    source,
  });
  if (context.stableNodeIds.has(formatNodeId)) fail(path, '格式节点稳定 ID 冲突');
  context.stableNodeIds.add(formatNodeId);
  if (rawNodeId) {
    if (context.nodeIdMap.has(rawNodeId)) fail(`${path}.format_node_id`, '格式节点 ID 重复');
    context.nodeIdMap.set(rawNodeId, formatNodeId);
  }
  const children = array(node.children, `${path}.children`).map((child, index) => (
    normalizeFormatNode(child, context, `${path}.children[${index}]`, formatNodeId)
  ));
  if (responseMode === 'container' && children.length === 0) fail(path, 'container 节点必须有子节点');
  const templateRawId = optionalString(node.template_id, `${path}.template_id`);
  if ((responseMode === 'locked-commitment' || responseMode === 'fixed-markdown-table') && !templateRawId) {
    fail(`${path}.template_id`, `${responseMode} 节点必须有模板`);
  }
  if (templateRawId && responseMode !== 'locked-commitment' && responseMode !== 'fixed-markdown-table') {
    fail(`${path}.template_id`, '只有固定响应节点可以引用模板');
  }
  let requiredInOutline = boolean(node.required_in_outline, `${path}.required_in_outline`);
  let responseRequired = boolean(node.response_required, `${path}.response_required`);
  if (/如有/u.test(sourceTitle) || /^(其他|其它)(?:$|[（(：:])/u.test(sourceTitle.trim())) {
    requiredInOutline = true;
    responseRequired = true;
  }
  const normalized = {
    format_node_id: formatNodeId,
    ...(sourceNumber ? { source_number: sourceNumber } : {}),
    source_title: sourceTitle,
    ...(optionalString(node.description, `${path}.description`) ? { description: optionalString(node.description, `${path}.description`) } : {}),
    required_in_outline: requiredInOutline,
    response_required: responseRequired,
    title_locked: boolean(node.title_locked, `${path}.title_locked`),
    order_locked: boolean(node.order_locked, `${path}.order_locked`),
    level_locked: boolean(node.level_locked, `${path}.level_locked`),
    numbering_policy: numberingPolicy,
    response_mode: responseMode,
    allow_ai_children: boolean(node.allow_ai_children, `${path}.allow_ai_children`),
    ...(templateRawId ? { template_id: templateRawId } : {}),
    ...(optionalString(node.empty_response_text, `${path}.empty_response_text`) ? { empty_response_text: optionalString(node.empty_response_text, `${path}.empty_response_text`) } : {}),
    ...(node.missing_evidence_risk !== undefined ? {
      missing_evidence_risk: enumeration(node.missing_evidence_risk, new Set(['high', 'potential-rejection']), `${path}.missing_evidence_risk`),
    } : responseMode === 'evidence-markdown' ? { missing_evidence_risk: 'high' } : {}),
    children,
    source,
  };
  if (templateRawId) context.templateNodes.push({ node: normalized, rawTemplateId: templateRawId, rawNodeId, profileRawId: context.profileRawId });
  return normalized;
}

function normalizeLockedTemplate(rawTemplate, path) {
  const template = object(rawTemplate, path);
  if (template.kind !== 'locked-commitment') fail(`${path}.kind`, '必须为 locked-commitment');
  const slotIds = new Set();
  let lockedCount = 0;
  const segments = array(template.segments, `${path}.segments`).map((rawSegment, index) => {
    const segmentPath = `${path}.segments[${index}]`;
    const segment = object(rawSegment, segmentPath);
    if (segment.type === 'locked') {
      lockedCount += 1;
      return { type: 'locked', text: string(segment.text, `${segmentPath}.text`) };
    }
    if (segment.type !== 'slot') fail(`${segmentPath}.type`, '必须为 locked 或 slot');
    const slotId = string(segment.slot_id, `${segmentPath}.slot_id`);
    if (slotIds.has(slotId)) fail(`${segmentPath}.slot_id`, 'slot ID 重复');
    slotIds.add(slotId);
    return {
      type: 'slot',
      slot_id: slotId,
      label: string(segment.label, `${segmentPath}.label`),
      value_source: enumeration(segment.value_source, VALUE_SOURCES, `${segmentPath}.value_source`),
      required: boolean(segment.required, `${segmentPath}.required`),
    };
  });
  if (segments.length === 0 || lockedCount === 0) fail(`${path}.segments`, '必须包含非空 locked 片段');
  return { kind: 'locked-commitment', segments };
}

function normalizeTableCell(rawCell, path, slotIds) {
  const cell = object(rawCell, path);
  if (cell.kind === 'locked') return { kind: 'locked', text: string(cell.text, `${path}.text`) };
  if (cell.kind !== 'slot') fail(`${path}.kind`, '必须为 locked 或 slot');
  const slotId = string(cell.slot_id, `${path}.slot_id`);
  if (slotIds.has(slotId)) fail(`${path}.slot_id`, '表格 slot ID 重复');
  slotIds.add(slotId);
  return {
    kind: 'slot',
    slot_id: slotId,
    label: string(cell.label, `${path}.label`),
    value_source: enumeration(cell.value_source, VALUE_SOURCES, `${path}.value_source`),
    required: boolean(cell.required, `${path}.required`),
  };
}

function normalizeTableRow(rawRow, path, columnCount, slotIds, stableRowSeed) {
  const row = object(rawRow, path);
  const cells = array(row.cells, `${path}.cells`).map((cell, index) => normalizeTableCell(cell, `${path}.cells[${index}]`, slotIds));
  if (cells.length !== columnCount) fail(`${path}.cells`, `列数必须为 ${columnCount}`);
  return { row_id: stableId('table-row', { seed: stableRowSeed, cells }), cells };
}

function normalizeTableTemplate(rawTemplate, path, templateId) {
  const template = object(rawTemplate, path);
  if (template.kind !== 'fixed-markdown-table') fail(`${path}.kind`, '必须为 fixed-markdown-table');
  const headers = orderedStringArray(template.headers, `${path}.headers`);
  if (headers.length === 0) fail(`${path}.headers`, '表头不能为空');
  const body = array(template.body, `${path}.body`);
  if (body.length === 0) fail(`${path}.body`, '有序表体不能为空');
  const regionIds = new Set();
  const slotIds = new Set();
  const normalizedBody = body.map((rawItem, index) => {
    const itemPath = `${path}.body[${index}]`;
    const item = object(rawItem, itemPath);
    if (item.kind === 'row') {
      return {
        kind: 'row',
        row: normalizeTableRow(item.row, `${itemPath}.row`, headers.length, slotIds, `${templateId}:row:${index}`),
      };
    }
    if (item.kind !== 'repeatable-region') fail(`${itemPath}.kind`, '必须为 row 或 repeatable-region');
    const rawRegionId = string(item.region_id, `${itemPath}.region_id`);
    const regionId = stableId('table-region', { template_id: templateId, raw_region_id: rawRegionId });
    if (regionIds.has(regionId)) fail(`${itemPath}.region_id`, 'region ID 重复');
    regionIds.add(regionId);
    const minRows = integer(item.min_rows, `${itemPath}.min_rows`, 0);
    const maxRows = item.max_rows === undefined ? undefined : integer(item.max_rows, `${itemPath}.max_rows`, 0);
    if (maxRows !== undefined && maxRows < minRows) fail(itemPath, 'max_rows 不得小于 min_rows');
    return {
      kind: 'repeatable-region',
      region_id: regionId,
      row_template: normalizeTableRow(item.row_template, `${itemPath}.row_template`, headers.length, slotIds, `${templateId}:region:${rawRegionId}`),
      min_rows: minRows,
      ...(maxRows !== undefined ? { max_rows: maxRows } : {}),
    };
  });
  return {
    kind: 'fixed-markdown-table',
    ...(optionalString(template.table_title, `${path}.table_title`) ? { table_title: optionalString(template.table_title, `${path}.table_title`) } : {}),
    headers,
    body: normalizedBody,
    fixed_notes: orderedStringArray(template.fixed_notes, `${path}.fixed_notes`),
    ...(optionalString(template.empty_response_text, `${path}.empty_response_text`) ? { empty_response_text: optionalString(template.empty_response_text, `${path}.empty_response_text`) } : {}),
  };
}

function normalizeResponseTemplates(rawTemplates, templateNodes, profileIdMap, nodeIdMap, sourceContext) {
  const byRawId = new Map();
  array(rawTemplates, 'templates').forEach((rawTemplate, index) => {
    const template = object(rawTemplate, `templates[${index}]`);
    const rawTemplateId = string(template.template_id, `templates[${index}].template_id`);
    if (byRawId.has(rawTemplateId)) fail(`templates[${index}].template_id`, '模板 ID 重复');
    byRawId.set(rawTemplateId, { raw: template, path: `templates[${index}]` });
  });
  if (byRawId.size !== templateNodes.length) fail('templates', '模板与固定响应节点必须一一匹配');
  const used = new Set();
  const stableTemplateIdMap = new Map();
  const normalized = templateNodes.map((reference) => {
    const entry = byRawId.get(reference.rawTemplateId);
    if (!entry || used.has(reference.rawTemplateId)) fail('templates', '模板与固定响应节点必须一一匹配');
    used.add(reference.rawTemplateId);
    const { raw, path } = entry;
    const kind = enumeration(raw.kind, new Set(['locked-commitment', 'fixed-markdown-table']), `${path}.kind`);
    if (kind !== reference.node.response_mode) fail(`${path}.kind`, '模板类型与节点 response_mode 不一致');
    const rawProfileId = string(raw.profile_id, `${path}.profile_id`);
    if (reference.profileRawId && rawProfileId !== reference.profileRawId) fail(`${path}.profile_id`, '模板 profile 与节点不一致');
    const profileId = profileIdMap.get(rawProfileId);
    if (!profileId) fail(`${path}.profile_id`, '模板引用未知 profile');
    const rawNodeId = string(raw.format_node_id, `${path}.format_node_id`);
    if (!reference.rawNodeId || rawNodeId !== reference.rawNodeId || nodeIdMap.get(rawNodeId) !== reference.node.format_node_id) {
      fail(`${path}.format_node_id`, '模板节点引用不一致');
    }
    const sourceTitle = string(raw.source_title, `${path}.source_title`);
    if (sourceTitle !== reference.node.source_title) fail(`${path}.source_title`, '模板标题与引用节点 source_title 不一致');
    const sourceLocation = normalizeSource(raw.source_location, sourceContext, `${path}.source_location`);
    const templateId = stableId('response-template', {
      profile_id: profileId,
      format_node_id: reference.node.format_node_id,
      kind,
      source_location: sourceLocation,
    });
    if ([...stableTemplateIdMap.values()].includes(templateId)) fail(`${path}.template_id`, '模板稳定 ID 冲突');
    stableTemplateIdMap.set(reference.rawTemplateId, templateId);
    reference.node.template_id = templateId;
    const normalizedTemplate = kind === 'locked-commitment'
      ? normalizeLockedTemplate(raw.template, `${path}.template`)
      : normalizeTableTemplate(raw.template, `${path}.template`, templateId);
    validateTemplateEvidence(normalizedTemplate, raw.source_location, sourceContext, path);
    return {
      template_id: templateId,
      kind,
      analysis_item_id: 'bidDocumentFormatRequirements',
      profile_id: profileId,
      format_node_id: reference.node.format_node_id,
      source_title: reference.node.source_title,
      source_location: sourceLocation,
      template: normalizedTemplate,
      confirmed: false,
    };
  });
  return { normalized, stableTemplateIdMap };
}

function remapTemplateIdArray(rawIds, map, path) {
  const seen = new Set();
  return array(rawIds, path).map((id, index) => {
    const rawId = string(id, `${path}[${index}]`);
    const stable = map.get(rawId);
    if (!stable) fail(`${path}[${index}]`, '引用未知模板');
    if (seen.has(stable)) fail(`${path}[${index}]`, '模板 ID 重复');
    seen.add(stable);
    return stable;
  });
}

function validateLockedFormatNode(node, path) {
  if (!node.title_locked || !node.order_locked || !node.level_locked || node.numbering_policy === 'auto') {
    fail(path, '固定格式节点必须锁定标题、顺序、层级和编号策略');
  }
}

function validateProfileRootRules(profile, path) {
  if (profile.format_strength === 'strict') {
    const visit = (nodes, nodesPath) => nodes.forEach((node, index) => {
      const nodePath = `${nodesPath}[${index}]`;
      validateLockedFormatNode(node, nodePath);
      visit(node.children, `${nodePath}.children`);
    });
    visit(profile.outline, `${path}.outline`);
  } else if (profile.format_strength === 'fixed-roots') {
    profile.outline.forEach((node, index) => validateLockedFormatNode(node, `${path}.outline[${index}]`));
  }
}

function normalizeBidDocumentFormatRequirements(rawInput, tenderSources, sourceAnchors) {
  const raw = parseRaw(rawInput, 'formatAnalysis');
  let rawResult;
  let rawTemplates;
  if (raw.result !== undefined) {
    rawResult = object(raw.result, 'formatAnalysis.result');
    rawTemplates = raw.templates;
  } else {
    const { templates, ...result } = raw;
    rawResult = result;
    rawTemplates = templates;
  }
  if (rawResult.schema_version !== 1) fail('result.schema_version', '必须为 1');
  const sourceContext = createSourceContext(tenderSources, sourceAnchors);
  const hasExplicit = boolean(rawResult.has_explicit_technical_format, 'result.has_explicit_technical_format');
  const profileIdMap = new Map();
  const nodeIdMap = new Map();
  const stableNodeIds = new Set();
  const templateNodes = [];
  const profiles = array(rawResult.profiles, 'result.profiles').map((rawProfile, index) => {
    const path = `result.profiles[${index}]`;
    const profile = object(rawProfile, path);
    const rawProfileId = string(profile.profile_id, `${path}.profile_id`);
    if (profileIdMap.has(rawProfileId)) fail(`${path}.profile_id`, 'profile ID 重复');
    const applicableScope = normalizeScope(profile.applicable_scope, `${path}.applicable_scope`, 'technical');
    const formatStrength = enumeration(profile.format_strength, FORMAT_STRENGTHS, `${path}.format_strength`);
    const documentTitle = string(profile.document_title, `${path}.document_title`);
    const profileId = stableId('technical-profile', { applicable_scope: applicableScope, document_title: documentTitle });
    if ([...profileIdMap.values()].includes(profileId)) fail(`${path}.profile_id`, 'profile 稳定 ID 冲突');
    profileIdMap.set(rawProfileId, profileId);
    const context = { sourceContext, profileId, profileRawId: rawProfileId, nodeIdMap, stableNodeIds, templateNodes };
    const outline = array(profile.outline, `${path}.outline`).map((node, nodeIndex) => normalizeFormatNode(node, context, `${path}.outline[${nodeIndex}]`));
    if (formatStrength === 'none' && outline.length !== 0) fail(`${path}.outline`, 'none profile 的 outline 必须为空');
    if (formatStrength !== 'none' && outline.length === 0) fail(`${path}.outline`, `${formatStrength} profile 的 outline 不能为空`);
    const normalizedProfile = { profile_id: profileId, applicable_scope: applicableScope, format_strength: formatStrength, document_title: documentTitle, outline };
    validateProfileRootRules(normalizedProfile, path);
    return normalizedProfile;
  });
  if (!hasExplicit) {
    if (profiles.length !== 1 || profiles[0].format_strength !== 'none' || !isGlobalScope(profiles[0].applicable_scope)) {
      fail('result.profiles', '无明确格式时必须且只能返回一个全局 technical/none profile');
    }
  } else {
    if (profiles.length === 0 || !profiles.some((profile) => profile.format_strength === 'strict' || profile.format_strength === 'fixed-roots')) {
      fail('result.profiles', '明确格式时至少需要一个 strict 或 fixed-roots profile');
    }
    if (profiles.some((profile) => profile.format_strength === 'none' && isGlobalScope(profile.applicable_scope))) {
      fail('result.profiles', '明确格式时 none profile 必须绑定明确标段、标包或包件范围，不能使用全局回退');
    }
  }
  const { normalized: templates, stableTemplateIdMap } = normalizeResponseTemplates(
    rawTemplates,
    templateNodes,
    profileIdMap,
    nodeIdMap,
    sourceContext,
  );
  const templateIds = remapTemplateIdArray(rawResult.template_ids, stableTemplateIdMap, 'result.template_ids');
  if (templateIds.length !== templates.length) fail('result.template_ids', '必须完整列出所有模板');
  const rules = object(rawResult.other_format_rules, 'result.other_format_rules');
  const result = {
    schema_version: 1,
    has_explicit_technical_format: hasExplicit,
    profiles,
    template_ids: templateIds,
    other_format_rules: {
      signature_and_seal: stringArray(rules.signature_and_seal, 'result.other_format_rules.signature_and_seal'),
      file_and_upload: stringArray(rules.file_and_upload, 'result.other_format_rules.file_and_upload'),
      typesetting: stringArray(rules.typesetting, 'result.other_format_rules.typesetting'),
      required_template_ids: remapTemplateIdArray(rules.required_template_ids, stableTemplateIdMap, 'result.other_format_rules.required_template_ids'),
    },
    sources: array(rawResult.sources, 'result.sources').map((source, index) => normalizeSource(
      source,
      sourceContext,
      `result.sources[${index}]`,
      { excerptRequired: hasExplicit },
    )),
  };
  const normalizedHash = stableSha256({ result, templates });
  return { result, templates, normalized_hash: normalizedHash };
}

function normalizeSourcedRule(rawRule, sourceContext, path, profileId, category) {
  const rule = object(rawRule, path);
  const title = string(rule.title, `${path}.title`);
  const content = string(rule.content, `${path}.content`);
  const source = normalizeSource(rule.source, sourceContext, `${path}.source`);
  return {
    rule_id: stableId('quote-rule', { profile_id: profileId, category, title, content, source }),
    title,
    content,
    source,
  };
}

function normalizeRuleArray(value, sourceContext, path, profileId, category) {
  const ids = new Set();
  return array(value, path).map((rule, index) => {
    const normalized = normalizeSourcedRule(rule, sourceContext, `${path}[${index}]`, profileId, category);
    if (ids.has(normalized.rule_id)) fail(`${path}[${index}]`, '报价规则稳定 ID 冲突');
    ids.add(normalized.rule_id);
    return normalized;
  });
}

function normalizeQuotationRequirements(rawInput, tenderSources) {
  const parsed = parseRaw(rawInput, 'quotationRequirements');
  const raw = parsed.result === undefined
    ? parsed
    : object(parsed.result, 'quotationRequirements.result');
  if (raw.schema_version !== 1) fail('quotationRequirements.schema_version', '必须为 1');
  const sourceContext = createSourceContext(tenderSources);
  const hasExplicit = boolean(raw.has_explicit_quotation_requirements, 'quotationRequirements.has_explicit_quotation_requirements');
  const profileIds = new Set();
  const profiles = array(raw.profiles, 'quotationRequirements.profiles').map((rawProfile, index) => {
    const path = `quotationRequirements.profiles[${index}]`;
    const profile = object(rawProfile, path);
    string(profile.profile_id, `${path}.profile_id`);
    const applicableScope = normalizeScope(profile.applicable_scope, `${path}.applicable_scope`);
    const quoteMode = enumeration(profile.quote_mode, QUOTE_MODES, `${path}.quote_mode`);
    const currency = string(profile.currency, `${path}.currency`);
    const profileId = stableId('quotation-profile', { applicable_scope: applicableScope, quote_mode: quoteMode, currency });
    if (profileIds.has(profileId)) fail(`${path}.profile_id`, '报价 profile 稳定 ID 冲突');
    profileIds.add(profileId);
    const limits = array(profile.limits, `${path}.limits`).map((rawLimit, limitIndex) => {
      const limitPath = `${path}.limits[${limitIndex}]`;
      const limit = object(rawLimit, limitPath);
      const limitType = enumeration(limit.limit_type, LIMIT_TYPES, `${limitPath}.limit_type`);
      const limitScope = normalizeScope(limit.applicable_scope, `${limitPath}.applicable_scope`);
      const amountOrRate = string(limit.amount_or_rate, `${limitPath}.amount_or_rate`);
      const limitCurrency = string(limit.currency, `${limitPath}.currency`);
      const source = normalizeSource(limit.source, sourceContext, `${limitPath}.source`);
      return {
        limit_id: stableId('quote-limit', { profile_id: profileId, limit_type: limitType, applicable_scope: limitScope, amount_or_rate: amountOrRate, currency: limitCurrency, source }),
        limit_type: limitType,
        applicable_scope: limitScope,
        amount_or_rate: amountOrRate,
        currency: limitCurrency,
        ...(limit.tax_included === undefined ? {} : { tax_included: boolean(limit.tax_included, `${limitPath}.tax_included`) }),
        source,
      };
    });
    const tax = object(profile.tax, `${path}.tax`);
    const precision = object(profile.precision_and_rounding, `${path}.precision_and_rounding`);
    const formulas = array(profile.formulas, `${path}.formulas`).map((rawFormula, formulaIndex) => {
      const formulaPath = `${path}.formulas[${formulaIndex}]`;
      const formula = object(rawFormula, formulaPath);
      const expression = string(formula.expression, `${formulaPath}.expression`);
      const variablesObject = object(formula.variables, `${formulaPath}.variables`);
      const variables = {};
      for (const key of Object.keys(variablesObject).sort()) variables[string(key, `${formulaPath}.variables key`)] = string(variablesObject[key], `${formulaPath}.variables.${key}`);
      const source = normalizeSource(formula.source, sourceContext, `${formulaPath}.source`);
      return { formula_id: stableId('quote-formula', { profile_id: profileId, expression, variables, source }), expression, variables, source };
    });
    const requiredForms = array(profile.required_forms, `${path}.required_forms`).map((rawForm, formIndex) => {
      const formPath = `${path}.required_forms[${formIndex}]`;
      const form = object(rawForm, formPath);
      const name = string(form.name, `${formPath}.name`);
      const fileFormats = stringArray(form.file_formats, `${formPath}.file_formats`);
      const source = normalizeSource(form.source, sourceContext, `${formPath}.source`);
      return {
        form_id: stableId('quote-form', { profile_id: profileId, name, file_formats: fileFormats, source }),
        name,
        required: boolean(form.required, `${formPath}.required`),
        file_formats: fileFormats,
        ...(optionalString(form.submission_channel, `${formPath}.submission_channel`) ? { submission_channel: optionalString(form.submission_channel, `${formPath}.submission_channel`) } : {}),
        source,
      };
    });
    const normalizeRules = (field) => normalizeRuleArray(profile[field], sourceContext, `${path}.${field}`, profileId, field);
    return {
      profile_id: profileId,
      applicable_scope: applicableScope,
      quote_mode: quoteMode,
      currency,
      limits,
      tax: {
        pricing_basis: enumeration(tax.pricing_basis, PRICING_BASES, `${path}.tax.pricing_basis`),
        vat_rates: stringArray(tax.vat_rates, `${path}.tax.vat_rates`),
        invoice_types: stringArray(tax.invoice_types, `${path}.tax.invoice_types`),
        rules: normalizeRuleArray(tax.rules, sourceContext, `${path}.tax.rules`, profileId, 'tax'),
      },
      price_composition: normalizeRules('price_composition'),
      precision_and_rounding: {
        ...(precision.decimal_places === undefined ? {} : { decimal_places: integer(precision.decimal_places, `${path}.precision_and_rounding.decimal_places`, 0) }),
        ...(precision.rounding_mode === undefined ? {} : { rounding_mode: enumeration(precision.rounding_mode, ROUNDING_MODES, `${path}.precision_and_rounding.rounding_mode`) }),
        rules: normalizeRuleArray(precision.rules, sourceContext, `${path}.precision_and_rounding.rules`, profileId, 'precision_and_rounding'),
      },
      formulas,
      required_forms: requiredForms,
      submission_rules: normalizeRules('submission_rules'),
      consistency_rules: normalizeRules('consistency_rules'),
      precedence_rules: normalizeRules('precedence_rules'),
      prohibited_pricing_statements: normalizeRules('prohibited_pricing_statements'),
      invalid_bid_triggers: normalizeRules('invalid_bid_triggers'),
      abnormally_low_price_review: normalizeRules('abnormally_low_price_review'),
      settlement_and_payment: normalizeRules('settlement_and_payment'),
      external_dependencies: normalizeRules('external_dependencies'),
      sources: array(profile.sources, `${path}.sources`).map((source, sourceIndex) => normalizeSource(source, sourceContext, `${path}.sources[${sourceIndex}]`)),
    };
  });
  if (!hasExplicit) {
    if (profiles.length !== 1 || profiles[0].quote_mode !== 'not-specified' || !isGlobalScope(profiles[0].applicable_scope)) {
      fail('quotationRequirements.profiles', '无明确报价要求时必须且只能返回一个全局 not-specified profile');
    }
  } else if (profiles.length === 0) {
    fail('quotationRequirements.profiles', '明确报价要求时至少需要一个 profile');
  }
  const result = {
    schema_version: 1,
    has_explicit_quotation_requirements: hasExplicit,
    profiles,
    sources: array(raw.sources, 'quotationRequirements.sources').map((source, index) => normalizeSource(
      source,
      sourceContext,
      `quotationRequirements.sources[${index}]`,
      { excerptRequired: hasExplicit },
    )),
  };
  return { result, normalized_hash: stableSha256(result) };
}

module.exports = {
  stableStringify,
  sha256Hex,
  stableSha256,
  normalizeBidDocumentFormatRequirements,
  normalizeQuotationRequirements,
};
