const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FixedTemplateError,
  normalizeResponseTemplateRecord,
  computeLockedTemplateHash,
  confirmTemplate,
  renderLockedCommitment,
  renderFixedMarkdownTable,
  validateRenderedLockedContent,
  validateRenderedFixedTable,
} = require('./fixedMarkdownTemplateService.cjs');

function sourceLocation() {
  return {
    source_file_id: 'tender-1',
    source_file_name: '招标文件.md',
    markdown_line_start: 10,
    markdown_line_end: 20,
    excerpt: '我方郑重承诺。',
  };
}

function lockedRecord(overrides = {}) {
  return {
    template_id: 'tpl-commitment',
    kind: 'locked-commitment',
    analysis_item_id: 'bidDocumentFormatRequirements',
    profile_id: 'profile-1',
    format_node_id: 'node-commitment',
    source_title: '服务承诺函',
    source_location: sourceLocation(),
    template: {
      kind: 'locked-commitment',
      segments: [
        { type: 'locked', text: '致：采购人\r\n我方承诺：' },
        {
          type: 'slot',
          slot_id: 'company',
          label: '公司名称',
          value_source: 'company-knowledge',
          required: true,
        },
        { type: 'locked', text: '，严格履行第一条；第二条。' },
        {
          type: 'slot',
          slot_id: 'date',
          label: '日期',
          value_source: 'manual',
          required: false,
        },
      ],
    },
    confirmed: false,
    ...overrides,
  };
}

function tableRecord(overrides = {}) {
  return {
    template_id: 'tpl-table',
    kind: 'fixed-markdown-table',
    analysis_item_id: 'bidDocumentFormatRequirements',
    profile_id: 'profile-1',
    format_node_id: 'node-table',
    source_title: '偏差表',
    source_location: sourceLocation(),
    template: {
      kind: 'fixed-markdown-table',
      table_title: '技术偏差表',
      headers: ['序号', '内容', '说明'],
      body: [
        {
          kind: 'row',
          row: {
            row_id: 'lead',
            cells: [
              { kind: 'locked', text: '固定' },
              {
                kind: 'slot',
                slot_id: 'owner',
                label: '响应人',
                value_source: 'project-info',
                required: true,
              },
              { kind: 'locked', text: '完全响应。' },
            ],
          },
        },
        {
          kind: 'repeatable-region',
          region_id: 'main-items',
          row_template: {
            row_id: 'main-row',
            cells: [
              {
                kind: 'slot',
                slot_id: 'index',
                label: '序号',
                value_source: 'manual',
                required: true,
              },
              {
                kind: 'slot',
                slot_id: 'description',
                label: '内容',
                value_source: 'manual',
                required: true,
              },
              { kind: 'locked', text: '主项' },
            ],
          },
          min_rows: 0,
          max_rows: 2,
        },
        {
          kind: 'row',
          row: {
            row_id: 'subtotal',
            cells: [
              { kind: 'locked', text: '小计' },
              {
                kind: 'slot',
                slot_id: 'total',
                label: '小计内容',
                value_source: 'manual',
                required: false,
              },
              { kind: 'locked', text: '以上无偏差' },
            ],
          },
        },
        {
          kind: 'repeatable-region',
          region_id: 'extra-items',
          row_template: {
            row_id: 'extra-row',
            cells: [
              {
                kind: 'slot',
                slot_id: 'extra-index',
                label: '附加序号',
                value_source: 'manual',
                required: false,
              },
              {
                kind: 'slot',
                slot_id: 'extra-description',
                label: '附加内容',
                value_source: 'manual',
                required: false,
              },
              { kind: 'locked', text: '附加项' },
            ],
          },
          min_rows: 0,
          max_rows: 1,
        },
        {
          kind: 'row',
          row: {
            row_id: 'tail',
            cells: [
              { kind: 'locked', text: '签章' },
              {
                kind: 'slot',
                slot_id: 'seal',
                label: '签章人',
                value_source: 'manual',
                required: false,
              },
              { kind: 'locked', text: '必须保留！' },
            ],
          },
        },
      ],
      fixed_notes: ['注：表头、列顺序及本说明不得修改。', '尾注二。'],
      empty_response_text: '无偏差。',
    },
    confirmed: false,
    ...overrides,
  };
}

function assertCode(code, fn) {
  assert.throws(fn, (error) => error instanceof FixedTemplateError && error.code === code);
}

