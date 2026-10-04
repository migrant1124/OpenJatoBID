const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createConversationReadOnlyTools } = require('../electron/services/pi/piSessionFactory.cjs');
const { validatePiSessionSnapshot } = require('../electron/services/pi/piSelfCheckService.cjs');
const { call, createFixture, delay, loadPiModules, normalScenario, schema, toolChain } = require('./pi-upgrade-fixture.cjs');

async function fixture(t, options) { const value = await createFixture(options); t.after(() => value.close()); return value; }
const limits = { timeout: 60000 };
const deadline = setTimeout(() => { console.error('Pi 离线回归超过总时限'); process.exit(1); }, 180000);
deadline.unref();

test('T05—T10：真实 SDK/Proxy 与四工具链、最终产物和自检快照', limits, async (t) => {
  const f = await fixture(t, { handler: toolChain });
  const { result } = await normalScenario(f);
  assert.deepEqual(validatePiSessionSnapshot(result.diagnostics.session), { resourcesValid: true, toolsValid: true, configurationValid: true });
  assert.ok(f.requests.every((request) => request.authorized && request.body.model === '合成模型'));
  assert.ok(f.diagnostics.events.some((event) => event.event === 'proxy.http.received'));
});

test('T05：首次 SDK 导入失败保留错误，下一次重新加载真实发布包', limits, () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    let blocked = true;
    const hooks = require('node:module').registerHooks({ resolve(name, context, next) {
      if (name === '@earendil-works/pi-ai' && blocked) { blocked = false; throw new Error('合成首次 SDK 导入失败'); }
      return next(name, context);
    } });
    const { loadPiModules } = require('./electron/services/pi/piSessionFactory.cjs');
    (async () => {
      await assert.rejects(loadPiModules(), /合成首次 SDK 导入失败/);
      hooks.deregister();
      const loaded = await loadPiModules();
      assert.equal(loaded.codingAgent.VERSION, '1.0.0'); assert.equal(loaded.piAiVersion, '1.0.0');
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], { cwd: require('./pi-upgrade-fixture.cjs').clientDir, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
});

test('T06—T09：真实模式白名单、哨兵资源、有效思考与缓存计时器关闭', limits, async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'AGENTS.md'), '禁止加载祖先哨兵', 'utf8');
  for (const relative of ['AGENTS.md', 'CLAUDE.md', '.pi/skills/外部/SKILL.md', '.agents/skills/外部/SKILL.md', '.pi/agent/APPEND_SYSTEM.md']) {
    const target = path.join(f.environment.layout.workspaceDir, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '禁止加载哨兵', 'utf8');
  }
  fs.writeFileSync(path.join(f.environment.layout.agentDir, 'settings.json'), JSON.stringify({ defaultTools: ['bash'], cacheWarming: 'streaming' }), 'utf8');
  const extensionDir = path.join(f.environment.layout.agentDir, 'extensions'); fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, '外部.js'), 'export default function(){globalThis.外部扩展已执行=true}', 'utf8');
  for (const relative of ['AGENTS.md', 'skills/外部/SKILL.md', 'prompts/外部.md', 'themes/外部.json']) {
    const target = path.join(f.environment.layout.agentDir, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '禁止加载全局哨兵', 'utf8');
  }
  const task = await f.session(); const conversation = await f.session({ mode: 'conversation' });
  assert.deepEqual(new Set(task.session.getActiveToolNames()), new Set(['read', 'bash', 'edit', 'write', 'find', 'ls', 'json-validation', 'ask-user']));
  assert.deepEqual(new Set(conversation.session.getActiveToolNames()), new Set(['read', 'find', 'ls']));
  assert.deepEqual(task.snapshot.extensions, ['<inline:jatobid-retry-error-normalizer>']);
  assert.equal(globalThis.外部扩展已执行, undefined);
  assert.doesNotMatch(task.session.systemPrompt, /禁止加载.*哨兵/);
  assert.deepEqual(task.snapshot.skills, []); assert.deepEqual(task.snapshot.prompts, []);
  assert.equal(conversation.snapshot.effective_thinking_level, conversation.session.thinkingLevel);
  assert.equal(task.snapshot.cache_warming, 'off');
  assert.equal(task.session.settingsManager.getEnableInstallTelemetry(), false);
  assert.equal(task.session.settingsManager.getEnableAnalytics(), false);
  // 直接进入实际 SDK 的 warming 调度入口，检查 off 在计时器创建前终止；不依赖短空闲观察。
  task.session._cacheWarmer.start({ model: { ...task.session.model, provider: 'anthropic', api: 'anthropic-messages', cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    context: { messages: [], systemPrompt: '合成缓存上下文' }, options: { cacheRetention: 'long' } }, () => true);
  assert.deepEqual(task.session.cacheWarmingStatus, { state: 'inactive', reason: 'cache warming disabled' });
  assert.equal(task.session._cacheWarmer.run, undefined);
  await conversation.session.prompt('合成对话');
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.reasoning_effort, 'high');
});

