const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBidDocumentFormatRequirements,
  normalizeQuotationRequirements,
  sha256Hex,
  stableSha256,
  stableStringify,
} = require('./bidAnalysisResultSchemas.cjs');
const { buildBidAnalysisSourceAnchors } = require('./bidAnalysisSourceAnchors.cjs');

const tenderSources = [{
  id: 'tender-main',
  fileName: '招标文件.md',
  markdown: [
    '技术文件采用下列固定目录。',
    '一、投标承诺函：我方完全响应本项目全部要求。',
    '二、技术偏差表应保留固定表头。',
    '三、其他（如有）也必须保留。',
    '标包二可按技术评分项自拟目录。',
    '报价方式为总价与单价混合报价。',
    '最高限价为人民币100万元。',
    '报价均为含税价，税率按现行规定执行。',
    '报价保留两位小数，四舍五入。',
    '报价公式：总价等于单价乘以数量。',
    '必须上传报价表 PDF 和 Excel。',
    '平台报价与报价表不一致时以平台报价为准。',
    '未发现其他明确要求。',
  ].join('\n'),
}];

function source(line, excerpt = tenderSources[0].markdown.split('\n')[line - 1]) {
  return {
    source_file_id: 'tender-main',
    markdown_line_start: line,
    markdown_line_end: line,
    excerpt,
  };
}

function formatNode(overrides = {}) {
  return {
    format_node_id: 'node-commitment',
    source_number: '一、',
    source_title: '投标承诺函',
    required_in_outline: true,
    response_required: true,
    title_locked: true,
    order_locked: true,
    level_locked: true,
    numbering_policy: 'preserve-source',
    response_mode: 'locked-commitment',
    allow_ai_children: false,
    template_id: 'template-commitment',
    children: [],
    source: source(2),
    ...overrides,
  };
}

function formatFixture() {
  return {
    result: {
      schema_version: 1,
      has_explicit_technical_format: true,
      profiles: [{
        profile_id: 'profile-package-1',
        applicable_scope: {
          section_id: 'section-1',
          section_title: '一标段',
          package_ids: ['package-1', 'package-1'],
          package_names: ['包一', '包一'],
          document_type: 'technical',
        },
        format_strength: 'strict',
        document_title: '技术文件',
        outline: [
          formatNode(),
          formatNode({
            format_node_id: 'node-table',
            source_number: '二、',
            source_title: '技术偏差表',
            response_mode: 'fixed-markdown-table',
            template_id: 'template-table',
            source: source(3),
          }),
          formatNode({
            format_node_id: 'node-other',
            source_number: '三、',
            source_title: '其他（如有）',
            required_in_outline: false,
            response_required: false,
            numbering_policy: 'preserve-source',
            response_mode: 'explicit-none',
            template_id: undefined,
            source: source(4),
          }),
        ],
      }],
      template_ids: ['template-commitment', 'template-table'],
      other_format_rules: {
        signature_and_seal: ['承诺函须签章'],
        file_and_upload: [],
        typesetting: [],
        required_template_ids: ['template-commitment', 'template-table'],
      },
      sources: [source(1)],
    },
    templates: [{
      template_id: 'template-commitment',
      kind: 'locked-commitment',
      profile_id: 'profile-package-1',
      format_node_id: 'node-commitment',
      source_title: '投标承诺函',
      source_location: source(2),
      template: {
        kind: 'locked-commitment',
        segments: [
          { type: 'locked', text: '一、投标承诺函：我方完全响应本项目全部要求。' },
          { type: 'slot', slot_id: 'bidder', label: '投标人', value_source: 'company-knowledge', required: true },
        ],
      },
    }, {
      template_id: 'template-table',
      kind: 'fixed-markdown-table',
      profile_id: 'profile-package-1',
      format_node_id: 'node-table',
      source_title: '技术偏差表',
      source_location: source(3),
      template: {
        kind: 'fixed-markdown-table',
        table_title: '技术偏差表',
        headers: ['序号', '条款', '响应'],
        body: [
          {
            kind: 'row',
            row: {
              row_id: 'fixed-head',
              cells: [
                { kind: 'locked', text: '1' },
                { kind: 'locked', text: '固定条款' },
                { kind: 'slot', slot_id: 'fixed-response', label: '响应', value_source: 'manual', required: true },
              ],
            },
          },
          {
            kind: 'repeatable-region',
            region_id: 'deviations',
            row_template: {
              row_id: 'deviation-row',
              cells: [
                { kind: 'slot', slot_id: 'sequence', label: '序号', value_source: 'manual', required: true },
                { kind: 'slot', slot_id: 'clause', label: '条款', value_source: 'manual', required: true },
                { kind: 'slot', slot_id: 'response', label: '响应', value_source: 'manual', required: true },
              ],
            },
            min_rows: 0,
            max_rows: 10,
          },
        ],
        fixed_notes: ['无偏差时填写“无偏差”。'],
        empty_response_text: '无偏差',
      },
    }],
  };
}