test('固定承诺函只规范化换行并锁定标点、条款顺序与稳定Hash', () => {
  const first = confirmTemplate(lockedRecord({ created_at: '2026-07-13T00:00:00.000Z' }));
  const second = confirmTemplate({
    ...lockedRecord({ created_at: '2026-07-13T00:00:00.000Z' }),
    source_location: {
      excerpt: '我方郑重承诺。',
      markdown_line_end: 20,
      source_file_id: 'tender-1',
      markdown_line_start: 10,
      source_file_name: '招标文件.md',
    },
  });
  assert.equal(first.template.segments[0].text, '致：采购人\n我方承诺：');
  assert.match(first.template.segments[0].hash, /^[a-f\d]{64}$/);
  assert.equal(first.locked_hash, second.locked_hash);
  assert.equal(computeLockedTemplateHash(first), first.locked_hash);

  const rendered = renderLockedCommitment(first, { company: '甲公司', date: '2026年7月13日' });
  assert.equal(rendered.content, '致：采购人\n我方承诺：甲公司，严格履行第一条；第二条。2026年7月13日');
  assert.equal(rendered.response_status, 'responded-substantive');
  assert.deepEqual(rendered.missing_slots, []);
  assert.equal(validateRenderedLockedContent(first, rendered.content, { company: '甲公司', date: '2026年7月13日' }).content, rendered.content);
});

test('固定承诺函缺少必填slot返回待人工，不接受未知slot或伪造完整正文', () => {
  const confirmed = confirmTemplate(lockedRecord());
  const missing = renderLockedCommitment(confirmed, { date: '' });
  assert.equal(missing.response_status, 'needs-manual-input');
  assert.equal(missing.compliance_risk, 'warning');
  assert.deepEqual(missing.missing_slots, ['company']);
  assertCode('UNKNOWN_SLOT_ID', () => renderLockedCommitment(confirmed, { company: '甲', body: '伪造全文' }));
  assertCode('UNKNOWN_TEMPLATE_FIELD', () =>
    renderLockedCommitment(confirmed, { company: '甲' }, { body: '伪造全文' }),
  );
  assertCode('RENDERED_CONTENT_MISMATCH', () =>
    validateRenderedLockedContent(confirmed, `${missing.content}篡改`, { date: '' }),
  );
});

test('确认只接受同kind合法结构，重复确认保持确定性', () => {
  const record = lockedRecord();
  const once = confirmTemplate(record);
  const twice = confirmTemplate(once, once.template);
  assert.deepEqual(twice, once);
  assertCode('TEMPLATE_KIND_MISMATCH', () =>
    confirmTemplate(record, {
      kind: 'fixed-markdown-table',
      headers: ['A'],
      body: [],
      fixed_notes: [],
    }),
  );
});

test('未确认模板、Hash变化及固定正文变化均被拒绝', () => {
  assertCode('TEMPLATE_NOT_CONFIRMED', () => renderLockedCommitment(lockedRecord(), { company: '甲' }));
  const confirmed = confirmTemplate(lockedRecord());
  const changed = structuredClone(confirmed);
  changed.template.segments[2].text = '，严格履行第二条；第一条。';
  assertCode('LOCKED_HASH_MISMATCH', () => renderLockedCommitment(changed, { company: '甲' }));

  const corrected = confirmTemplate(confirmed, changed.template);
  assert.notEqual(corrected.locked_hash, confirmed.locked_hash);
  assert.match(renderLockedCommitment(corrected, { company: '甲' }).content, /第二条；第一条/);
});

test('固定表格按有序body插入多个重复区并保留固定尾行与尾注', () => {
  const confirmed = confirmTemplate(tableRecord());
  const input = {
    cellValues: { owner: '甲公司', total: '共一项', seal: '张三' },
    repeatableRows: {
      'main-items': [{ index: '1', description: '完全响应|含竖线' }],
      'extra-items': [{ 'extra-index': '附1', 'extra-description': '附加响应' }],
    },
  };
  const rendered = renderFixedMarkdownTable(confirmed, input);
  const expected = [
    '技术偏差表',
    '',
    '| 序号 | 内容 | 说明 |',
    '| --- | --- | --- |',
    '| 固定 | 甲公司 | 完全响应。 |',
    '| 1 | 完全响应\\|含竖线 | 主项 |',
    '| 小计 | 共一项 | 以上无偏差 |',
    '| 附1 | 附加响应 | 附加项 |',
    '| 签章 | 张三 | 必须保留！ |',
    '',
    '注：表头、列顺序及本说明不得修改。',
    '尾注二。',
  ].join('\n');
  assert.equal(rendered.content, expected);
  assert.equal(rendered.response_status, 'responded-substantive');
  assert.equal(validateRenderedFixedTable(confirmed, expected, input).content, expected);
});

