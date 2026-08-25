const assert = require('node:assert/strict');
const test = require('node:test');
const { trackAgentRuntime } = require('./agentRuntimeAnalytics.cjs');

test('conversation analytics omit the configured model endpoint', async () => {
  let payload;
  trackAgentRuntime(
    { getVersion: () => '1.7.0' },
    { load: () => ({ base_url: 'https://private.example/v1', model_name: 'model' }) },
    { track: (value) => { payload = value; } },
    'pi',
    'success',
    { includeModelEndpoint: false },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal('ai_model_base_url' in payload, false);
});