test('T14/T15：真实只读工具执行 Windows 中文、空格、外部路径、前缀相邻与 junction', limits, async (t) => {
  const f = await fixture(t); const { codingAgent } = await loadPiModules(); const root = f.environment.layout.workspaceDir;
  fs.writeFileSync(path.join(root, '资料 中文.txt'), '合成附件正文', 'utf8');
  const outside = `${root}-相邻`; fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, '秘密.txt'), '不可读哨兵', 'utf8');
  fs.symlinkSync(outside, path.join(root, '外链'), process.platform === 'win32' ? 'junction' : 'dir');
  const [read, find, ls] = createConversationReadOnlyTools(codingAgent, root);
  assert.match(JSON.stringify(await read.execute('正常', { path: '资料 中文.txt' })), /合成附件正文/);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(root, '图片 中文.png'), image);
  assert.ok((await read.execute('图片', { path: '图片 中文.png' })).content.some((part) => part.type === 'image'));
  for (const target of [path.join(outside, '秘密.txt'), path.join(root, '..', '秘密.txt'), '外链/秘密.txt']) {
    await assert.rejects(() => read.execute('越界', { path: target }));
  }
  for (const target of [outside, '..', '外链']) {
    await assert.rejects(() => find.execute('查找越界', { path: target, pattern: '**/*' }));
    await assert.rejects(() => ls.execute('列出越界', { path: target }));
  }
});

test('T11/T12/T16：真实工具参数分片、严格 JSON、一次修复与有界失败', limits, async (t) => {
  let writes = 0;
  const f = await fixture(t, { handler(body) {
    if (body.messages.at(-1)?.role === 'tool') return { text: '输出已写入' };
    writes += 1; return { calls: [call('write', { path: '结果.json', content: writes === 1 ? '{"ok":false}' : '{"ok":true}' })] };
  } });
  const { runtime } = f.runtime();
  const payload = { output_file: '结果.json', max_retries: 1, validateOutput(result) { assert.deepEqual(JSON.parse(result.output_content), { ok: true }); } };
  const result = await runtime.runTask(payload); assert.equal(result.retry_count, 1); assert.equal(writes, 2);
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, body.messages.at(-1)?.role === 'tool' ? { text: '仍无效' } : { calls: [call('write', { path: '结果.json', content: '{}' })] });
  const before = f.requests.length; await assert.rejects(() => runtime.runTask(payload)); assert.equal(f.requests.length - before, 4);
  const created = await f.session(); fs.writeFileSync(path.join(f.environment.layout.workspaceDir, '结果.json'), '{}', 'utf8');
  const jsonTool = created.session.agent.state.tools.find((tool) => tool.name === 'json-validation');
  const invalid = await jsonTool.execute('严格校验', { file_path: '结果.json', schema: true });
  assert.equal(invalid.isError, true); assert.equal(invalid.details.stage, 'validation');
});

test('T13/T21：真实 Proxy HTTP 暂时故障、归一化恢复和唯一最终完成', limits, async (t) => {
  let count = 0;
  const f = await fixture(t, { handler(body) { count += 1; return count <= 3 ? { status: 503, error: 'upstream service temporarily unavailable' } : toolChain(body); } });
  const { result, events } = await normalScenario(f);
  assert.ok(result.native_retry_count >= 1);
  assert.equal(events.filter((event) => event.type === 'task_end').length, 1);
  assert.ok(events.findIndex((event) => event.type === 'agent_end') < events.findIndex((event) => event.type === 'auto_retry_start'));
  assert.ok(events.findIndex((event) => event.type === 'task_end') > events.findLastIndex((event) => event.type === 'agent_settled'));
  assert.ok(f.requests.length > 5 && f.requests.length < 15);
});

