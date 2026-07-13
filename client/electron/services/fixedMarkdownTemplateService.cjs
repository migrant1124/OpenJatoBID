const crypto = require('node:crypto');

const TEMPLATE_KINDS = new Set(['locked-commitment', 'fixed-markdown-table']);
const VALUE_SOURCES = new Set(['project-info', 'part-a-info', 'company-knowledge', 'manual']);
const RECORD_FIELDS = new Set([
  'template_id',
  'kind',
  'analysis_item_id',
  'profile_id',
  'format_node_id',
  'source_title',
  'source_location',
  'template',
  'confirmed',
  'locked_hash',
  'created_at',
  'updated_at',
]);

class FixedTemplateError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'FixedTemplateError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FixedTemplateError(code, message, details);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n');
}

function requireObject(value, label) {
  if (!isPlainObject(value)) {
    fail('INVALID_TEMPLATE_STRUCTURE', `${label}必须是对象`);
  }
  return value;
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    fail('INVALID_TEMPLATE_STRUCTURE', `${label}必须是${allowEmpty ? '' : '非空'}字符串`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') {
    fail('INVALID_TEMPLATE_STRUCTURE', `${label}必须是布尔值`);
  }
  return value;
}

function ensureAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('UNKNOWN_TEMPLATE_FIELD', `${label}包含未知字段：${key}`, { field: key });
    }
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSourceLocation(value) {
  const source = requireObject(value, 'source_location');
  const allowed = new Set([
    'source_file_id',
    'source_file_name',
    'section_hint',
    'markdown_line_start',
    'markdown_line_end',
    'page_hint',
    'excerpt',
  ]);
  ensureAllowedKeys(source, allowed, 'source_location');
  const sourceFileId = requireString(source.source_file_id, 'source_location.source_file_id');
  if (!Number.isInteger(source.markdown_line_start) || source.markdown_line_start < 1) {
    fail('INVALID_TEMPLATE_STRUCTURE', 'source_location.markdown_line_start必须是正整数');
  }
  if (!Number.isInteger(source.markdown_line_end) || source.markdown_line_end < source.markdown_line_start) {
    fail('INVALID_TEMPLATE_STRUCTURE', 'source_location.markdown_line_end必须大于等于起始行');
  }
  const normalized = {
    source_file_id: sourceFileId,
    markdown_line_start: source.markdown_line_start,
    markdown_line_end: source.markdown_line_end,
  };
  for (const field of ['source_file_name', 'section_hint', 'page_hint']) {
    if (source[field] !== undefined) normalized[field] = requireString(source[field], `source_location.${field}`);
  }
  normalized.excerpt = normalizeNewlines(requireString(source.excerpt, 'source_location.excerpt'));
  return normalized;
}

function normalizeSlot(value, label) {
  const slot = requireObject(value, label);
  ensureAllowedKeys(slot, new Set(['type', 'slot_id', 'label', 'value_source', 'required']), label);
  if (slot.type !== 'slot') fail('INVALID_TEMPLATE_STRUCTURE', `${label}.type必须是slot`);
  const valueSource = requireString(slot.value_source, `${label}.value_source`);
  if (!VALUE_SOURCES.has(valueSource)) {
    fail('INVALID_TEMPLATE_STRUCTURE', `${label}.value_source无效`);
  }
  return {
    type: 'slot',
    slot_id: requireString(slot.slot_id, `${label}.slot_id`),
    label: requireString(slot.label, `${label}.label`),
    value_source: valueSource,
    required: requireBoolean(slot.required, `${label}.required`),
  };
}