function quoteRule(line, title = '规则') {
  return { rule_id: 'ignored-by-normalizer', title, content: source(line).excerpt, source: source(line) };
}

function quoteProfile(overrides = {}) {
  return {
    profile_id: 'quote-profile-1',
    applicable_scope: {
      section_id: 'section-1',
      section_title: '一标段',
      package_ids: ['package-1'],
      package_names: ['包一'],
      document_type: 'quotation',
    },
    quote_mode: 'mixed',
    currency: 'CNY',
    limits: [{
      limit_id: 'limit-raw',
      limit_type: 'ceiling',
      applicable_scope: {
        package_ids: ['package-1'],
        package_names: ['包一'],
        document_type: 'quotation',
      },
      amount_or_rate: '100万元',
      currency: 'CNY',
      tax_included: true,
      source: source(7),
    }],
    tax: {
      pricing_basis: 'tax-included',
      vat_rates: ['现行税率'],
      invoice_types: ['增值税专用发票'],
      rules: [quoteRule(8, '税务规则')],
    },
    price_composition: [quoteRule(6, '价格组成')],
    precision_and_rounding: {
      decimal_places: 2,
      rounding_mode: 'half-up',
      rules: [quoteRule(9, '精度规则')],
    },
    formulas: [{ formula_id: 'formula-raw', expression: '总价=单价×数量', variables: { 单价: '报价单价', 数量: '报价数量' }, source: source(10) }],
    required_forms: [{ form_id: 'form-raw', name: '报价表', required: true, file_formats: ['PDF', 'Excel'], submission_channel: '采购平台', source: source(11) }],
    submission_rules: [quoteRule(11, '提交规则')],
    consistency_rules: [quoteRule(12, '一致性规则')],
    precedence_rules: [quoteRule(12, '优先级规则')],
    prohibited_pricing_statements: [quoteRule(7, '禁止超限价')],
    invalid_bid_triggers: [quoteRule(7, '超限价无效')],
    abnormally_low_price_review: [quoteRule(6, '异常低价审查')],
    settlement_and_payment: [quoteRule(6, '结算规则')],
    external_dependencies: [quoteRule(11, '外部附件')],
    sources: [source(6)],
    ...overrides,
  };
}

function quotationFixture() {
  return {
    schema_version: 1,
    has_explicit_quotation_requirements: true,
    profiles: [quoteProfile()],
    sources: [source(6)],
  };
}

function clone(value) {
  return structuredClone(value);
}

test('stableStringify sorts keys, normalizes CRLF, and excludes runtime fields', () => {
  assert.equal(stableStringify({ z: 'a\r\nb', confirmed: true, a: { updated_at: 'now', x: 1 } }), '{"a":{"x":1},"z":"a\\nb"}');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(stableSha256({ b: 2, a: 1 }), stableSha256({ a: 1, b: 2 }));
});

