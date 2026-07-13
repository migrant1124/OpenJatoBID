const crypto = require('node:crypto');
const cheerio = require('cheerio');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
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

function evidenceFromFragment(rawText, kind) {
  if (/<\/?[a-z][^>]*>/iu.test(rawText)) {
    const $ = cheerio.load(rawText, null, false);
    if (kind === 'html-table-row') {
      const tableCellSpans = $('tr').first().children('th,td').map((_index, element) => ({
        text: normalizeWhitespace($(element).text()),
        rowspan: Math.max(1, Number.parseInt($(element).attr('rowspan') || '1', 10) || 1),
        colspan: Math.max(1, Number.parseInt($(element).attr('colspan') || '1', 10) || 1),
      })).get();
      const tableCells = tableCellSpans.map((cell) => cell.text);
      if (tableCells.length) {
        return {
          visibleText: tableCells.map((cell) => cell || '[空白]').join(' | '),
          canonicalText: tableCells.map((cell) => cell || '＿').join(''),
          tableCells,
          tableCellSpans,
        };
      }
    }
    const canonicalText = normalizeWhitespace($.root().text());
    const headingLevel = rawText.match(/^\s*<h([1-6])\b/iu)?.[1];
    return {
      visibleText: headingLevel && canonicalText ? `${'#'.repeat(Number(headingLevel))} ${canonicalText}` : canonicalText,
      canonicalText,
    };
  }
  const linkedText = rawText
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
  return {
    visibleText: normalizeWhitespace(linkedText.replace(/^\s{0,3}```\w*\s*/u, '')),
    canonicalText: normalizeWhitespace(linkedText.replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s*|```\w*\s*)/u, '')),
  };
}

function createAnchor(source, lineStarts, sourceOffsetStart, sourceOffsetEnd, kind) {
  const rawText = source.markdown.slice(sourceOffsetStart, sourceOffsetEnd);
  const { visibleText, canonicalText, tableCells, tableCellSpans } = evidenceFromFragment(rawText, kind);
  if (!visibleText && !tableCells?.length) return undefined;
  const idSeed = `${source.id}\u0000${sourceOffsetStart}\u0000${sourceOffsetEnd}\u0000${rawText}`;
  return {
    id: `source-anchor-${crypto.createHash('sha256').update(idSeed, 'utf8').digest('hex').slice(0, 20)}`,
    sourceFileId: source.id,
    sourceFileName: source.fileName,
    sourceOffsetStart,
    sourceOffsetEnd,
    markdownLineStart: markdownLineNumberAtOffset(lineStarts, sourceOffsetStart),
    markdownLineEnd: markdownLineNumberAtOffset(lineStarts, Math.max(sourceOffsetStart, sourceOffsetEnd - 1)),
    kind,
    rawText,
    visibleText,
    canonicalText,
    ...(tableCells ? { tableCells } : {}),
    ...(tableCellSpans ? { tableCellSpans } : {}),
  };
}

