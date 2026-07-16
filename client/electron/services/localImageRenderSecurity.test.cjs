const assert = require('node:assert/strict');
const test = require('node:test');
const { __test__, sanitizeLegacyHtml } = require('./localImageRenderService.cjs');

test('隐藏渲染窗口保持隔离、沙箱和 Web 安全', () => {
  const options = __test__.buildRenderWindowOptions('temp:jato-test');
  assert.equal(options.width, 1240);
  assert.equal(options.height, 900);
  assert.equal(options.show, false);
  assert.equal(options.frame, false);
  assert.deepEqual(options.webPreferences, {
    partition: 'temp:jato-test', offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false,
  });
});

test('旧 HTML 只读渲染时移除脚本、事件和远程资源', () => {
  const safe = sanitizeLegacyHtml('<script>x()</script><img src="https://example.test/a.png" onerror="x()"><a href="http://example.test">x</a>');
  assert.doesNotMatch(safe, /script|onerror|https?:/i);
});
