const assert = require('node:assert/strict');
const test = require('node:test');
const {
  IMAGE_UNSUPPORTED_MESSAGE,
  isImageUnsupportedError,
  normalizeAgentProxyRequestBody,
  requestContainsImage,
  summarizeProxyConfig,
  summarizeRequestBody,
} = require('./agentOpenAiProxy.cjs');

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

test('image capability errors are detected only for multimodal requests', () => {
  assert.equal(requestContainsImage({ messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }] }), true);
  assert.equal(requestContainsImage({ messages: [{ content: 'text' }] }), false);
  assert.equal(isImageUnsupportedError(new Error('This model does not support image inputs.')), true);
  assert.equal(isImageUnsupportedError(new Error('Service unavailable.')), false);
  assert.match(IMAGE_UNSUPPORTED_MESSAGE, /当前文本模型不支持图片识别/);
});
