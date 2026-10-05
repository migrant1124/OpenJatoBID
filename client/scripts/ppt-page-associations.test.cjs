const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { load } = require('cheerio');
const { remapLinks, updatePlanDocuments } = require('../electron/services/pptPageAssociations.cjs');
test('排序/插页按稳定ID修正目录跳转和显式页码；删去目标移除失效链接', () => {
  const before = [{ slideId: '目录' }, { slideId: '目标' }], after = [{ slideId: '新增' }, before[1], before[0]];
  const source = '<svg viewBox="0 0 1280 720"><a href="#slide-2"><text data-jato-page-number="true">2</text></a></svg>';
  const doc = load(remapLinks(source, before, after), { xml: true }); assert.equal(doc('a').attr('href'), '#slide-2'); assert.equal(doc('a').attr('data-jato-slide-id'), '目标');
  const moved = load(remapLinks(source, before, [before[1], before[0]]), { xml: true }); assert.equal(moved('a').attr('href'), '#slide-1'); assert.equal(moved('text').text(), '1');
  const deleted = load(remapLinks(source, before, [before[0]]), { xml: true }); assert.equal(deleted('a').attr('href'), undefined); assert.equal(deleted('text').text(), '');
  const shape = '<svg viewBox="0 0 1280 720"><g data-pptx-shape-hyperlink="#slide-2"><text>跳转</text></g></svg>';
  assert.equal(load(remapLinks(shape, before, [before[1], before[0]]), { xml: true })('g').attr('data-pptx-shape-hyperlink'), '#slide-1');
  assert.equal(load(remapLinks(shape, before, [before[0]]), { xml: true })('g').attr('data-pptx-shape-hyperlink'), undefined);
});
test('设计规格的目录与执行锁随稳定页清单重排，不覆盖其他设计字段', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-plan-test-')); try {
    fs.writeFileSync(path.join(root, 'design_spec.md'), '# 合成\n| Page Count | 2 |\n## IX. Content Outline\n#### Slide 01 - 甲\n- **Title**: 甲\n- **Content**: 原甲\n- **Hyperlinks**: #slide-2\n#### Slide 02 - 乙\n- **Title**: 乙\n- **Content**: 原乙\n- **Relationships**: none\n## X. Speaker Notes Requirements\n保留字段\n');
    fs.writeFileSync(path.join(root, 'spec_lock.md'), '## page_rhythm\n- P01: anchor\n- P02: evidence\n## forbidden\n不允许执行任意脚本\n');
    const before = [{ slideId: 'a', title: '甲' }, { slideId: 'b', title: '乙' }]; updatePlanDocuments(root, before, [before[1], before[0]]);
    const spec = fs.readFileSync(path.join(root, 'design_spec.md'), 'utf8'), lock = fs.readFileSync(path.join(root, 'spec_lock.md'), 'utf8'); assert(spec.includes('Slide 01 - 乙')); assert(spec.includes('**Hyperlinks**: #slide-1')); assert(spec.includes('保留字段')); assert(lock.includes('P01: evidence')); assert(lock.includes('不允许执行任意脚本'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