function normalizeLockedCommitmentTemplate(value) {
  const template = requireObject(value, 'template');
  ensureAllowedKeys(template, new Set(['kind', 'segments']), 'template');
  if (template.kind !== 'locked-commitment') {
    fail('TEMPLATE_KIND_MISMATCH', '模板类型必须是locked-commitment');
  }
  if (!Array.isArray(template.segments) || template.segments.length === 0) {
    fail('INVALID_TEMPLATE_STRUCTURE', '固定承诺函必须包含至少一个segment');
  }
  const slotIds = new Set();
  const segments = template.segments.map((segment, index) => {
    const label = `template.segments[${index}]`;
    const item = requireObject(segment, label);
    if (item.type === 'locked') {
      ensureAllowedKeys(item, new Set(['type', 'text', 'hash']), label);
      const text = normalizeNewlines(requireString(item.text, `${label}.text`));
      return { type: 'locked', text, hash: sha256(text) };
    }
    if (item.type === 'slot') {
      const slot = normalizeSlot(item, label);
      if (slotIds.has(slot.slot_id)) {
        fail('DUPLICATE_SLOT_ID', `slot_id重复：${slot.slot_id}`, { slot_id: slot.slot_id });
      }
      slotIds.add(slot.slot_id);
      return slot;
    }
    fail('INVALID_TEMPLATE_STRUCTURE', `${label}.type无效`);
  });
  return { kind: 'locked-commitment', segments };
}

function normalizeTableCell(value, label) {
  const cell = requireObject(value, label);
  if (cell.kind === 'locked') {
    ensureAllowedKeys(cell, new Set(['kind', 'text']), label);
    return { kind: 'locked', text: normalizeNewlines(requireString(cell.text, `${label}.text`, { allowEmpty: true })) };
  }
  if (cell.kind === 'slot') {
    ensureAllowedKeys(cell, new Set(['kind', 'slot_id', 'label', 'value_source', 'required']), label);
    const valueSource = requireString(cell.value_source, `${label}.value_source`);
    if (!VALUE_SOURCES.has(valueSource)) {
      fail('INVALID_TEMPLATE_STRUCTURE', `${label}.value_source无效`);
    }
    return {
      kind: 'slot',
      slot_id: requireString(cell.slot_id, `${label}.slot_id`),
      label: requireString(cell.label, `${label}.label`),
      value_source: valueSource,
      required: requireBoolean(cell.required, `${label}.required`),
    };
  }
  fail('INVALID_TEMPLATE_STRUCTURE', `${label}.kind无效`);
}

function normalizeTableRow(value, label, columnCount) {
  const row = requireObject(value, label);
  ensureAllowedKeys(row, new Set(['row_id', 'cells']), label);
  if (!Array.isArray(row.cells) || row.cells.length !== columnCount) {
    fail('TABLE_COLUMN_COUNT_MISMATCH', `${label}的单元格数量必须等于表头列数`, {
      expected: columnCount,
      actual: Array.isArray(row.cells) ? row.cells.length : undefined,
    });
  }
  const slotIds = new Set();
  const cells = row.cells.map((cell, index) => {
    const normalized = normalizeTableCell(cell, `${label}.cells[${index}]`);
    if (normalized.kind === 'slot') {
      if (slotIds.has(normalized.slot_id)) {
        fail('DUPLICATE_SLOT_ID', `同一行slot_id重复：${normalized.slot_id}`, { slot_id: normalized.slot_id });
      }
      slotIds.add(normalized.slot_id);
    }
    return normalized;
  });
  return { row_id: requireString(row.row_id, `${label}.row_id`), cells };
}