test('固定表格0行和空响应仍生成完整表格，不改写为empty_response_text', () => {
  const confirmed = confirmTemplate(tableRecord());
  const rendered = renderFixedMarkdownTable(confirmed, {
    cellValues: { owner: '甲公司' },
    repeatableRows: {},
  });
  assert.match(rendered.content, /\| 序号 \| 内容 \| 说明 \|/);
  assert.match(rendered.content, /\| 小计 \|  \| 以上无偏差 \|/);
  assert.match(rendered.content, /\| 签章 \|  \| 必须保留！ \|/);
  assert.match(rendered.content, /尾注二。$/);
  assert.doesNotMatch(rendered.content, /^无偏差。$/);
});

test('固定表格缺必填值或最小行数返回待人工，超过最大行数拒绝', () => {
  const requiredRowRecord = tableRecord({
    template: {
      ...tableRecord().template,
      body: tableRecord().template.body.map((item) =>
        item.kind === 'repeatable-region' && item.region_id === 'main-items' ? { ...item, min_rows: 1 } : item,
      ),
    },
  });
  const confirmed = confirmTemplate(requiredRowRecord);
  const missing = renderFixedMarkdownTable(confirmed, { cellValues: {}, repeatableRows: {} });
  assert.equal(missing.response_status, 'needs-manual-input');
  assert.deepEqual(missing.missing_fields.sort(), ['main-items:min_rows', 'owner'].sort());

  const tooMany = [
    { index: '1', description: '一' },
    { index: '2', description: '二' },
    { index: '3', description: '三' },
  ];
  assertCode('REPEATABLE_ROW_COUNT_EXCEEDED', () =>
    renderFixedMarkdownTable(confirmed, {
      cellValues: { owner: '甲' },
      repeatableRows: { 'main-items': tooMany },
    }),
  );
});

test('固定表格拒绝未知slot、未知region、额外cell和Renderer完整body', () => {
  const confirmed = confirmTemplate(tableRecord());
  assertCode('UNKNOWN_SLOT_ID', () =>
    renderFixedMarkdownTable(confirmed, {
      cellValues: { owner: '甲', unexpected: '额外单元格' },
      repeatableRows: {},
    }),
  );
  assertCode('UNKNOWN_REGION_ID', () =>
    renderFixedMarkdownTable(confirmed, {
      cellValues: { owner: '甲' },
      repeatableRows: { unknown: [] },
    }),
  );
  assertCode('UNKNOWN_SLOT_ID', () =>
    renderFixedMarkdownTable(confirmed, {
      cellValues: { owner: '甲' },
      repeatableRows: { 'main-items': [{ index: '1', description: '响应', locked: '篡改固定格' }] },
    }),
  );
  assertCode('UNKNOWN_TEMPLATE_FIELD', () =>
    renderFixedMarkdownTable(confirmed, {
      cellValues: { owner: '甲' },
      repeatableRows: {},
      body: '| 伪造 | 全文 |',
    }),
  );
});

test('固定表格严格校验列数、region唯一和固定结构Hash', () => {
  const wrongColumns = tableRecord();
  wrongColumns.template.body[0].row.cells.pop();
  assertCode('TABLE_COLUMN_COUNT_MISMATCH', () => normalizeResponseTemplateRecord(wrongColumns));

  const duplicateRegion = tableRecord();
  duplicateRegion.template.body.splice(2, 0, structuredClone(duplicateRegion.template.body[1]));
  assertCode('DUPLICATE_REGION_ID', () => confirmTemplate(duplicateRegion));

  const confirmed = confirmTemplate(tableRecord());
  const changed = structuredClone(confirmed);
  changed.template.headers[0] = '编号';
  assertCode('LOCKED_HASH_MISMATCH', () =>
    renderFixedMarkdownTable(changed, { cellValues: { owner: '甲' }, repeatableRows: {} }),
  );
  const rendered = renderFixedMarkdownTable(confirmed, { cellValues: { owner: '甲' }, repeatableRows: {} });
  assertCode('RENDERED_CONTENT_MISMATCH', () =>
    validateRenderedFixedTable(confirmed, rendered.content.replace('完全响应。', '部分响应。'), {
      cellValues: { owner: '甲' },
      repeatableRows: {},
    }),
  );
});

test('固定表格最大行数边界与相同输入重复渲染稳定', () => {
  const confirmed = confirmTemplate(tableRecord());
  const input = {
    cellValues: { owner: '甲' },
    repeatableRows: {
      'main-items': [
        { index: '1', description: '一' },
        { index: '2', description: '二' },
      ],
    },
  };
  const first = renderFixedMarkdownTable(confirmed, input);
  const second = renderFixedMarkdownTable(confirmed, input);
  assert.deepEqual(second, first);
});
