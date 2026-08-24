const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAgentProxyRequestBody, summarizeProxyConfig, summarizeRequestBody } = require('./agentOpenAiProxy.cjs');

test('conversation reasoning effort from Pi reaches the configured upstream request', () => {
  const body = normalizeAgentProxyRequestBody({ model_name: 'reasoning-model' }, {
    model: 'default', messages: [{ role: 'user', content: 'test' }], reasoning_effort: 'high',
  });
  assert.equal(body.model, 'reasoning-model');
  assert.equal(body.reasoning_effort, 'high');
});

test('conversation proxy diagnostics omit endpoint and prompt fingerprints', () => {
  const config = summarizeProxyConfig({ base_url: 'https://secret.example/v1', model_name: 'm' }, true);
  const request = summarizeRequestBody({ model: 'm', messages: [{ role: 'user', content: 'secret' }] }, true);
  assert.equal('endpoint' in config, false);
  assert.equal('prompt_hash' in request, false);
  assert.deepEqual(request.messages_count, 1);
});
