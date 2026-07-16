const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithRemoteImageRetry } = require('./remoteImageRetry.cjs');

test('HTML screenshot retry succeeds on the third attempt and reports both retries', async () => {
  const attempts = [];
  const retries = [];
  const result = await runWithRemoteImageRetry(async (attempt) => {
    attempts.push(attempt);
    if (attempt < 3) throw new Error(`render ${attempt} failed`);
    return 'png';
  }, {
    retryAttempts: 2,
    retryDelayMs: 0,
    onRetry: (attempt) => retries.push(attempt),
  });

  assert.equal(result, 'png');
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(retries, [1, 2]);
});
