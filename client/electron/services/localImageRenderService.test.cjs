const assert = require('node:assert/strict');
const test = require('node:test');
const { MAX_CAPTURE_SEGMENT_HEIGHT, estimateRgbaBytes, normalizeConcurrency, __test__ } = require('./localImageRenderService.cjs');

test('本地渲染并发归一化固定在 1 到 20，非法值回到 5', () => {
  assert.equal(normalizeConcurrency(undefined), 5);
  assert.equal(normalizeConcurrency(0), 5);
  assert.equal(normalizeConcurrency(1.4), 1);
  assert.equal(normalizeConcurrency(21), 20);
});

test('长图连续 RGBA 内存估算不作为像素上限', () => {
  assert.equal(estimateRgbaBytes(1240, 100), 496000);
  assert.ok(estimateRgbaBytes(1240, MAX_CAPTURE_SEGMENT_HEIGHT + 1) > 0);
});

test('完整 HTML 生图文档注入截图样式时不嵌套第二个 html 文档', () => {
  const source = '<!doctype html><html><head><title>图</title></head><body><section id="diagram">内容</section></body></html>';
  const document = __test__.buildGeneratedHtmlDocument(source, 1240);
  assert.equal((document.match(/<html\b/gi) || []).length, 1);
  assert.match(document, /jato-capture-root/);
  assert.match(document, /id="diagram"/);
});

test('缺少显式 body 的完整 HTML 仍会在运行时把已有正文纳入截图根节点', () => {
  const source = '<!doctype html><html><head><title>图</title></head><section id="diagram">内容</section></html>';
  const document = __test__.buildGeneratedHtmlDocument(source, 1240);
  assert.equal((document.match(/<html\b/gi) || []).length, 1);
  assert.match(document, /id="diagram"/);
  assert.match(document, /document\.createElement\('main'\)/);
  assert.doesNotMatch(document, /<main id="jato-capture-root"><\/main>/);
});