function normalizeFixedMarkdownTableTemplate(value) {
  const template = requireObject(value, 'template');
  ensureAllowedKeys(
    template,
    new Set(['kind', 'table_title', 'headers', 'body', 'fixed_notes', 'empty_response_text']),
    'template',
  );
  if (template.kind !== 'fixed-markdown-table') {
    fail('TEMPLATE_KIND_MISMATCH', '模板类型必须是fixed-markdown-table');
  }
  if (!Array.isArray(template.headers) || template.headers.length === 0) {
    fail('INVALID_TEMPLATE_STRUCTURE', '固定表格必须包含至少一个表头');
  }
  const headers = template.headers.map((header, index) =>
    normalizeNewlines(requireString(header, `template.headers[${index}]`, { allowEmpty: true })),
  );
  if (!Array.isArray(template.body)) fail('INVALID_TEMPLATE_STRUCTURE', 'template.body必须是数组');
  if (!Array.isArray(template.fixed_notes)) fail('INVALID_TEMPLATE_STRUCTURE', 'template.fixed_notes必须是数组');

  const regionIds = new Set();
  const rowIds = new Set();
  const fixedSlotIds = new Set();
  const body = template.body.map((item, index) => {
    const label = `template.body[${index}]`;
    const bodyItem = requireObject(item, label);
    if (bodyItem.kind === 'row') {
      ensureAllowedKeys(bodyItem, new Set(['kind', 'row']), label);
      const row = normalizeTableRow(bodyItem.row, `${label}.row`, headers.length);
      if (rowIds.has(row.row_id)) fail('DUPLICATE_ROW_ID', `row_id重复：${row.row_id}`, { row_id: row.row_id });
      rowIds.add(row.row_id);
      for (const cell of row.cells) {
        if (cell.kind !== 'slot') continue;
        if (fixedSlotIds.has(cell.slot_id)) {
          fail('DUPLICATE_SLOT_ID', `固定行slot_id重复：${cell.slot_id}`, { slot_id: cell.slot_id });
        }
        fixedSlotIds.add(cell.slot_id);
      }
      return { kind: 'row', row };
    }
    if (bodyItem.kind === 'repeatable-region') {
      ensureAllowedKeys(bodyItem, new Set(['kind', 'region_id', 'row_template', 'min_rows', 'max_rows']), label);
      const regionId = requireString(bodyItem.region_id, `${label}.region_id`);
      if (regionIds.has(regionId)) fail('DUPLICATE_REGION_ID', `region_id重复：${regionId}`, { region_id: regionId });
      regionIds.add(regionId);
      const rowTemplate = normalizeTableRow(bodyItem.row_template, `${label}.row_template`, headers.length);
      if (rowIds.has(rowTemplate.row_id)) {
        fail('DUPLICATE_ROW_ID', `row_id重复：${rowTemplate.row_id}`, { row_id: rowTemplate.row_id });
      }
      rowIds.add(rowTemplate.row_id);
      if (!Number.isInteger(bodyItem.min_rows) || bodyItem.min_rows < 0) {
        fail('INVALID_REPEATABLE_ROW_LIMIT', `${label}.min_rows必须是非负整数`);
      }
      if (
        bodyItem.max_rows !== undefined &&
        (!Number.isInteger(bodyItem.max_rows) || bodyItem.max_rows < bodyItem.min_rows)
      ) {
        fail('INVALID_REPEATABLE_ROW_LIMIT', `${label}.max_rows必须是不小于min_rows的整数`);
      }
      const normalized = {
        kind: 'repeatable-region',
        region_id: regionId,
        row_template: rowTemplate,
        min_rows: bodyItem.min_rows,
      };
      if (bodyItem.max_rows !== undefined) normalized.max_rows = bodyItem.max_rows;
      return normalized;
    }
    fail('INVALID_TEMPLATE_STRUCTURE', `${label}.kind无效`);
  });

  const normalized = {
    kind: 'fixed-markdown-table',
    headers,
    body,
    fixed_notes: template.fixed_notes.map((note, index) =>
      normalizeNewlines(requireString(note, `template.fixed_notes[${index}]`)),
    ),
  };
  if (template.table_title !== undefined) {
    normalized.table_title = normalizeNewlines(requireString(template.table_title, 'template.table_title'));
  }
  if (template.empty_response_text !== undefined) {
    normalized.empty_response_text = normalizeNewlines(
      requireString(template.empty_response_text, 'template.empty_response_text'),
    );
  }
  return normalized;
}