test('T17/T18：请求与工具取消结算，工作区清理后无迟到写入', limits, async (t) => {
  let started;
  const f = await fixture(t, { handler: () => null }); const { runtime } = f.runtime({ onMonitorEvent(event) { if (event.type === 'tool_start') started?.(); } });
  const controller = new AbortController(); const pending = runtime.runTask({ signal: controller.signal, max_retries: 0 });
  const rejected = assert.rejects(pending, /取消|停止/);
  while (!f.requests.length) await delay(10); controller.abort(new Error('合成取消')); await rejected;
  const toolStarted = new Promise((resolve) => { started = resolve; });
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { calls: [call('bash', { command: 'node -e "setTimeout(()=>require(\'fs\').writeFileSync(\'迟到.txt\',\'错误\'),1500)"' })] });
  const toolsController = new AbortController();
  const toolPending = runtime.runTask({ signal: toolsController.signal, max_retries: 0, onEvent(event) { if (event.type === 'tool_start') started(); } });
  const toolRejected = assert.rejects(toolPending);
  await Promise.race([toolStarted, delay(5000).then(() => { throw new Error('未观察到工具启动'); })]);
  toolsController.abort(new Error('合成工具取消')); await toolRejected;
  await delay(1800);
  assert.equal(fs.existsSync(path.join(f.environment.layout.workspaceDir, '迟到.txt')), false);
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, toolChain(body));
  await normalScenario(f);
});

test('T19：真实 ask-user 回答仅继续一次，取消等待结算', limits, async (t) => {
  let answered = 0;
  const f = await fixture(t, { handler(body) { return body.messages.at(-1)?.role === 'tool' ? { text: '已接收答案' } : { calls: [call('ask-user', { question: '选择合成方案', options: [{ label: '方案一', custom: false }, { label: '方案二', custom: false }] })] }; } });
  const created = await f.session({ requestUserQuestion: async () => { answered += 1; return { label: '方案一' }; } });
  await created.session.prompt('询问用户'); assert.equal(answered, 1); assert.equal(f.requests.length, 2);
  let waiting; const wait = new Promise((resolve) => { waiting = resolve; });
  const cancelled = await f.session({ requestUserQuestion: (_request, signal) => new Promise((_resolve, reject) => {
    waiting(); signal.addEventListener('abort', () => reject(new Error('合成提问取消')), { once: true });
  }) });
  const prompt = cancelled.session.prompt('取消询问'); await wait; await cancelled.session.abort(); await prompt;
  assert.equal(cancelled.session.isIdle, true); assert.equal(f.requests.length, 3);
});

test('T22：真实 Session 连续十次创建/失败/取消/释放，下一任务可用', limits, async (t) => {
  const f = await fixture(t); const settled = [];
  for (let index = 0; index < 10; index += 1) {
    const { session } = await f.session({ mode: 'conversation' }); const events = []; const unsubscribe = session.subscribe((event) => events.push(event.type));
    if (index === 3) { f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { status: 401, error: '合成认证错误' }); }
    else if (index === 6) f.handler = async () => {};
    else f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { text: '连续合成回答' });
    const before = f.requests.length; const pending = session.prompt('连续合成资料');
    if (index === 6) { while (f.requests.length === before) await delay(10); await session.abort(); }
    await pending; await session.abort(); unsubscribe(); session.dispose(); settled.push(events.filter((type) => type === 'agent_settled').length);
    assert.equal(session.isIdle, true);
  }
  assert.ok(settled.every((count) => count === 1));
});

