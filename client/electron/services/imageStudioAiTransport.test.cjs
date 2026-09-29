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
    api_key: 'test-only', base_url: 'https://example.com/v1', model_name: 'gpt-image-2',
    image_size: '8x6', request_mode: 'stream' } };
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#e53152' } }).png().toBuffer();
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    assert.equal(JSON.parse(options.body).model, 'gpt-image-2');
    assert.equal(JSON.parse(options.body).stream, true);
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

test('参考图经图像队列以 multipart 字节送 edits，尺寸不改全局设置', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-ai-edit-'));
  const oldFetch = global.fetch;
  const config = { developer_mode: false, image_model: { provider: 'jinlong', status: 'available',
    api_key: 'test-only', base_url: 'https://example.com/v1', model_name: 'gpt-image-2-1k',
    image_size: '1024x1024', request_mode: 'normal' } };
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#e53152' } }).png().toBuffer();
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://example.com/v1/images/edits');
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.body.get('model'), 'gpt-image-2-1k');
    assert.equal(options.body.get('size'), '1536x1024');
    assert.equal(options.body.getAll('image[]').length, 2);
    assert.deepEqual(Buffer.from(await options.body.getAll('image[]')[0].arrayBuffer()), png);
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
      { headers: { 'content-type': 'application/json' } });
  };
  try {
    const service = createAiService({ app: { getPath: () => temp, getVersion: () => 'test' },
      configStore: { load: () => config } });
    const result = await service.generateImage({ prompt: '保持图一主体', size: '1536x1024',
      images: [{ buffer: png, mimeType: 'image/png' }, { buffer: png, mimeType: 'image/png' }],
      noRetry: true, configSnapshot: config });
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(result.file_path), true);
    assert.equal(config.image_model.image_size, '1024x1024');
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('URL 图片下载失败只重试 GET，不再次 POST 生图', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-ai-download-'));
  const oldFetch = global.fetch;
  const config = { image_model: { provider: 'jinlong', status: 'available', api_key: 'test-only',
    base_url: 'https://example.com/v1', model_name: 'gpt-image-2', image_size: '8x6', request_mode: 'normal' } };
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#00aaff' } }).png().toBuffer();
  let posts = 0; let gets = 0;
  global.fetch = async (url) => {
    if (url === 'https://example.com/v1/images/generations') {
      posts += 1;
      return new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.png' }] }),
        { headers: { 'content-type': 'application/json' } });
    }
    gets += 1;
    if (gets === 1) throw new Error('temporary download failure');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  };
  try {
    const service = createAiService({ app: { getPath: () => temp, getVersion: () => 'test' }, configStore: { load: () => config } });
    const result = await service.generateImage({ prompt: '蓝色方块', noRetry: true, configSnapshot: config });
    assert.equal(fs.existsSync(result.file_path), true);
    assert.deepEqual([posts, gets], [1, 2]);
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('金龙 Nano 使用原样 ID 的 generateContent，Bearer Key 与参考图', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-ai-nano-'));
  const oldFetch = global.fetch;
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#00aaff' } }).png().toBuffer();
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    const model = calls === 1 ? 'Nano Banana Pro' : 'Nano Banana 2';
    assert.equal(url, `https://jlaudeapi.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
    if (calls === 2) {
      assert.equal(body.contents[0].parts[1].inlineData.data, png.toString('base64'));
      assert.equal(body.generationConfig.imageConfig.aspectRatio, '3:2');
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { inlineData: { data: png.toString('base64'), mimeType: 'image/png' } },
    ] } }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const config = { image_model: { provider: 'jinlong', status: 'available', api_key: 'test-only',
      base_url: 'https://img-api.jlaudeapi.com/v1', model_name: 'Nano Banana Pro', image_size: '1024x1024', request_mode: 'normal' } };
    const service = createAiService({ app: { getPath: () => temp, getVersion: () => 'test' }, configStore: { load: () => config } });
    const tested = await service.testImageModel(config);
    assert.equal(tested.success, true);
    const nano2 = { ...config, image_model: { ...config.image_model, model_name: 'Nano Banana 2' } };
    let sent = 0;
    const generated = await service.generateImage({ prompt: '保持参考图构图', size: '1536x1024',
      images: [{ buffer: png, mimeType: 'image/png' }], noRetry: true, onSent() { sent += 1; }, configSnapshot: nano2 });
    assert.equal(fs.existsSync(generated.file_path), true);
    assert.equal(sent, 1);
    assert.equal(calls, 2);
    let rejectedCalls = 0;
    global.fetch = async () => { rejectedCalls += 1; return new Response(JSON.stringify({ error: { message: 'model unavailable' } }), { status: 400 }); };
    await assert.rejects(service.generateImage({ prompt: '失败只发送一次', noRetry: true, configSnapshot: nano2 }), /model unavailable/);
    assert.equal(rejectedCalls, 1);
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('金龙 1K 测试使用非流式请求并识别实际图片结果', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-ai-1k-'));
  const oldFetch = global.fetch;
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#218c74' } }).png().toBuffer();
  const config = { image_model: { provider: 'jinlong', status: 'available', api_key: 'test-only',
    base_url: 'https://img-api.jlaudeapi.com/v1', model_name: 'gpt-image-2-1k',
    image_size: '1536x1024', request_mode: 'stream' } };
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://img-api.jlaudeapi.com/v1/images/generations');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-image-2-1k');
    assert.equal(body.size, '1536x1024');
    assert.equal(body.stream, undefined);
    assert.equal(body.response_format, undefined);
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
      { headers: { 'content-type': 'application/json' } });
  };
  try {
    const service = createAiService({ app: { getPath: () => temp, getVersion: () => 'test' }, configStore: { load: () => config } });
    const result = await service.testImageModel(config);
    assert.equal(result.success, true);
    assert.equal(result.image_data, png.toString('base64'));
    const generated = await service.generateImage({ prompt: '绿色方块', noRetry: true, configSnapshot: config });
    assert.equal(fs.existsSync(generated.file_path), true);
    assert.equal(calls, 2);
    global.fetch = async () => { calls += 1; return new Response(JSON.stringify({ task_id: 'sample-id', status: 'queued' }),
      { headers: { 'content-type': 'application/json' } }); };
    await assert.rejects(service.testImageModel(config), /渠道返回任务 ID/);
    assert.equal(calls, 3);
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('标准生图 SSE 完成事件可解析图片 URL', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-ai-sse-'));
  const oldFetch = global.fetch;
  const config = { image_model: { provider: 'jinlong', status: 'available', api_key: 'test-only',
    base_url: 'https://example.com/v1', model_name: 'gpt-image-2', image_size: '1024x1024', request_mode: 'stream' } };
  global.fetch = async () => new Response('data: {"type":"image_generation.completed","data":[{"url":"https://example.com/result.png"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
  try {
    const service = createAiService({ app: { getPath: () => temp, getVersion: () => 'test' }, configStore: { load: () => config } });
    const result = await service.testImageModel(config);
    assert.equal(result.image_url, 'https://example.com/result.png');
  } finally { global.fetch = oldFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});
