const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { loadPiModules } = require('../electron/services/pi/piSessionFactory.cjs');

const clientDir = path.resolve(__dirname, '..');
const schema = { type: 'object', required: ['ok'], properties: { ok: { const: true } }, additionalProperties: false };
const call = (name, args, id = `工具-${name}`) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 仅模拟最外层供应商；SDK、项目工厂、工具、Proxy、队列保持真实。
function respond(res, body, { text = '', calls = [], status = 200, error, usage } = {}) {
  if (status !== 200) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: error || `合成 HTTP ${status}` } }));
    return;
  }
  const tokenUsage = usage || { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: '合成响应', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: tokenUsage }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: '合成响应', object: 'chat.completion.chunk', model: body.model,
    choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  send({ role: 'assistant' });
  for (const [index, item] of calls.entries()) {
    const split = Math.max(1, Math.floor(item.function.arguments.length / 2));
    send({ tool_calls: [{ index, id: item.id, type: 'function', function: { name: item.function.name, arguments: item.function.arguments.slice(0, split) } }] });
    send({ tool_calls: [{ index, function: { arguments: item.function.arguments.slice(split) } }] });
  }
  if (text) send({ content: text });
  send({}, calls.length ? 'tool_calls' : 'stop');
  res.write(`data: ${JSON.stringify({ id: '合成响应', choices: [], usage: tokenUsage })}\n\ndata: [DONE]\n\n`);
  res.end();
}

async function createFixture({ electronApp, moduleRoot, parentDir = path.join(clientDir, '.tmp', 'pi184-upgrade'), handler } = {}) {
  const services = moduleRoot || path.join(clientDir, 'electron', 'services');
  const { createPiSession } = require(path.join(services, 'pi', 'piSessionFactory.cjs'));
  const { preparePiEnvironment } = require(path.join(services, 'pi', 'piEnvironment.cjs'));
  const { createAgentOpenAiProxy } = require(path.join(services, 'agent', 'agentOpenAiProxy.cjs'));
  const { createPiRuntimeService } = require(path.join(services, 'pi', 'piRuntimeService.cjs'));
  fs.mkdirSync(parentDir, { recursive: true });
  const root = fs.mkdtempSync(path.join(parentDir, '隔离-'));
  const app = electronApp || { isPackaged: false, getVersion: () => require('../package.json').version,
    getAppPath: () => clientDir, getPath: (key) => key === 'exe' ? process.execPath : path.join(root, 'userData') };
  const requests = [];
  const sockets = new Set();
  const supplier = http.createServer(async (req, res) => {
    let source = '';
    for await (const chunk of req) source += chunk;
    const body = JSON.parse(source || '{}');
    requests.push({ body, path: req.url, authorized: req.headers.authorization === 'Bearer pi-upgrade-synthetic-token' });
    try { await (fixture.handler || (() => ({ text: '合成回答' })))(body, res, requests.length); }
    catch (error) { if (!res.writableEnded) respond(res, body, { status: 500, error: error.message }); }
  });
  supplier.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  supplier.listen(0, '127.0.0.1');
  await once(supplier, 'listening');
  const config = { api_key: 'pi-upgrade-synthetic-token', base_url: `http://127.0.0.1:${supplier.address().port}/v1`, model_name: '合成模型',
    context_length_limit: 400000, concurrency_limit: 1, developer_mode: false, text_model_provider: 'custom', request_mode: 'stream',
    agent: { runtime: 'pi' } };
  const configStore = { load: () => config, save: (value) => Object.assign(config, value) };
  const diagnostics = { events: [], record(event, meta) { this.events.push({ event, meta }); } };
  const proxy = createAgentOpenAiProxy({ app, configStore, runtime: { id: 'pi', displayName: 'Pi Agent' }, timeoutMs: 15000, diagnostics, verifyLoopback: true });
  const proxyInfo = await proxy.start();
  const environment = preparePiEnvironment(app);
  const sessions = [];
  const runtimes = [];
  const fixture = { root, app, config, configStore, requests, diagnostics, proxy, proxyInfo, environment, handler: null,
    async session(options = {}) {
      const created = await createPiSession({ workspaceDir: environment.layout.workspaceDir, environment, proxyInfo, config, timeoutMs: 15000,
        jsonValidationSchemas: { '结果.json': schema }, requestedThinkingLevel: options.mode === 'conversation' ? 'high' : 'off', ...options });
      sessions.push(created.session);
      return created;
    },
    runtime(options = {}) {
      const events = [];
      const runtime = createPiRuntimeService({ app, configStore, aiService: {}, analyticsService: { trackEvent() {} },
        isMonitorActive: () => true, onMonitorEvent: (event) => events.push(event), ...options });
      runtimes.push(runtime);
      return { runtime, events };
    },
    async close() {
      for (const runtime of runtimes) await runtime.close();
      for (const session of sessions) { await session.abort(); session.dispose(); }
      await proxy.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => supplier.close(resolve));
      fs.writeFileSync(path.join(root, '请求摘要.json'), JSON.stringify(requests.map(({ body, path: route, authorized }) => ({
        route, authorized, model: body.model, stream: body.stream, message_roles: body.messages?.map((message) => message.role),
        tool_names: body.tools?.map((tool) => tool.function?.name), reasoning_effort: body.reasoning_effort,
      })), null, 2), 'utf8');
    },
  };
  fixture.handler = async (body, res, index) => {
    const result = await (handler || (() => ({ text: '合成回答' })))(body, res, index);
    if (result && !res.writableEnded) respond(res, body, result);
  };
  return fixture;
}

function toolChain(body) {
  const last = body.messages.at(-1);
  if (last?.role !== 'tool') return { calls: [call('read', { path: '输入 中文.txt' }, '读取')] };
  if (last.tool_call_id === '读取') return { calls: [call('bash', { command: 'node -e "console.log(process.versions.node)"' }, '命令')] };
  if (last.tool_call_id === '命令') return { calls: [call('write', { path: '结果.json', content: '{"ok":true}' }, '写入')] };
  if (last.tool_call_id === '写入') return { calls: [call('json-validation', { file_path: '结果.json' }, '校验')] };
  return { text: '合成工具链完成' };
}

async function normalScenario(fixture) {
  const { runtime, events } = fixture.runtime();
  const result = await runtime.runTask({ title: '合成离线任务', files: [{ path: '输入 中文.txt', content: '合成资料' }], output_file: '结果.json',
    json_validation_schemas: { '结果.json': schema }, max_retries: 0,
    validateOutput(candidate) { assert.deepEqual(JSON.parse(candidate.output_content), { ok: true }); } });
  assert.equal(result.runtime_id, 'pi');
  assert.deepEqual(JSON.parse(result.output_content), { ok: true });
  assert.equal(events.filter((event) => event.type === 'task_end').length, 1);
  assert.equal(result.diagnostics.session.sdk_version, '1.0.0');
  assert.equal(result.diagnostics.session.pi_ai_version, '1.0.0');
  const completed = result.diagnostics.events.filter((event) => event.event === 'pi.tool.end' && event.meta?.is_error === false).map((event) => event.meta.tool);
  assert.deepEqual(completed, ['read', 'bash', 'write', 'json-validation']);
  return { result, events };
}

module.exports = { call, clientDir, createFixture, delay, loadPiModules, normalScenario, respond, schema, toolChain };
