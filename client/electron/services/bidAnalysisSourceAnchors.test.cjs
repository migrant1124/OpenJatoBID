const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBidAnalysisSourceAnchors,
  buildSourceAnchorContext,
  resolveSourceAnchorReference,
} = require('./bidAnalysisSourceAnchors.cjs');

test('builds separate semantic anchors for HTML table rows on one physical Markdown line', () => {
  const tenderSources = [{
    id: 'source-a',
    fileName: '招标文件.md',
    markdown: '# 格式要求\n<table><tbody><tr><td>2.1</td><td><p>业绩文件</p></td><td>√</td></tr><tr><td>2.2</td><td>技术方案</td><td>√</td></tr></tbody></table>',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tenderSources);
  const rows = sourceAnchors.anchors.filter((anchor) => anchor.kind === 'html-table-row');

  assert.equal(rows.length, 2);
  assert.equal(rows[0].markdownLineStart, 2);
  assert.equal(rows[1].markdownLineStart, 2);
  assert.equal(rows[0].visibleText, '2.1 | 业绩文件 | √');
  assert.equal(rows[1].visibleText, '2.2 | 技术方案 | √');
  const context = buildSourceAnchorContext(sourceAnchors);
  assert.match(context, new RegExp(rows[0].id));
  assert.match(context, /# 格式要求/u);
  assert.match(context, /2\.1 \| 业绩文件 \| √/u);
  assert.doesNotMatch(context, /<td>/u);
});

test('builds one immutable anchor catalog with a stable hash', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([{
    id: 'source-a',
    fileName: '招标文件.md',
    markdown: '第一项\n第二项',
  }]);

  assert.match(sourceAnchors.anchor_catalog_hash, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(sourceAnchors), true);
  assert.equal(Object.isFrozen(sourceAnchors.anchors), true);
  assert.equal(Object.isFrozen(sourceAnchors.anchors[0]), true);
  assert.throws(
    () => sourceAnchors.byId.set('source-anchor-extra', sourceAnchors.anchors[0]),
    /AnchorCatalog\.byId is immutable/u,
  );
  assert.throws(
    () => sourceAnchors.sourcesById.clear(),
    /AnchorCatalog\.sourcesById is immutable/u,
  );
});

test('resolves one or more anchors back to exact source fragments and canonical line numbers', () => {
  const tenderSources = [{
    id: 'source-a',
    fileName: '招标文件.md',
    markdown: '<table><tr><td>第一行</td></tr><tr><td>第二行</td></tr></table>\n结束',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tenderSources);
  const rows = sourceAnchors.anchors.filter((anchor) => anchor.kind === 'html-table-row');
  const one = resolveSourceAnchorReference({ anchor_ids: [rows[0].id] }, sourceAnchors, 'node.source');
  assert.equal(one.excerpt, '<tr><td>第一行</td></tr>');
  assert.equal(one.markdownLineStart, 1);
  assert.equal(one.markdownLineEnd, 1);

  const both = resolveSourceAnchorReference({ anchor_ids: [rows[1].id, rows[0].id] }, sourceAnchors, 'template.source_location');
  assert.equal(both.excerpt, '<tr><td>第一行</td></tr><tr><td>第二行</td></tr>');
  assert.equal(both.evidenceText, '第一行\n第二行');
});

test('splits same-line HTML blocks and preserves heading depth in visible context', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '<h2>技术文件</h2><p>第一段</p><p>第二段</p>',
  }]);
  assert.deepEqual(
    sourceAnchors.anchors.map((anchor) => anchor.visibleText),
    ['## 技术文件', '第一段', '第二段'],
  );
  const paragraphs = sourceAnchors.anchors.slice(1);
  const resolved = resolveSourceAnchorReference({ anchor_ids: paragraphs.map((anchor) => anchor.id) }, sourceAnchors);
  assert.equal(resolved.excerpt, '<p>第一段</p><p>第二段</p>');
});

test('rejects unknown and cross-file anchor references', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([
    { id: 'source-a', fileName: 'A.md', markdown: 'A要求' },
    { id: 'source-b', fileName: 'B.md', markdown: 'B要求' },
  ]);
  assert.throws(
    () => resolveSourceAnchorReference({ anchor_ids: ['missing'] }, sourceAnchors),
    /未知来源锚点/u,
  );
  assert.throws(
    () => resolveSourceAnchorReference({ anchor_ids: sourceAnchors.anchors.map((anchor) => anchor.id) }, sourceAnchors),
    /同一源文件/u,
  );
  assert.throws(
    () => resolveSourceAnchorReference({ anchor_ids: [sourceAnchors.anchors[0].id, sourceAnchors.anchors[0].id] }, sourceAnchors),
    /锚点 ID 重复/u,
  );
});

test('rejects non-contiguous anchors from the same source', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '第一项\n中间无关内容\n第三项',
  }]);
  assert.throws(
    () => resolveSourceAnchorReference({
      anchor_ids: [sourceAnchors.anchors[0].id, sourceAnchors.anchors[2].id],
    }, sourceAnchors),
    /必须.*连续/u,
  );
});

test('ignores closing-only HTML wrappers when checking adjacent source evidence', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '<table><tbody><tr><td>第一行</td></tr><tr><td>第二行</td></tr></tbody></table>\n紧随说明',
  }]);
  const rows = sourceAnchors.anchors.filter((anchor) => anchor.kind === 'html-table-row');
  const note = sourceAnchors.anchors.find((anchor) => anchor.visibleText === '紧随说明');

  assert.equal(sourceAnchors.anchors.some((anchor) => /<\/tbody>|<\/table>/u.test(anchor.visibleText)), false);
  assert.ok(note);
  assert.doesNotThrow(() => resolveSourceAnchorReference({
    anchor_ids: [rows[1].id, note.id],
  }, sourceAnchors));
});