function hashAnchorCatalog(anchors) {
  const stableEntries = anchors.map((anchor) => ({
    id: anchor.id,
    sourceFileId: anchor.sourceFileId,
    sourceOffsetStart: anchor.sourceOffsetStart,
    sourceOffsetEnd: anchor.sourceOffsetEnd,
    kind: anchor.kind,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(stableEntries), 'utf8').digest('hex');
}

function makeReadOnlyMap(map, label) {
  for (const method of ['set', 'delete', 'clear']) {
    Object.defineProperty(map, method, {
      value() {
        throw new Error(`${label} is immutable`);
      },
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(map);
}

function freezeAnchorCatalog(catalog) {
  for (const anchor of catalog.anchors) Object.freeze(anchor);
  for (const source of catalog.sourcesById.values()) {
    Object.freeze(source.lineStarts);
    Object.freeze(source);
  }
  Object.freeze(catalog.anchors);
  makeReadOnlyMap(catalog.byId, 'AnchorCatalog.byId');
  makeReadOnlyMap(catalog.sourcesById, 'AnchorCatalog.sourcesById');
  return Object.freeze(catalog);
}

function appendPlainAnchors(anchors, source, lineStarts, rangeStart, rangeEnd) {
  const text = source.markdown.slice(rangeStart, rangeEnd);
  for (const match of text.matchAll(/[^\n]+/gu)) {
    const rawLine = match[0];
    const leadingLength = rawLine.length - rawLine.trimStart().length;
    const trailingLength = rawLine.length - rawLine.trimEnd().length;
    const start = rangeStart + match.index + leadingLength;
    const end = rangeStart + match.index + rawLine.length - trailingLength;
    if (start >= end) continue;
    const kind = /<\/?[a-z][^>]*>/iu.test(source.markdown.slice(start, end)) ? 'html-fragment' : 'markdown-line';
    const anchor = createAnchor(source, lineStarts, start, end, kind);
    if (anchor) anchors.push(anchor);
  }
}

function buildBidAnalysisSourceAnchors(tenderSources) {
  if (!Array.isArray(tenderSources)) throw new Error('tenderSources 必须是数组');
  const anchors = [];
  const sourcesById = new Map();

  tenderSources.forEach((rawSource, index) => {
    if (!rawSource || typeof rawSource !== 'object') throw new Error(`tenderSources[${index}] 必须是对象`);
    const id = String(rawSource.id || '').trim();
    const fileName = String(rawSource.fileName || '').trim();
    if (!id) throw new Error(`tenderSources[${index}].id 必须是非空字符串`);
    if (!fileName) throw new Error(`tenderSources[${index}].fileName 必须是非空字符串`);
    if (sourcesById.has(id)) throw new Error(`tenderSources[${index}].id source ID 重复`);
    if (typeof rawSource.markdown !== 'string') throw new Error(`tenderSources[${index}].markdown 必须是字符串`);
    const source = { id, fileName, markdown: rawSource.markdown.replace(/\r\n?/g, '\n') };
    const lineStarts = [0, ...Array.from(source.markdown.matchAll(/\n/gu), (match) => match.index + 1)];
    sourcesById.set(id, { ...source, lineStarts });

    const tableRows = Array.from(source.markdown.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/giu), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
      kind: 'html-table-row',
    }));
    const htmlBlocks = Array.from(source.markdown.matchAll(/<(h[1-6]|p|li)\b[^>]*>[\s\S]*?<\/\1\s*>/giu), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
      kind: 'html-fragment',
    })).filter((block) => !tableRows.some((row) => block.start < row.end && block.end > row.start));
    const semanticFragments = [...tableRows, ...htmlBlocks].sort((left, right) => left.start - right.start);
    let cursor = 0;
    for (const fragment of semanticFragments) {
      appendPlainAnchors(anchors, source, lineStarts, cursor, fragment.start);
      const anchor = createAnchor(source, lineStarts, fragment.start, fragment.end, fragment.kind);
      if (anchor) anchors.push(anchor);
      cursor = fragment.end;
    }
    appendPlainAnchors(anchors, source, lineStarts, cursor, source.markdown.length);
  });

  anchors.sort((left, right) => {
    const sourceOrder = tenderSources.findIndex((source) => String(source.id) === left.sourceFileId)
      - tenderSources.findIndex((source) => String(source.id) === right.sourceFileId);
    return sourceOrder || left.sourceOffsetStart - right.sourceOffsetStart;
  });
  const byId = new Map();
  for (const anchor of anchors) {
    if (byId.has(anchor.id)) throw new Error(`来源锚点 ID 冲突：${anchor.id}`);
    byId.set(anchor.id, anchor);
  }
  return freezeAnchorCatalog({
    anchors,
    byId,
    sourcesById,
    anchor_catalog_hash: hashAnchorCatalog(anchors),
  });
}

