const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildOpenCodeConfig } = require('./opencodeConfigFactory.cjs');
const { createOpenCodeRuntimeService } = require('./opencodeRuntimeService.cjs');
const { startOpenCodeSidecar } = require('./opencodeServerRunner.cjs');
const {
  getBundledOpencodeBinaryPath,
  getBundledOpencodeToolsBinDir,
} = require('../../utils/paths.cjs');

test('OpenCode 固定配置禁用插件、MCP、远程 Skill 和外部目录访问', () => {
  const config = buildOpenCodeConfig({
    proxyBaseUrl: 'http://127.0.0.1:43210',
    contextLengthLimit: 200000,
    timeoutMs: 12345,
    instructions: ['C:\\OpenJatoBID\\runtime\\workspace\\AGENTS.md'],
    shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  });

  assert.equal(config.autoupdate, false);
  assert.deepEqual(config.plugin, []);
  assert.deepEqual(config.mcp, {});
  assert.deepEqual(config.skills, { paths: [], urls: [] });
  assert.deepEqual(config.permission, { external_directory: 'deny' });
  assert.equal(config.model, 'yibiao/default');
  assert.equal(config.small_model, 'yibiao/default');
  assert.equal(config.provider.yibiao.name, 'Jato AI BID AI');
  assert.equal(config.provider.yibiao.models.default.name, 'Jato AI BID Current Text Model');
});

test('隔离启动失败只使 Agent Runtime 不可用，不阻止其他客户端服务继续初始化', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-runtime-isolation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let startAttempts = 0;
  let otherServiceInitialized = false;
  const isolationCheck = {
    success: false,
    workspace_dir: path.join(root, 'agent-runtime', 'service', 'workspace'),
    home_dir: path.join(root, 'agent-runtime', 'service', 'home'),
    config_dir: path.join(root, 'agent-runtime', 'service', 'home', '.config', 'opencode'),
    temp_dir: path.join(root, 'agent-runtime', 'service', 'tmp'),
    allowed_roots: [],
    effective_permission: '',
    external_read_denied: false,
    loaded_skills: [],
    violations: ['CLI 预检发现外部 Skill'],
  };
  const runtime = createOpenCodeRuntimeService({
    app: {
      getPath(name) {
        if (name === 'userData') return root;
        throw new Error(`unexpected app path: ${name}`);
      },
      getVersion: () => '1.4.1',
    },
    configStore: { load: () => ({}) },
    analyticsService: { track: async () => undefined },
    startSidecar: async () => {
      startAttempts += 1;
      const error = new Error('OpenCode 逻辑隔离预检失败');
      error.selfCheckStage = 'isolation-check';
      error.isolationCheck = isolationCheck;
      throw error;
    },
  });
  t.after(() => runtime.close());

  otherServiceInitialized = true;
  await assert.rejects(runtime.warmup(), /OpenCode 逻辑隔离预检失败/);
  const status = runtime.getStatus();
  assert.equal(startAttempts, 1);
  assert.equal(status.phase, 'unhealthy');
  assert.equal(status.healthy, false);
  assert.equal(otherServiceInitialized, true);
});

test('CLI 隔离预检失败时不会创建 OpenCode Server 进程', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-sidecar-isolation-'));
  const apiSecret = 'runtime-api-secret-must-not-leak';
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = {
    isPackaged: false,
    getPath(name) {
      if (name === 'userData') return path.join(root, 'user-data');
      throw new Error(`unexpected app path: ${name}`);
    },
    getVersion: () => '1.4.1',
  };
  let spawnCalled = false;
  const isolationCheck = {
    success: false,
    workspace_dir: path.join(root, 'runtime', 'workspace'),
    home_dir: path.join(root, 'runtime', 'home'),
    config_dir: path.join(root, 'runtime', 'home', '.config', 'opencode'),
    temp_dir: path.join(root, 'runtime', 'tmp'),
    allowed_roots: [],
    effective_permission: '',
    external_read_denied: false,
    loaded_skills: [],
    violations: [`OpenCode cache 路径越界 api_key=${apiSecret}`],
  };

  await assert.rejects(
    startOpenCodeSidecar({
      app,
      configStore: { load: () => ({ api_key: apiSecret, context_length_limit: 400000, concurrency_limit: 1 }) },
      runtimeRoot: path.join(root, 'runtime'),
      workspaceDir: path.join(root, 'runtime', 'workspace'),
      timeoutMs: 300000,
      isolationPreflight: async () => {
        const error = new Error(`OpenCode 逻辑隔离预检失败 Authorization: Bearer ${apiSecret}`);
        error.selfCheckStage = 'isolation-check';
        error.isolationCheck = isolationCheck;
        throw error;
      },
      spawnOpenCode: () => {
        spawnCalled = true;
        throw new Error('不应创建 OpenCode Server 进程');
      },
    }),
    (error) => error.selfCheckStage === 'isolation-check'
      && !error.message.includes(apiSecret)
      && !JSON.stringify(error.isolationCheck).includes(apiSecret)
      && JSON.stringify(error.isolationCheck).includes('[REDACTED]'),
  );
  assert.equal(spawnCalled, false);
});