test('T13/T18：真实 429 恢复、认证错误不重试、Pi 重试等待取消', limits, async (t) => {
  let count = 0;
  const f = await fixture(t, { handler() { count += 1; return count === 1 ? { status: 429, error: '合成限流' } : { text: '恢复' }; } });
  const created = await f.session({ mode: 'conversation' }); await created.session.prompt('限流恢复'); assert.equal(count, 2);
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { status: 401, error: '合成认证错误' });
  const before = f.requests.length; const auth = await f.session(); await auth.session.prompt('认证失败');
  assert.equal(f.requests.length - before, 1); assert.equal(auth.session.messages.at(-1).stopReason, 'error');
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { status: 503, error: 'upstream service temporarily unavailable' });
  const retry = await f.session(); let retrying; const waiting = new Promise((resolve) => { retrying = resolve; });
  const unsubscribe = retry.session.subscribe((event) => { if (event.type === 'auto_retry_start') retrying(); });
  const pending = retry.session.prompt('取消重试'); await waiting; const atAbort = f.requests.length; await retry.session.abort(); await pending; unsubscribe();
  await delay(2200); assert.equal(f.requests.length, atAbort); assert.equal(retry.session.isIdle, true);
});

test('T20/T18：真实自动压缩保留关键事实和最新需求，压缩取消结算', limits, async (t) => {
  let first = true;
  let summaries = 0;
  let toolSummaries = 0;
  const toolFact = '工具资料专属事实-丙';
  const f = await fixture(t, { handler(body) {
    if (JSON.stringify(body.messages.find((message) => message.role === 'system')?.content).includes('context summarization assistant')) {
      const input = JSON.stringify(body.messages);
      fs.writeFileSync(path.join(f.root, '压缩输入.json'), input, 'utf8');
      summaries += 1;
      if (input.includes(toolFact)) { toolSummaries += 1; return { text: `合成压缩摘要：${input.match(/工具资料专属事实-丙/)[0]}，关键事实-甲，最新需求-乙。` }; }
      return { text: '合成历史前缀摘要：记录合成历史，继续任务。' };
    }
    if (first) { first = false; return { calls: [call('read', { path: '资料 中文.txt' })] }; }
    return { text: '合成读取已完成' };
  } });
  f.config.context_length_limit = 64000;
  fs.writeFileSync(path.join(f.environment.layout.workspaceDir, '资料 中文.txt'), `${toolFact}\n${'关键事实-甲\n'.repeat(1800)}`, 'utf8');
  const { session } = await f.session(); const events = []; const unsubscribe = session.subscribe((event) => events.push(event));
  const initialHandler = f.handler;
  await session.prompt('读取资料并记录其中的事实');
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { text: `合成历史 ${'synthetic history '.repeat(2000)}` });
  for (let index = 0; index < 3; index += 1) await session.prompt('记录合成历史');
  f.handler = async (body, res) => {
    if (JSON.stringify(body.messages.find((message) => message.role === 'system')?.content).includes('context summarization assistant')) await initialHandler(body, res);
    else require('./pi-upgrade-fixture.cjs').respond(res, body, { text: '合成阶段完成', usage: { prompt_tokens: 56000, completion_tokens: 10, total_tokens: 56010 } });
  };
  await session.prompt('最新需求-乙，请继续任务');
  f.handler = initialHandler;
  await session.prompt('继续');
  fs.writeFileSync(path.join(f.root, '压缩诊断.json'), JSON.stringify({ events: events.map((event) => ({ type: event.type, reason: event.reason, errorMessage: event.errorMessage })),
    model: session.model, messages: session.messages, requests: f.requests.map((request) => request.body) }, null, 2), 'utf8');
  assert.ok(events.some((event) => event.type === 'compaction_start' && event.reason === 'threshold'));
  assert.ok(events.some((event) => event.type === 'compaction_end' && event.result && !event.errorMessage));
  assert.ok(summaries > 0);
  assert.ok(toolSummaries > 0);
  const final = JSON.stringify(f.requests.at(-1).body.messages); assert.match(final, /关键事实-甲/); assert.match(final, /最新需求-乙/); assert.match(final, /工具资料专属事实-丙/);
  assert.ok(!f.requests.at(-1).body.messages.some((message) => message.role === 'tool' && JSON.stringify(message).includes(toolFact)));
  unsubscribe();
  let compacting; const waiting = new Promise((resolve) => { compacting = resolve; });
  f.handler = async (body, res) => {
    if (JSON.stringify(body.messages.find((message) => message.role === 'system')?.content).includes('context summarization assistant')) { compacting(); return; }
    require('./pi-upgrade-fixture.cjs').respond(res, body, { text: `新的合成上下文 ${'synthetic history '.repeat(2000)}` });
  };
  for (let index = 0; index < 3; index += 1) await session.prompt('追加合成上下文');
  const pending = session.compact('保留关键事实');
  const outcome = pending.then(() => '完成', () => '取消');
  await Promise.race([waiting, pending.then(() => { throw new Error('压缩未进入供应商'); }), delay(5000).then(() => { throw new Error('压缩请求未开始'); })]);
  await session.abort(); await outcome;
  assert.equal(session.isIdle, true);
});

