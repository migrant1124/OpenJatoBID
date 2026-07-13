const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const {
  buildDocxBuffer,
  formatOutlineTitle,
  resolveTechnicalPlanExportPayload,
} = require('./exportService.cjs');

function responseItem(id, overrides = {}) {
  return {
    id,
    title: id,
    description: '',
    response_mode: 'freeform-markdown',
    response_required: true,
    response_status: 'responded-substantive',
    compliance_risk: 'none',
    content: '权威正文',
    ...overrides,
  };
}

function fakeStore(outline, validationError) {
  let validateCalls = 0;
  return {
    loadTechnicalPlan() {
      return { outlineData: { project_name: '权威项目', outline } };
    },
    validateProtectedResponses() {
      validateCalls += 1;
      if (validationError) throw validationError;
      return { valid: true };
    },
    get validateCalls() {
      return validateCalls;
    },
  };
}

test('technical-plan export ignores renderer outline and validates the authoritative store', () => {
  const authoritative = [responseItem('1', { content: '权威正文' })];
  const store = fakeStore(authoritative);
  const result = resolveTechnicalPlanExportPayload({
    source: 'technical-plan',
    project_name: '伪造项目',
    outline: [responseItem('9', { content: '伪造正文' })],
  }, store);

  assert.equal(store.validateCalls, 1);
  assert.equal(result.project_name, '权威项目');
  assert.equal(result.outline, authoritative);
  assert.doesNotMatch(JSON.stringify(result.outline), /伪造正文/);
});

test('pending and manual responses hard-block technical-plan export', () => {
  for (const responseStatus of ['pending', 'needs-manual-input']) {
    const store = fakeStore([responseItem(responseStatus, {
      response_status: responseStatus,
      content: responseStatus === 'pending' ? '' : '待填写',
    })]);
    assert.throws(
      () => resolveTechnicalPlanExportPayload({ source: 'technical-plan' }, store),
      /请处理后再导出/,
    );
  }
});

test('only missing required evidence can pass after explicit risk acknowledgement', () => {
  const missing = responseItem('evidence', {
    response_mode: 'evidence-markdown',
    response_status: 'missing-required-evidence',
    compliance_risk: 'potential-rejection',
    content: '无。',
  });
  const store = fakeStore([missing]);

  assert.throws(
    () => resolveTechnicalPlanExportPayload({ source: 'technical-plan' }, store),
    /强制证明材料缺失，确认风险后方可导出/,
  );
  assert.equal(
    resolveTechnicalPlanExportPayload({
      source: 'technical-plan',
      acknowledgeMissingEvidence: true,
    }, store).outline[0],
    missing,
  );
});

test('protected template validation errors are never bypassed by export acknowledgement', () => {
  for (const message of [
    '该固定模板尚未确认并锁定',
    '固定模板仍有必填字段未填写',
    '固定表格正文与锁定模板不一致',
  ]) {
    const store = fakeStore([responseItem('1')], new Error(message));
    assert.throws(
      () => resolveTechnicalPlanExportPayload({
        source: 'technical-plan',
        acknowledgeMissingEvidence: true,
      }, store),
      new RegExp(message),
    );
  }
});

test('heading numbering uses auto, source, and none policies without duplicates', () => {
  const style = { numbering_format: 'outline-decimal', numbering_template: '' };
  assert.equal(formatOutlineTitle({ id: '1.2', title: '1.2 自动章节', numbering_policy: 'auto' }, style), '1.2 自动章节');
  assert.equal(formatOutlineTitle({ id: '2', title: '7.3 固定标题', numbering_policy: 'preserve-source', source_number: '7.3' }, style), '7.3 固定标题');
  assert.equal(formatOutlineTitle({ id: '2', title: '7.3固定标题', numbering_policy: 'preserve-source', source_number: '7.3' }, style), '7.3 固定标题');
  assert.equal(formatOutlineTitle({ id: '3', title: '9.9 无编号标题', numbering_policy: 'none', source_number: '9.9' }, style), '无编号标题');
  assert.equal(formatOutlineTitle({ id: '1', title: '1号楼施工方案', numbering_policy: 'none' }, style), '1号楼施工方案');
  assert.equal(formatOutlineTitle({ id: '1', title: '1号楼施工方案', numbering_policy: 'auto' }, style), '1 1号楼施工方案');
  assert.throws(
    () => formatOutlineTitle({ id: '4', title: '缺少编号', numbering_policy: 'preserve-source' }, style),
    /缺少源编号/,
  );
});

test('generic DOCX export keeps renderer outline and applies policy-aware headings', async () => {
  const heading = {
    font: '黑体',
    size: '小四',
    alignment: '左对齐',
    bold: false,
    text_color: '#000000',
    spacing_before_pt: 0,
    spacing_after_pt: 0,
    line_spacing: 1,
    numbering_format: 'outline-decimal',
    numbering_template: '',
  };
  const buffer = await buildDocxBuffer({
    project_name: '通用导出',
    export_format: { headings: Array.from({ length: 6 }, () => ({ ...heading })) },
    outline: [
      responseItem('1', { title: '1 自动章节', numbering_policy: 'auto' }),
      responseItem('2', { title: '7.3 固定标题', numbering_policy: 'preserve-source', source_number: '7.3' }),
      responseItem('3', { title: '9.9 无编号标题', numbering_policy: 'none', source_number: '9.9' }),
    ],
  });
  const xml = new AdmZip(buffer).readAsText('word/document.xml');

  assert.equal((xml.match(/1 自动章节/g) || []).length, 1);
  assert.equal((xml.match(/7\.3 固定标题/g) || []).length, 1);
  assert.match(xml, /无编号标题/);
  assert.doesNotMatch(xml, /9\.9 无编号标题/);
});

test('authoritative protected Markdown reaches DOCX without rewriting fixed text', async () => {
  const commitment = '我方郑重承诺：一、不得转包；二、按期履约。';
  const fixedNote = '注：本表结构不得修改。';
  const outline = [
    responseItem('1', { title: '承诺函', response_mode: 'locked-commitment', content: commitment }),
    responseItem('2', {
      title: '技术偏差表',
      response_mode: 'fixed-markdown-table',
      content: `| 序号 | 响应 |\n| --- | --- |\n| 1 | 完全响应 |\n\n${fixedNote}`,
    }),
  ];
  const payload = resolveTechnicalPlanExportPayload({ source: 'technical-plan' }, fakeStore(outline));
  const xml = new AdmZip(await buildDocxBuffer(payload)).readAsText('word/document.xml');

  assert.match(xml, new RegExp(commitment));
  assert.match(xml, /完全响应/);
  assert.match(xml, new RegExp(fixedNote));
});