function buildSourceAnchorContext(sourceAnchors) {
  const lines = [];
  let currentSourceId;
  for (const anchor of sourceAnchors.anchors) {
    if (anchor.sourceFileId !== currentSourceId) {
      if (lines.length) lines.push('');
      lines.push(`=== source_file_id: ${anchor.sourceFileId}`);
      lines.push(`=== source_file_name: ${anchor.sourceFileName}`);
      currentSourceId = anchor.sourceFileId;
    }
    const lineRange = anchor.markdownLineStart === anchor.markdownLineEnd
      ? String(anchor.markdownLineStart)
      : `${anchor.markdownLineStart}-${anchor.markdownLineEnd}`;
    lines.push(`[${anchor.id}] [${anchor.kind}] [source_line:${lineRange}] ${anchor.visibleText}`);
  }
  return lines.join('\n');
}

function hasSourceAnchorReference(rawSource) {
  return Boolean(rawSource && typeof rawSource === 'object'
    && (rawSource.anchor_id !== undefined || rawSource.anchor_ids !== undefined));
}

function resolveSourceAnchorReference(rawSource, sourceAnchors, path = 'source') {
  if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
    throw new Error(`${path}: 必须是对象`);
  }
  const rawAnchorIds = rawSource.anchor_ids !== undefined ? rawSource.anchor_ids : [rawSource.anchor_id];
  if (!Array.isArray(rawAnchorIds) || rawAnchorIds.length === 0) {
    throw new Error(`${path}.anchor_ids: 必须是非空数组`);
  }
  const seen = new Set();
  const anchors = rawAnchorIds.map((rawId, index) => {
    if (typeof rawId !== 'string' || !rawId.trim()) throw new Error(`${path}.anchor_ids[${index}]: 必须是非空字符串`);
    const id = rawId.trim();
    if (seen.has(id)) throw new Error(`${path}.anchor_ids[${index}]: 锚点 ID 重复`);
    seen.add(id);
    const anchor = sourceAnchors.byId.get(id);
    if (!anchor) throw new Error(`${path}.anchor_ids[${index}]: 未知来源锚点 ${id}`);
    return anchor;
  }).sort((left, right) => left.sourceOffsetStart - right.sourceOffsetStart);
  const sourceFileId = anchors[0].sourceFileId;
  if (anchors.some((anchor) => anchor.sourceFileId !== sourceFileId)) {
    throw new Error(`${path}.anchor_ids: 一组来源锚点必须属于同一源文件`);
  }
  const sourceAnchorOrder = sourceAnchors.anchors.filter((anchor) => anchor.sourceFileId === sourceFileId);
  const selectedIndexes = anchors.map((anchor) => sourceAnchorOrder.findIndex((item) => item.id === anchor.id));
  if (selectedIndexes.some((index, position) => position > 0 && index !== selectedIndexes[position - 1] + 1)) {
    throw new Error(`${path}.anchor_ids: 多个来源锚点必须在同一源文件中连续`);
  }
  const source = sourceAnchors.sourcesById.get(sourceFileId);
  const sourceOffsetStart = anchors[0].sourceOffsetStart;
  const sourceOffsetEnd = anchors[anchors.length - 1].sourceOffsetEnd;
  return {
    sourceFileId,
    sourceFileName: source.fileName,
    markdownLineStart: markdownLineNumberAtOffset(source.lineStarts, sourceOffsetStart),
    markdownLineEnd: markdownLineNumberAtOffset(source.lineStarts, Math.max(sourceOffsetStart, sourceOffsetEnd - 1)),
    excerpt: source.markdown.slice(sourceOffsetStart, sourceOffsetEnd),
    evidenceText: anchors.map((anchor) => anchor.visibleText).join('\n'),
    canonicalEvidenceText: anchors.map((anchor) => anchor.canonicalText).join(''),
    anchors,
  };
}

module.exports = {
  buildBidAnalysisSourceAnchors,
  buildSourceAnchorContext,
  hasSourceAnchorReference,
  hashAnchorCatalog,
  normalizeWhitespace,
  resolveSourceAnchorReference,
};