test('normalizes strict format, stable IDs, ordered table body, and mandatory 如有/其他 response', () => {
  const first = normalizeBidDocumentFormatRequirements(formatFixture(), tenderSources);
  const second = normalizeBidDocumentFormatRequirements(formatFixture(), tenderSources);
  assert.deepEqual(first, second);
  assert.match(first.result.profiles[0].profile_id, /^technical-profile-/);
  assert.deepEqual(first.result.profiles[0].applicable_scope.package_ids, ['package-1']);
  assert.equal(first.result.profiles[0].outline[2].required_in_outline, true);
  assert.equal(first.result.profiles[0].outline[2].response_required, true);
  assert.deepEqual(first.templates[1].template.body.map((item) => item.kind), ['row', 'repeatable-region']);
  assert.equal(first.templates.every((template) => template.confirmed === false), true);
  assert.deepEqual(first.result.template_ids, first.templates.map((template) => template.template_id));
});

test('accepts fixed-roots, an explicit scoped none profile, and multiple packages', () => {
  const fixture = formatFixture();
  fixture.result.profiles[0].format_strength = 'fixed-roots';
  fixture.result.profiles.push({
    profile_id: 'profile-package-2',
    applicable_scope: { package_ids: ['package-2'], package_names: ['包二'], document_type: 'technical' },
    format_strength: 'none',
    document_title: '包二技术文件',
    outline: [],
  });
  const normalized = normalizeBidDocumentFormatRequirements(fixture, tenderSources);
  assert.deepEqual(normalized.result.profiles.map((profile) => profile.format_strength), ['fixed-roots', 'none']);
});

test('accepts the sole global none profile for a negative format result', () => {
  const fixture = {
    schema_version: 1,
    has_explicit_technical_format: false,
    profiles: [{
      profile_id: 'none',
      applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
      format_strength: 'none',
      document_title: '技术文件',
      outline: [],
    }],
    template_ids: [],
    other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: [] },
    sources: [{ ...source(13), excerpt: undefined }],
    templates: [],
  };
  assert.equal(normalizeBidDocumentFormatRequirements(fixture, tenderSources).result.profiles[0].format_strength, 'none');

  const invalidRange = clone(fixture);
  invalidRange.sources[0].markdown_line_start = 3;
  invalidRange.sources[0].markdown_line_end = 1;
  assert.throws(() => normalizeBidDocumentFormatRequirements(invalidRange, tenderSources), /反向/);
});

test('rejects a global none fallback when explicit scoped formats exist', () => {
  const fixture = formatFixture();
  fixture.result.profiles.push({
    profile_id: 'global-none',
    applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
    format_strength: 'none',
    document_title: '全局回退',
    outline: [],
  });
  assert.throws(() => normalizeBidDocumentFormatRequirements(fixture, tenderSources), /none profile.*明确.*范围|全局回退/);
});

test('recomputes source lines from a unique excerpt and strips displayed line prefixes', () => {
  const fixture = formatFixture();
  fixture.result.sources[0] = {
    source_file_id: 'tender-main',
    markdown_line_start: '999',
    excerpt: '1|技术文件采用下列固定目录。',
  };
  const normalized = normalizeBidDocumentFormatRequirements(fixture, tenderSources);
  assert.equal(normalized.result.sources[0].markdown_line_start, 1);
  assert.equal(normalized.result.sources[0].markdown_line_end, 1);
  assert.equal(normalized.result.sources[0].excerpt, '技术文件采用下列固定目录。');

  const reversed = formatFixture();
  reversed.result.sources[0].markdown_line_start = 3;
  reversed.result.sources[0].markdown_line_end = 1;
  assert.equal(normalizeBidDocumentFormatRequirements(reversed, tenderSources).result.sources[0].markdown_line_start, 1);

  const outOfRange = formatFixture();
  outOfRange.result.sources[0].markdown_line_end = 99;
  assert.equal(normalizeBidDocumentFormatRequirements(outOfRange, tenderSources).result.sources[0].markdown_line_end, 1);
});