function normalizeTemplate(value, kind) {
  if (kind === 'locked-commitment') return normalizeLockedCommitmentTemplate(value);
  if (kind === 'fixed-markdown-table') return normalizeFixedMarkdownTableTemplate(value);
  fail('INVALID_TEMPLATE_KIND', `不支持的模板类型：${kind}`);
}

function normalizeResponseTemplateRecord(value) {
  const record = requireObject(value, '模板记录');
  ensureAllowedKeys(record, RECORD_FIELDS, '模板记录');
  const kind = requireString(record.kind, 'kind');
  if (!TEMPLATE_KINDS.has(kind)) fail('INVALID_TEMPLATE_KIND', `不支持的模板类型：${kind}`);
  if (record.analysis_item_id !== 'bidDocumentFormatRequirements') {
    fail('INVALID_TEMPLATE_STRUCTURE', 'analysis_item_id必须是bidDocumentFormatRequirements');
  }
  const normalized = {
    template_id: requireString(record.template_id, 'template_id'),
    kind,
    analysis_item_id: 'bidDocumentFormatRequirements',
    profile_id: requireString(record.profile_id, 'profile_id'),
    format_node_id: requireString(record.format_node_id, 'format_node_id'),
    source_title: normalizeNewlines(requireString(record.source_title, 'source_title')),
    source_location: normalizeSourceLocation(record.source_location),
    template: normalizeTemplate(record.template, kind),
    confirmed: record.confirmed === true,
  };
  if (record.confirmed !== undefined && typeof record.confirmed !== 'boolean') {
    fail('INVALID_TEMPLATE_STRUCTURE', 'confirmed必须是布尔值');
  }
  if (record.locked_hash !== undefined) {
    if (typeof record.locked_hash !== 'string' || !/^[a-f\d]{64}$/i.test(record.locked_hash)) {
      fail('INVALID_TEMPLATE_STRUCTURE', 'locked_hash必须是SHA-256十六进制字符串');
    }
    normalized.locked_hash = record.locked_hash.toLowerCase();
  }
  for (const field of ['created_at', 'updated_at']) {
    if (record[field] !== undefined) normalized[field] = requireString(record[field], field);
  }
  return normalized;
}

function lockedHashPayload(record) {
  const normalized = normalizeResponseTemplateRecord(record);
  return {
    template_id: normalized.template_id,
    kind: normalized.kind,
    profile_id: normalized.profile_id,
    format_node_id: normalized.format_node_id,
    template: normalized.template,
  };
}

function computeLockedTemplateHash(record) {
  return sha256(stableStringify(lockedHashPayload(record)));
}

function confirmTemplate(record, correctedTemplate = undefined) {
  const normalized = normalizeResponseTemplateRecord(record);
  if (correctedTemplate !== undefined) {
    const corrected = requireObject(correctedTemplate, '修正模板');
    if (corrected.kind !== normalized.kind) {
      fail('TEMPLATE_KIND_MISMATCH', '修正模板不得改变模板类型');
    }
    normalized.template = normalizeTemplate(corrected, normalized.kind);
  }
  normalized.confirmed = true;
  delete normalized.locked_hash;
  normalized.locked_hash = computeLockedTemplateHash(normalized);
  return normalized;
}

function assertConfirmedAndLocked(record, expectedKind) {
  const normalized = normalizeResponseTemplateRecord(record);
  if (normalized.kind !== expectedKind) {
    fail('TEMPLATE_KIND_MISMATCH', `模板类型必须是${expectedKind}`);
  }
  if (!normalized.confirmed || !normalized.locked_hash) {
    fail('TEMPLATE_NOT_CONFIRMED', '该固定模板尚未确认并锁定');
  }
  const actual = computeLockedTemplateHash(normalized);
  if (actual !== normalized.locked_hash) {
    fail('LOCKED_HASH_MISMATCH', '固定模板内容校验失败，请重新核对模板', {
      expected: normalized.locked_hash,
      actual,
    });
  }
  return normalized;
}

