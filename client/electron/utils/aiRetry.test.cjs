const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiService } = require('../services/aiService.cjs');
const {
  getAiRequestErrorMessage,
  isRetryableAiRequestError,
  runWithAiRetry,
} = require('./aiRetry.cjs');

test('network fetch errors expose endpoint and cause instead of fetch failed', () => {
  const cause = new Error('connect ECONNREFUSED 198.18.0.107:443');
  cause.code = 'ECONNREFUSED';
  const error = new TypeError('fetch failed', { cause });

  assert.equal(
    getAiRequestErrorMessage(error, {
      serviceLabel: '文本模型服务',
      endpointHost: 'jlaudeapi.com',
    }),
    '文本模型服务连接失败（jlaudeapi.com，ECONNREFUSED）。请检查网络或代理状态以及 Base URL，恢复后重试。',
  );
});

test('non-network errors keep their original message', () => {
  assert.equal(getAiRequestErrorMessage(new Error('模型不可用')), '模型不可用');
});

test('abort errors use the caller timeout message', () => {
  const error = new Error('AI 请求超时');
  error.name = 'AbortError';
  assert.equal(
    getAiRequestErrorMessage(error, { timeoutMessage: '目录请求超时，请稍后重试' }),
    '目录请求超时，请稍后重试',
  );
});

test('HTTP retry policy keeps 400 and 401 terminal while retrying 429 and 5xx', async (t) => {
  const cases = [
    { status: 400, retryable: false, attempts: 1 },
    { status: 401, retryable: false, attempts: 1 },
    { status: 429, retryable: true, attempts: 3 },
    { status: 503, retryable: true, attempts: 3 },
  ];
  for (const item of cases) {
    await t.test(`HTTP ${item.status}`, async () => {
      const error = new Error(`HTTP ${item.status}`);
      error.status = item.status;
      assert.equal(isRetryableAiRequestError(error), item.retryable);
      let attempts = 0;
      await assert.rejects(
        runWithAiRetry(async () => {
          attempts += 1;
          throw error;
        }, { getDelayMs: () => 0 }),
        error,
      );
      assert.equal(attempts, item.attempts);
    });
  }
});

test('text service preserves HTTP status after user-facing error wrapping', async (t) => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ error: { message: 'API Key 无效' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => { global.fetch = originalFetch; });
  const aiService = createAiService({
    app: {},
    configStore: {
      load: () => ({
        api_key: 'test-key',
        base_url: 'https://example.invalid/v1',
        model_name: 'test-model',
        request_mode: 'normal',
        concurrency_limit: 1,
        developer_mode: false,
      }),
    },
    analyticsService: null,
  });
  await assert.rejects(
    aiService.chat({ messages: [{ role: 'user', content: 'test' }] }),
    (error) => {
      assert.equal(error.message, 'API Key 无效');
      assert.equal(error.status, 401);
      assert.equal(error.statusCode, 401);
      assert.equal(error.aiRequestRetryable, false);
      return true;
    },
  );
  assert.equal(fetchCalls, 1);
});