test('resolves HTML source anchors to canonical raw excerpts and rejects invented fixed text', () => {
  const anchoredSources = [{
    id: 'tender-html',
    fileName: 'HTML招标文件.md',
    markdown: '# 技术文件\n<table><tr><td>一、</td><td>投标承诺函</td></tr></table>\n<p>我方承诺</p><p>严格履行。</p><p>甲____乙</p>\n<table><tr><td>甲</td><td></td><td>乙</td></tr></table>',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(anchoredSources);
  const directoryAnchor = sourceAnchors.anchors.find((anchor) => anchor.visibleText.includes('一、 | 投标承诺函'));
  const bodyAnchors = sourceAnchors.anchors.filter((anchor) => ['我方承诺', '严格履行。'].includes(anchor.visibleText));
  assert.ok(directoryAnchor);
  assert.equal(bodyAnchors.length, 2);
  const fixture = {
    result: {
      schema_version: 1,
      has_explicit_technical_format: true,
      profiles: [{
        profile_id: 'profile-html',
        applicable_scope: { section_id: 'section-1', section_title: '一标段', package_ids: [], package_names: [], document_type: 'technical' },
        format_strength: 'strict',
        document_title: '技术文件',
        outline: [{
          format_node_id: 'node-commitment',
          source_number: '一、',
          source_title: '投标承诺函',
          required_in_outline: true,
          response_required: true,
          title_locked: true,
          order_locked: true,
          level_locked: true,
          numbering_policy: 'preserve-source',
          response_mode: 'locked-commitment',
          allow_ai_children: false,
          template_id: 'template-commitment',
          children: [],
          source: { anchor_ids: [directoryAnchor.id] },
        }],
      }],
      template_ids: ['template-commitment'],
      other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: ['template-commitment'] },
      sources: [{ anchor_ids: [directoryAnchor.id] }],
    },
    templates: [{
      template_id: 'template-commitment',
      kind: 'locked-commitment',
      profile_id: 'profile-html',
      format_node_id: 'node-commitment',
      source_title: '投标承诺函',
      source_location: { anchor_ids: bodyAnchors.map((anchor) => anchor.id) },
      template: { kind: 'locked-commitment', segments: [{ type: 'locked', text: '我方承诺\n严格履行。' }] },
    }],
  };

  const normalized = normalizeBidDocumentFormatRequirements(fixture, anchoredSources, sourceAnchors);
  assert.equal(normalized.result.profiles[0].outline[0].source.excerpt, '<tr><td>一、</td><td>投标承诺函</td></tr>');
  assert.equal(normalized.result.profiles[0].outline[0].source.markdown_line_start, 2);
  assert.equal(normalized.templates[0].source_location.excerpt, '<p>我方承诺</p><p>严格履行。</p>');

  const invented = clone(fixture);
  invented.templates[0].template.segments[0].text = '我方承诺额外提供并不存在的服务。';
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(invented, anchoredSources, sourceAnchors),
    /locked 固定内容必须.*逐字覆盖/u,
  );

  const omitted = clone(fixture);
  omitted.templates[0].template.segments[0].text = '我方承诺';
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(omitted, anchoredSources, sourceAnchors),
    /必须完整覆盖来源原文/u,
  );

  const wrongTitle = clone(fixture);
  wrongTitle.templates[0].source_title = '另一份承诺函';
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(wrongTitle, anchoredSources, sourceAnchors),
    /模板标题与引用节点/u,
  );

  const placeholderAnchor = sourceAnchors.anchors.find((anchor) => anchor.canonicalText === '甲____乙');
  assert.ok(placeholderAnchor);
  const withSlot = clone(fixture);
  withSlot.templates[0].source_location = { anchor_ids: [placeholderAnchor.id] };
  withSlot.templates[0].template.segments = [
    { type: 'locked', text: '甲' },
    { type: 'slot', slot_id: 'blank', label: '留空', value_source: 'manual', required: true },
    { type: 'locked', text: '乙' },
  ];
  assert.doesNotThrow(() => normalizeBidDocumentFormatRequirements(withSlot, anchoredSources, sourceAnchors));

  const tablePlaceholderAnchor = sourceAnchors.anchors.find((anchor) => anchor.tableCells?.join('|') === '甲||乙');
  assert.ok(tablePlaceholderAnchor);
  const withTableSlot = clone(withSlot);
  withTableSlot.templates[0].source_location = { anchor_ids: [tablePlaceholderAnchor.id] };
  assert.doesNotThrow(() => normalizeBidDocumentFormatRequirements(withTableSlot, anchoredSources, sourceAnchors));

  const missingSlot = clone(withSlot);
  missingSlot.templates[0].template.segments = [{ type: 'locked', text: '甲' }, { type: 'locked', text: '乙' }];
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(missingSlot, anchoredSources, sourceAnchors),
    /逐字覆盖来源原文/u,
  );

  const extraSlot = clone(fixture);
  extraSlot.templates[0].template.segments = [
    { type: 'locked', text: '我方承诺' },
    { type: 'slot', slot_id: 'invented', label: '不存在的留空', value_source: 'manual', required: true },
    { type: 'locked', text: '严格履行。' },
  ];
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(extraSlot, anchoredSources, sourceAnchors),
    /slot 必须与来源中同一位置/u,
  );
});