function normalizeValueMap(value, label) {
  const map = requireObject(value, label);
  const normalized = {};
  for (const [key, item] of Object.entries(map)) {
    requireString(key, `${label}字段名`);
    if (typeof item !== 'string') fail('INVALID_TEMPLATE_VALUE', `${label}.${key}必须是字符串`);
    normalized[key] = normalizeNewlines(item);
  }
  return normalized;
}

function ensureKnownKeys(values, known, code, label) {
  for (const key of Object.keys(values)) {
    if (!known.has(key)) fail(code, `${label}包含未知字段：${key}`, { field: key });
  }
}

function responseResult(content, missingFields) {
  const missing = [...missingFields];
  return {
    content,
    missing_fields: missing,
    response_status: missing.length > 0 ? 'needs-manual-input' : 'responded-substantive',
    compliance_risk: missing.length > 0 ? 'warning' : 'none',
    ...(missing.length > 0 ? { compliance_message: '固定模板仍有必填字段未填写' } : {}),
  };
}

function renderLockedCommitment(record, slotValues, options = {}) {
  const templateRecord = assertConfirmedAndLocked(record, 'locked-commitment');
  const renderOptions = requireObject(options, 'options');
  ensureAllowedKeys(renderOptions, new Set(['knownKnowledgeIds']), 'options');
  if (renderOptions.knownKnowledgeIds !== undefined) {
    if (
      !Array.isArray(renderOptions.knownKnowledgeIds) ||
      renderOptions.knownKnowledgeIds.some((item) => typeof item !== 'string' || item.trim() === '')
    ) {
      fail('INVALID_TEMPLATE_VALUE', 'knownKnowledgeIds必须是非空字符串数组');
    }
  }
  const values = normalizeValueMap(slotValues, 'slotValues');
  const slots = templateRecord.template.segments.filter((item) => item.type === 'slot');
  const slotIds = new Set(slots.map((slot) => slot.slot_id));
  ensureKnownKeys(values, slotIds, 'UNKNOWN_SLOT_ID', 'slotValues');
  const missing = slots
    .filter((slot) => slot.required && (!Object.hasOwn(values, slot.slot_id) || values[slot.slot_id].trim() === ''))
    .map((slot) => slot.slot_id);
  const content = templateRecord.template.segments
    .map((segment) => (segment.type === 'locked' ? segment.text : values[segment.slot_id] || ''))
    .join('');
  const result = responseResult(content, missing);
  result.missing_slots = result.missing_fields;
  result.slot_values = values;
  result.knowledge_item_ids = [];
  delete result.missing_fields;
  return result;
}