test('打包环境固定使用安装包内 OpenCode 路径，开发环境保留外部覆盖', () => {
  const binaryOverride = path.join(os.tmpdir(), 'external-opencode.exe');
  const toolsOverride = path.join(os.tmpdir(), 'external-opencode-tools');
  const resourcesPath = path.join(os.tmpdir(), 'packaged-resources');
  const previousBinary = process.env.YIBIAO_OPENCODE_BIN;
  const previousTools = process.env.YIBIAO_OPENCODE_TOOLS_BIN_DIR;
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

  try {
    process.env.YIBIAO_OPENCODE_BIN = binaryOverride;
    process.env.YIBIAO_OPENCODE_TOOLS_BIN_DIR = toolsOverride;
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: resourcesPath,
    });

    assert.equal(getBundledOpencodeBinaryPath({ isPackaged: false }), binaryOverride);
    assert.equal(getBundledOpencodeToolsBinDir({ isPackaged: false }), toolsOverride);

    const platformArch = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
    assert.equal(
      getBundledOpencodeBinaryPath({ isPackaged: true }),
      path.join(resourcesPath, 'opencode', platformArch, binaryName),
    );
    assert.equal(
      getBundledOpencodeToolsBinDir({ isPackaged: true }),
      path.join(resourcesPath, 'opencode-tools', platformArch, 'bin'),
    );
  } finally {
    if (previousBinary === undefined) delete process.env.YIBIAO_OPENCODE_BIN;
    else process.env.YIBIAO_OPENCODE_BIN = previousBinary;
    if (previousTools === undefined) delete process.env.YIBIAO_OPENCODE_TOOLS_BIN_DIR;
    else process.env.YIBIAO_OPENCODE_TOOLS_BIN_DIR = previousTools;
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor);
    else delete process.resourcesPath;
  }
});

test('现有 Agent 重试、Analytics 和工作区路径保护在隔离接入后保持有效', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-runtime-regression-'));
  const workspaceDir = path.join(root, 'agent-runtime', 'service', 'workspace');
  const analyticsEvents = [];
  const prompts = [];
  let promptAttempts = 0;
  let sidecarStarts = 0;

  const runtime = createOpenCodeRuntimeService({
    app: {
      getPath(name) {
        if (name === 'userData') return root;
        throw new Error(`unexpected app path: ${name}`);
      },
      getVersion: () => '1.4.1',
    },
    configStore: {
      load: () => ({
        analytics_client_id: 'client-1',
        analytics_created_at: '2026-07-16',
        text_model_provider: 'custom',
        base_url: 'https://models.example.test/v1',
        model_name: 'test-model',
      }),
    },
    analyticsService: {
      async track(payload) {
        analyticsEvents.push(payload);
      },
    },
    startSidecar: async () => {
      sidecarStarts += 1;
      return {
        requestLog: [],
        getRequestLog: () => [],
        getStderrTail: () => '',
        getStdoutTail: () => '',
        close: async () => undefined,
      };
    },
    createSessionRequest: async () => ({ id: 'session-1' }),
    sendPromptRequest: async (_sidecar, _sessionId, prompt) => {
      prompts.push(prompt);
      promptAttempts += 1;
      if (promptAttempts === 1) throw new Error('first attempt failed');
      fs.writeFileSync(path.join(workspaceDir, 'result.md'), 'retry-success', 'utf-8');
      return { parts: [{ type: 'text', text: 'done' }] };
    },
    getSessionDiffRequest: async () => [],
  });
  t.after(async () => {
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = await runtime.runTask({
    task_id: 'retry-regression',
    title: '重试回归',
    files: [{ path: 'input.md', content: 'input' }],
    output_file: 'result.md',
    max_retries: 1,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sidecarStarts, 1);
  assert.equal(result.retry_count, 1);
  assert.equal(result.output_content, 'retry-success');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /第 1\/1 次自动修复机会/);
  assert.ok(analyticsEvents.some((event) => (
    event.event === 'agent_runtime'
    && event.agent_runtime_status === 'success'
    && event.agent_runtime_retry_count === 1
    && event.client_id === 'client-1'
  )));

  await assert.rejects(
    runtime.runTask({
      task_id: 'input-path-regression',
      files: [{ path: '../outside-input.md', content: 'blocked' }],
      output_file: 'result.md',
    }),
    /非法文件路径/,
  );
  await assert.rejects(
    runtime.runTask({
      task_id: 'output-path-regression',
      files: [{ path: 'input.md', content: 'input' }],
      output_file: '../outside-output.md',
    }),
    /非法文件路径/,
  );
  assert.equal(fs.existsSync(path.join(root, 'agent-runtime', 'service', 'outside-input.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'agent-runtime', 'service', 'outside-output.md')), false);
});