test('rejects fixed table headers that reorder anchored source evidence', () => {
  const tableSources = [{
    id: 'tender-table',
    fileName: '表格招标文件.md',
    markdown: '<table><tr><th>序号</th><th>响应</th></tr><tr><td>1</td><td>____</td></tr></table>',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tableSources);
  const rows = sourceAnchors.anchors.filter((anchor) => anchor.kind === 'html-table-row');
  const fixture = {
    result: {
      schema_version: 1,
      has_explicit_technical_format: true,
      profiles: [{
        profile_id: 'profile-table',
        applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
        format_strength: 'strict',
        document_title: '技术文件',
        outline: [{
          format_node_id: 'node-table',
          source_number: '一、',
          source_title: '技术偏差表',
          required_in_outline: true,
          response_required: true,
          title_locked: true,
          order_locked: true,
          level_locked: true,
          numbering_policy: 'preserve-source',
          response_mode: 'fixed-markdown-table',
          allow_ai_children: false,
          template_id: 'template-table',
          children: [],
          source: { anchor_ids: [rows[0].id] },
        }],
      }],
      template_ids: ['template-table'],
      other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: ['template-table'] },
      sources: [{ anchor_ids: [rows[0].id] }],
    },
    templates: [{
      template_id: 'template-table',
      kind: 'fixed-markdown-table',
      profile_id: 'profile-table',
      format_node_id: 'node-table',
      source_title: '技术偏差表',
      source_location: { anchor_ids: rows.map((row) => row.id) },
      template: {
        kind: 'fixed-markdown-table',
        headers: ['序号', '响应'],
        body: [{
          kind: 'row',
          row: { cells: [
            { kind: 'locked', text: '1' },
            { kind: 'slot', slot_id: 'response', label: '响应', value_source: 'manual', required: true },
          ] },
        }],
        fixed_notes: [],
      },
    }],
  };

  assert.doesNotThrow(() => normalizeBidDocumentFormatRequirements(fixture, tableSources, sourceAnchors));
  const reordered = clone(fixture);
  reordered.templates[0].template.headers = ['响应', '序号'];
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(reordered, tableSources, sourceAnchors),
    /固定表头必须按来源列顺序/u,
  );

  const wrongCells = clone(fixture);
  wrongCells.templates[0].template.body[0].row.cells = [
    { kind: 'slot', slot_id: 'wrong', label: '错误列', value_source: 'manual', required: true },
    { kind: 'locked', text: '1' },
  ];
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(wrongCells, tableSources, sourceAnchors),
    /必须按来源行列逐格对应/u,
  );

  const missingCellSlot = clone(fixture);
  missingCellSlot.templates[0].template.body[0].row.cells[1] = { kind: 'locked', text: '____' };
  assert.throws(
    () => normalizeBidDocumentFormatRequirements(missingCellSlot, tableSources, sourceAnchors),
    /必须按来源行列逐格对应/u,
  );

  const mergedSources = [{
    id: 'tender-merged-table',
    fileName: '合并表头招标文件.md',
    markdown: '<table><tr><th rowspan="2">序号</th><th colspan="2">技术要求</th></tr><tr><th>指标</th><th>响应</th></tr><tr><td>1</td><td>固定指标</td><td>____</td></tr></table>',
  }];
  const mergedAnchors = buildBidAnalysisSourceAnchors(mergedSources);
  const mergedRows = mergedAnchors.anchors.filter((anchor) => anchor.kind === 'html-table-row');
  assert.equal(mergedRows[0].tableCellSpans[0].rowspan, 2);
  assert.equal(mergedRows[0].tableCellSpans[1].colspan, 2);
  const mergedFixture = clone(fixture);
  mergedFixture.result.profiles[0].outline[0].source = { anchor_ids: [mergedRows[0].id] };
  mergedFixture.result.sources = [{ anchor_ids: [mergedRows[0].id] }];
  mergedFixture.templates[0].source_location = { anchor_ids: mergedRows.map((row) => row.id) };
  mergedFixture.templates[0].template.headers = ['序号', '指标', '响应'];
  mergedFixture.templates[0].template.body[0].row.cells = [
    { kind: 'locked', text: '1' },
    { kind: 'locked', text: '固定指标' },
    { kind: 'slot', slot_id: 'merged-response', label: '响应', value_source: 'manual', required: true },
  ];
  assert.doesNotThrow(() => normalizeBidDocumentFormatRequirements(mergedFixture, mergedSources, mergedAnchors));
});