function markdownCell(value) {
  return normalizeNewlines(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderTableRow(cells) {
  return `| ${cells.map(markdownCell).join(' | ')} |`;
}

function renderFixedMarkdownTable(record, input) {
  const templateRecord = assertConfirmedAndLocked(record, 'fixed-markdown-table');
  const values = requireObject(input, '表格值');
  ensureAllowedKeys(values, new Set(['cellValues', 'repeatableRows']), '表格值');
  const cellValues = normalizeValueMap(values.cellValues, 'cellValues');
  const repeatableRows = requireObject(values.repeatableRows, 'repeatableRows');

  const fixedSlots = new Map();
  const regions = new Map();
  for (const item of templateRecord.template.body) {
    if (item.kind === 'row') {
      for (const cell of item.row.cells) {
        if (cell.kind === 'slot') fixedSlots.set(cell.slot_id, cell);
      }
    } else {
      regions.set(item.region_id, item);
    }
  }
  ensureKnownKeys(cellValues, new Set(fixedSlots.keys()), 'UNKNOWN_SLOT_ID', 'cellValues');
  ensureKnownKeys(repeatableRows, new Set(regions.keys()), 'UNKNOWN_REGION_ID', 'repeatableRows');

  const normalizedRepeatableRows = {};
  const missing = [];
  for (const [slotId, slot] of fixedSlots) {
    if (slot.required && (!Object.hasOwn(cellValues, slotId) || cellValues[slotId].trim() === '')) missing.push(slotId);
  }
  for (const [regionId, region] of regions) {
    const rows = repeatableRows[regionId] === undefined ? [] : repeatableRows[regionId];
    if (!Array.isArray(rows)) fail('INVALID_TEMPLATE_VALUE', `repeatableRows.${regionId}必须是数组`);
    if (region.max_rows !== undefined && rows.length > region.max_rows) {
      fail('REPEATABLE_ROW_COUNT_EXCEEDED', `${regionId}的行数超过上限${region.max_rows}`, {
        region_id: regionId,
        actual: rows.length,
        max_rows: region.max_rows,
      });
    }
    if (rows.length < region.min_rows) {
      missing.push(`${regionId}:min_rows`);
    }
    const regionSlots = new Map(
      region.row_template.cells.filter((cell) => cell.kind === 'slot').map((cell) => [cell.slot_id, cell]),
    );
    normalizedRepeatableRows[regionId] = rows.map((row, rowIndex) => {
      const normalizedRow = normalizeValueMap(row, `repeatableRows.${regionId}[${rowIndex}]`);
      ensureKnownKeys(normalizedRow, new Set(regionSlots.keys()), 'UNKNOWN_SLOT_ID', `repeatableRows.${regionId}[${rowIndex}]`);
      for (const [slotId, slot] of regionSlots) {
        if (slot.required && (!Object.hasOwn(normalizedRow, slotId) || normalizedRow[slotId].trim() === '')) {
          missing.push(`${regionId}[${rowIndex}].${slotId}`);
        }
      }
      return normalizedRow;
    });
  }

  const lines = [];
  if (templateRecord.template.table_title) lines.push(templateRecord.template.table_title, '');
  lines.push(renderTableRow(templateRecord.template.headers));
  lines.push(renderTableRow(templateRecord.template.headers.map(() => '---')));
  for (const item of templateRecord.template.body) {
    if (item.kind === 'row') {
      lines.push(
        renderTableRow(
          item.row.cells.map((cell) => (cell.kind === 'locked' ? cell.text : cellValues[cell.slot_id] || '')),
        ),
      );
      continue;
    }
    for (const rowValues of normalizedRepeatableRows[item.region_id]) {
      lines.push(
        renderTableRow(
          item.row_template.cells.map((cell) => (cell.kind === 'locked' ? cell.text : rowValues[cell.slot_id] || '')),
        ),
      );
    }
  }
  if (templateRecord.template.fixed_notes.length > 0) {
    lines.push('', ...templateRecord.template.fixed_notes);
  }
  const result = responseResult(lines.join('\n'), missing);
  result.cell_values = cellValues;
  result.repeatable_rows = normalizedRepeatableRows;
  result.knowledge_item_ids = [];
  return result;
}

function validateRenderedLockedContent(record, renderedContent, slotValues, options = {}) {
  if (typeof renderedContent !== 'string') fail('INVALID_RENDERED_CONTENT', '受控正文必须是字符串');
  const expected = renderLockedCommitment(record, slotValues, options);
  if (renderedContent !== expected.content) {
    fail('RENDERED_CONTENT_MISMATCH', '固定承诺函正文与锁定模板不一致');
  }
  return expected;
}

function validateRenderedFixedTable(record, renderedContent, input) {
  if (typeof renderedContent !== 'string') fail('INVALID_RENDERED_CONTENT', '固定表格正文必须是字符串');
  const expected = renderFixedMarkdownTable(record, input);
  if (renderedContent !== expected.content) {
    fail('RENDERED_CONTENT_MISMATCH', '固定表格正文与锁定模板不一致');
  }
  return expected;
}

module.exports = {
  FixedTemplateError,
  normalizeResponseTemplateRecord,
  computeLockedTemplateHash,
  confirmTemplate,
  renderLockedCommitment,
  renderFixedMarkdownTable,
  validateRenderedLockedContent,
  validateRenderedFixedTable,
};
