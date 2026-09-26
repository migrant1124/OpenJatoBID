const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { createAiService } = require('./aiService.cjs');
const { createAiRequestQueue } = require('../utils/aiRequestQueue.cjs');
const { markAiRequestError } = require('../utils/aiRetry.cjs');

test('流式请求收到 JSON 图片响应时仍保存真图，且不重试计费请求', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-ai-transport-'));
  const oldFetch = global.fetch;
  const config = { developer_mode: false, image_model: { provider: 'jinlong', status: 'available',
    api_key: 'test-only', base_url: 'https://example.com/v1', model_name: 'gpt-image-2-1k',
    image_size: '8x6', request_mode: 'stream' } };
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#e53152' } }).png().toBuffer();
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    assert.equal(JSON.parse(options.body).model, 'gpt-image-2-1k');
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
      { headers: { 'content-type': 'application/json' } });
  };
  try {
    const service = createAiService({ app: { getPath: () => temp, getVersion: () => 'test' },
      configStore: { load: () => config } });
    const result = await service.generateImage({ prompt: '红色方形', preservePrompt: true,
      noRetry: true, configSnapshot: config });
    assert.equal(calls, 1);
    assert.equal(fs.readFileSync(result.file_path).subarray(0, 4).toString('hex'), '89504e47');
    const queue = createAiRequestQueue();
    let failedCalls = 0;
    await assert.rejects(queue.enqueue(() => { failedCalls += 1;
      throw markAiRequestError(new Error('temporary'), { retryable: true }); }, { maxAttempts: 1 }), /temporary/);
    assert.equal(failedCalls, 1);
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});