test('still rejects unknown, untraceable, and non-unique source locations', () => {
  const unknown = formatFixture();
  unknown.result.sources[0].source_file_id = 'missing';
  assert.throws(() => normalizeBidDocumentFormatRequirements(unknown, tenderSources), /未知 source/);

  const untraceable = formatFixture();
  untraceable.result.sources[0].excerpt = '模型改写后不存在的内容';
  assert.throws(() => normalizeBidDocumentFormatRequirements(untraceable, tenderSources), /源文件中.*定位/);

  const duplicateSources = [{ id: 'tender-main', fileName: '重复.md', markdown: '相同要求。 相同要求。' }];
  const duplicate = formatFixture();
  for (const item of [duplicate.result.sources[0], ...duplicate.result.profiles[0].outline.map((node) => node.source), ...duplicate.templates.map((template) => template.source_location)]) {
    item.markdown_line_start = 1;
    item.markdown_line_end = 1;
    item.excerpt = '相同要求。';
  }
  assert.throws(() => normalizeBidDocumentFormatRequirements(duplicate, duplicateSources), /唯一定位/);
});

test('rejects invalid response modes, empty templates, bad containers and preserve-source nodes', () => {
  const invalidMode = formatFixture();
  invalidMode.result.profiles[0].outline[0].response_mode = 'optional_omit';
  assert.throws(() => normalizeBidDocumentFormatRequirements(invalidMode, tenderSources), /非法枚举/);

  const emptyTemplate = formatFixture();
  emptyTemplate.templates[0].template.segments = [];
  assert.throws(() => normalizeBidDocumentFormatRequirements(emptyTemplate, tenderSources), /locked 片段/);

  const badContainer = formatFixture();
  badContainer.result.profiles[0].outline[2].response_mode = 'container';
  assert.throws(() => normalizeBidDocumentFormatRequirements(badContainer, tenderSources), /container 节点必须有子节点/);

  const noSourceNumber = formatFixture();
  delete noSourceNumber.result.profiles[0].outline[0].source_number;
  assert.throws(() => normalizeBidDocumentFormatRequirements(noSourceNumber, tenderSources), /必须有源编号/);
});

test('rejects malformed fixed tables and template-node mismatches', () => {
  const wrongColumns = formatFixture();
  wrongColumns.templates[1].template.body[0].row.cells.pop();
  assert.throws(() => normalizeBidDocumentFormatRequirements(wrongColumns, tenderSources), /列数必须/);

  const duplicateRegion = formatFixture();
  duplicateRegion.templates[1].template.body.push(clone(duplicateRegion.templates[1].template.body[1]));
  assert.throws(() => normalizeBidDocumentFormatRequirements(duplicateRegion, tenderSources), /region ID 重复/);

  const wrongNode = formatFixture();
  wrongNode.templates[0].format_node_id = 'node-table';
  assert.throws(() => normalizeBidDocumentFormatRequirements(wrongNode, tenderSources), /节点引用不一致/);
});