test('T17/T19：真实 Agent coordinator 排队取消、提问失效和下一任务', limits, async (t) => {
  const f = await fixture(t, { handler: () => null });
  const { createAgentService } = require('../electron/services/agentService.cjs');
  const agent = createAgentService({ app: f.app, configStore: f.configStore, aiService: {}, analyticsService: { trackEvent() {} } }); t.after(() => agent.close());
  const firstController = new AbortController(); const queuedController = new AbortController();
  const firstTask = agent.runTask({ mode: 'conversation', signal: firstController.signal, max_retries: 0 }); const firstRejected = assert.rejects(firstTask);
  while (!f.requests.length) await delay(10);
  const queued = agent.runTask({ mode: 'conversation', signal: queuedController.signal }); const queuedRejected = assert.rejects(queued);
  queuedController.abort(new Error('排队合成取消')); await queuedRejected; firstController.abort(new Error('请求合成取消')); await firstRejected;
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { text: '下一任务正常' });
  const next = await agent.runTask({ mode: 'conversation', max_retries: 0 }); assert.match(next.assistant_text, /下一任务正常/); assert.equal(agent.getStatus().queued_count, 0);
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, { calls: [call('ask-user', { question: '合成选项', options: [{ label: '甲', custom: false }, { label: '乙', custom: false }] })] });
  let question; const awaiting = new Promise((resolve) => { question = resolve; }); const off = agent.onQuestion((event) => { if (event?.question) question(event); });
  const questionController = new AbortController(); const task = agent.runTask({ signal: questionController.signal, max_retries: 0 }); const questionRejected = assert.rejects(task);
  await awaiting; assert.ok(agent.getPendingQuestion()); questionController.abort(new Error('合成问题取消')); await questionRejected; off();
  assert.equal(agent.getPendingQuestion(), null);
  const expired = await awaiting;
  assert.throws(() => agent.answerQuestion({ question_id: expired.question_id, option_id: expired.options[0].id }), /失效/);
  let answeredQuestion;
  const answerReady = new Promise((resolve) => { answeredQuestion = resolve; });
  const offAnswer = agent.onQuestion((event) => { if (event?.question) answeredQuestion(event); });
  f.handler = async (body, res) => require('./pi-upgrade-fixture.cjs').respond(res, body, body.messages.at(-1)?.role === 'tool'
    ? { text: '已接收唯一答案' } : { calls: [call('ask-user', { question: '合成回答', options: [{ label: '甲', custom: false }, { label: '乙', custom: false }] })] });
  const answered = agent.runTask({ max_retries: 0 }); const current = await answerReady;
  const answer = { question_id: current.question_id, option_id: current.options[0].id };
  agent.answerQuestion(answer); assert.throws(() => agent.answerQuestion(answer), /失效/);
  await answered; offAnswer(); assert.equal(agent.getPendingQuestion(), null);
});

test('T14/T16：真实图片输入、同轮多个分片工具的结果 ID 与顺序', limits, async (t) => {
  const f = await fixture(t, { handler(body) { return body.messages.at(-1)?.role === 'tool' ? { text: '合成附件已核对' }
    : { calls: [call('read', { path: '附件 中文.txt' }, '文本'), call('ls', { path: '.' }, '列表')] }; } });
  fs.writeFileSync(path.join(f.environment.layout.workspaceDir, '附件 中文.txt'), '合成附件事实', 'utf8');
  const { session } = await f.session({ mode: 'conversation' });
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=';
  await session.prompt('读取合成附件', { images: [{ type: 'image', mimeType: 'image/png', data }] });
  assert.ok(f.requests[0].body.messages.some((message) => message.content?.some?.((part) => part.type === 'image_url' && part.image_url.url === `data:image/png;base64,${data}`)));
  const messages = f.requests.at(-1).body.messages;
  assert.deepEqual(messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id), ['文本', '列表']);
  assert.deepEqual(messages.find((message) => message.tool_calls)?.tool_calls.map((item) => item.id), ['文本', '列表']);
  assert.match(JSON.stringify(messages), /合成附件事实/);
});

