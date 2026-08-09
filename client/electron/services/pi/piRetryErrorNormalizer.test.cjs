'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizePiRetryableErrorMessage,
  restorePiErrorMessage,
} = require('./piRetryErrorNormalizer.cjs');

test('Pi 重试错误标准化仅处理已知瞬时上游错误', () => {
  const original = 'upstream service temporarily unavailable';
  const normalized = normalizePiRetryableErrorMessage(original);
  assert.match(normalized, /^Provider returned error: /u);
  assert.equal(restorePiErrorMessage(normalized), original);
  assert.equal(normalizePiRetryableErrorMessage('认证失败'), '认证失败');
});