test('format hash changes for punctuation, slot schema, and table structure but ignores runtime fields', () => {
  const baseline = formatFixture();
  const baselineHash = normalizeBidDocumentFormatRequirements(baseline, tenderSources).normalized_hash;

  const punctuation = clone(baseline);
  punctuation.templates[0].template.segments[0].text = '一、投标承诺函：我方完全响应本项目全部要求！';
  assert.notEqual(normalizeBidDocumentFormatRequirements(punctuation, tenderSources).normalized_hash, baselineHash);

  const slot = clone(baseline);
  slot.templates[0].template.segments[1].required = false;
  assert.notEqual(normalizeBidDocumentFormatRequirements(slot, tenderSources).normalized_hash, baselineHash);

  const table = clone(baseline);
  table.templates[1].template.fixed_notes[0] = '无偏差时填写“完全响应”。';
  assert.notEqual(normalizeBidDocumentFormatRequirements(table, tenderSources).normalized_hash, baselineHash);

  const runtime = clone(baseline);
  runtime.templates[0].confirmed = true;
  runtime.templates[0].locked_hash = 'runtime';
  runtime.templates[0].created_at = 'yesterday';
  runtime.templates[0].updated_at = 'today';
  assert.equal(normalizeBidDocumentFormatRequirements(runtime, tenderSources).normalized_hash, baselineHash);
});

test('normalizes complete quotation coverage, stable rule IDs, and multiple quote modes', () => {
  const fixture = quotationFixture();
  fixture.profiles.push(quoteProfile({
    profile_id: 'quote-profile-2',
    applicable_scope: { package_ids: ['package-2'], package_names: ['包二'], document_type: 'quotation' },
    quote_mode: 'unit',
  }));
  const normalized = normalizeQuotationRequirements(fixture, tenderSources);
  assert.deepEqual(normalized.result.profiles.map((profile) => profile.quote_mode), ['mixed', 'unit']);
  assert.match(normalized.result.profiles[0].price_composition[0].rule_id, /^quote-rule-/);
  assert.match(normalized.result.profiles[0].limits[0].limit_id, /^quote-limit-/);
  assert.equal(normalized.result.profiles[0].precision_and_rounding.rounding_mode, 'half-up');
  assert.equal(normalized.result.profiles[0].external_dependencies.length, 1);
});

test('accepts a global not-specified quotation result', () => {
  const emptyRules = {
    profile_id: 'none',
    applicable_scope: { package_ids: [], package_names: [], document_type: 'quotation' },
    quote_mode: 'not-specified',
    currency: 'not-specified',
    limits: [],
    tax: { pricing_basis: 'not-specified', vat_rates: [], invoice_types: [], rules: [] },
    price_composition: [],
    precision_and_rounding: { rounding_mode: 'not-specified', rules: [] },
    formulas: [],
    required_forms: [],
    submission_rules: [],
    consistency_rules: [],
    precedence_rules: [],
    prohibited_pricing_statements: [],
    invalid_bid_triggers: [],
    abnormally_low_price_review: [],
    settlement_and_payment: [],
    external_dependencies: [],
    sources: [],
  };
  const normalized = normalizeQuotationRequirements({
    schema_version: 1,
    has_explicit_quotation_requirements: false,
    profiles: [emptyRules],
    sources: [{ ...source(13), excerpt: undefined }],
  }, tenderSources);
  assert.equal(normalized.result.profiles[0].quote_mode, 'not-specified');
});

test('accepts quotation requirements wrapped in a result object', () => {
  const normalized = normalizeQuotationRequirements({ result: quotationFixture() }, tenderSources);
  assert.equal(normalized.result.profiles[0].quote_mode, 'mixed');
});

test('rejects illegal quotation enums and invalid rule sources', () => {
  const invalidMode = quotationFixture();
  invalidMode.profiles[0].quote_mode = 'none';
  assert.throws(() => normalizeQuotationRequirements(invalidMode, tenderSources), /非法枚举/);

  const invalidTax = quotationFixture();
  invalidTax.profiles[0].tax.pricing_basis = 'sometimes';
  assert.throws(() => normalizeQuotationRequirements(invalidTax, tenderSources), /非法枚举/);

  const unknownSource = quotationFixture();
  unknownSource.profiles[0].invalid_bid_triggers[0].source.source_file_id = 'missing';
  assert.throws(() => normalizeQuotationRequirements(unknownSource, tenderSources), /未知 source/);
});