test('T20：真实压缩失败事件可诊断，失败后 Session 可继续', limits, async (t) => {
  const f = await fixture(t, { handler(body) { return JSON.stringify(body.messages.find((message) => message.role === 'system')?.content).includes('context summarization assistant')
    ? { status: 401, error: '合成压缩认证失败' } : { text: `合成关键事实 ${'synthetic history '.repeat(2000)}` }; } });
  const { session } = await f.session(); const events = []; const unsubscribe = session.subscribe((event) => events.push(event));
  for (let index = 0; index < 3; index += 1) await session.prompt('合成长上下文');
  await assert.rejects(() => session.compact('保留合成关键事实'), /401|认证|compaction/i);
  assert.ok(events.some((event) => event.type === 'compaction_end' && event.errorMessage && !event.aborted && !event.result));
  await session.prompt('失败后继续'); assert.equal(session.isIdle, true); unsubscribe();
});

test('T18/T22：运行中关闭真实 runtime 必须等待工具与任务清理结算', limits, async (t) => {
  let started; const toolStarted = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, { handler: () => ({ calls: [call('bash', { command: 'node -e "setTimeout(()=>require(\'fs\').writeFileSync(\'退出迟到.txt\',\'错误\'),1500)"' })] }) });
  const { runtime } = f.runtime({ onMonitorEvent(event) { if (event.type === 'tool_start') started(); } });
  let settled = false;
  const pending = runtime.runTask({ max_retries: 0 }).then(() => { settled = true; throw new Error('关闭不应成功'); }, () => { settled = true; });
  await toolStarted; await runtime.close(); assert.equal(settled, true, 'close 返回必须在任务结算之后');
  await pending; assert.equal(runtime.getStatus().active_task, null); assert.equal(runtime.getStatus().phase, 'stopped');
  await delay(1800); assert.equal(fs.existsSync(path.join(f.environment.layout.workspaceDir, '退出迟到.txt')), false);
});

test('T20/T23：真实 runtime 自动压缩失败保留安全诊断和监视状态', limits, async (t) => {
  let turns = 0;
  const f = await fixture(t, { handler(body) {
    if (JSON.stringify(body.messages.find((message) => message.role === 'system')?.content).includes('context summarization assistant')) return { status: 401, error: '合成敏感哨兵，不应复制到新增压缩诊断' };
    turns += 1;
    if (turns === 1) return { calls: [call('read', { path: '合成资料.txt' })] };
    if (turns < 5) return { text: 'synthetic history '.repeat(2000), calls: [call('read', { path: '合成资料.txt' })] };
    return { text: '合成任务完成', usage: { prompt_tokens: 56000, completion_tokens: 10, total_tokens: 56010 } };
  } });
  f.config.context_length_limit = 64000;
  const { runtime, events } = f.runtime(); const activity = [];
  const result = await runtime.runTask({ prompt: '读取合成资料并完成任务', files: [{ path: '合成资料.txt', content: '合成工具资料' }], max_retries: 0, onActivity: (event) => activity.push(event) });
  const failure = result.diagnostics.events.find((event) => event.event === 'pi.compaction_end' && event.meta?.error);
  assert.equal(failure.meta.reason, 'threshold'); assert.match(failure.meta.error, /压缩失败.*401/);
  const monitor = events.find((event) => event.type === 'compaction_end' && event.is_error);
  assert.equal(monitor.success, false); assert.equal(monitor.result.aborted, false); assert.match(monitor.message, /压缩失败/);
  assert.ok(activity.some((event) => event.source === 'pi.compaction_end' && event.visible && /压缩失败/.test(event.message)));
  assert.doesNotMatch(JSON.stringify({ failure, monitor }), /合成敏感哨兵/);
  assert.equal(events.filter((event) => event.type === 'task_end').length, 1);
});
