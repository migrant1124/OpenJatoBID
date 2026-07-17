const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const {
  runOpenCodeCliIsolationPreflight,
  verifyOpenCodeServerIsolation,
} = require('./opencodeIsolationService.cjs');
const { buildOpenCodeConfig } = require('./opencodeConfigFactory.cjs');

const TEST_PROXY_BASE_URL = 'http://127.0.0.1:43210';
const TEST_PROXY_TOKEN = 'test-runtime-proxy-token';

function createEnvironmentInfo(rootDir) {
  const runtimeRoot = path.join(rootDir, 'runtime');
  const workspaceDir = path.join(runtimeRoot, 'workspace');
  const homeDir = path.join(runtimeRoot, 'home');
  const configDir = path.join(homeDir, '.config', 'opencode');
  const stateDir = path.join(homeDir, '.local', 'state', 'opencode');
  const skillRoot = path.join(rootDir, 'packaged', 'opencode-skills');
  const toolOutputDir = path.join(homeDir, '.local', 'share', 'opencode', 'tool-output');
  const agentsPath = path.join(workspaceDir, 'AGENTS.md');
  return {
    layout: {
      runtimeRoot,
      workspaceDir,
      homeDir,
      configDir,
      stateDir,
      tempDir: path.join(runtimeRoot, 'tmp'),
    },
    toolEnvironment: { agentsPath },
    shellPath: process.platform === 'win32' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : '/bin/sh',
    allowedRoots: [runtimeRoot, skillRoot],
    skillRoots: [skillRoot],
    mutableRoots: [runtimeRoot],
    permissionExceptionRoots: [toolOutputDir],
  };
}

function createExpectedConfig(environmentInfo) {
  return buildOpenCodeConfig({
    proxyBaseUrl: TEST_PROXY_BASE_URL,
    contextLengthLimit: 200000,
    timeoutMs: 12345,
    instructions: [environmentInfo.toolEnvironment.agentsPath],
    shell: environmentInfo.shellPath,
  });
}

function createEffectiveConfig(environmentInfo) {
  const config = structuredClone(createExpectedConfig(environmentInfo));
  config.provider.yibiao.options.apiKey = TEST_PROXY_TOKEN;
  return config;
}

function verifyServerIsolation(baseUrl, environmentInfo) {
  return verifyOpenCodeServerIsolation({
    server: { baseUrl, authHeader: 'Basic test' },
    environmentInfo,
    expectedConfig: createExpectedConfig(environmentInfo),
    expectedProxyToken: TEST_PROXY_TOKEN,
  });
}

function debugPaths(environmentInfo, overrides = {}) {
  const { layout } = environmentInfo;
  return {
    home: layout.homeDir,
    data: path.join(layout.runtimeRoot, 'data'),
    bin: path.join(layout.runtimeRoot, 'bin'),
    log: path.join(layout.runtimeRoot, 'log'),
    repos: path.join(layout.runtimeRoot, 'repos'),
    cache: path.join(layout.runtimeRoot, 'cache'),
    config: layout.configDir,
    state: layout.stateDir,
    tmp: layout.tempDir,
    ...overrides,
  };
}

function serializeDebugPaths(values) {
  return Object.entries(values).map(([key, value]) => `${key} ${value}`).join('\n');
}

async function withJsonServer(routes, callback) {
  const server = http.createServer((request, response) => {
    const value = routes[request.url];
    response.writeHead(value === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value ?? { error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('CLI 预检接受隔离路径和内置 Skill，拒绝外部路径与外部 Skill', async () => {
  const environmentInfo = createEnvironmentInfo(path.resolve('C:\\OpenJatoBID-test'));
  const validPaths = debugPaths(environmentInfo);
  const packagedSkill = path.join(environmentInfo.skillRoots[0], 'builtin', 'SKILL.md');
  const runCli = async (_binary, args) => args[1] === 'paths'
    ? { stdout: serializeDebugPaths(validPaths), stderr: '' }
    : { stdout: JSON.stringify([{ name: 'builtin', location: packagedSkill }]), stderr: '' };

  const result = await runOpenCodeCliIsolationPreflight({
    opencodeBin: 'opencode',
    workspaceDir: environmentInfo.layout.workspaceDir,
    env: {},
    environmentInfo,
    runCli,
  });
  assert.equal(result.skills[0].location, packagedSkill);

  await assert.rejects(
    runOpenCodeCliIsolationPreflight({
      opencodeBin: 'opencode',
      workspaceDir: environmentInfo.layout.workspaceDir,
      env: {},
      environmentInfo,
      runCli: async (_binary, args) => args[1] === 'paths'
        ? { stdout: serializeDebugPaths(debugPaths(environmentInfo, { cache: path.resolve('C:\\Users\\Employee\\.cache\\opencode') })), stderr: '' }
        : { stdout: JSON.stringify([{ name: 'external', location: path.resolve('C:\\Users\\Employee\\.config\\opencode\\skills\\external') }]), stderr: '' },
    }),
    (error) => error.selfCheckStage === 'isolation-check'
      && error.isolationCheck.violations.some((item) => item.includes('路径越界'))
      && error.isolationCheck.violations.some((item) => item.includes('允许目录之外的 Skill')),
  );
});

test('Server 复核接受固定配置并拒绝插件、MCP、远程 Skill、Provider 污染和越界权限', async () => {
  const environmentInfo = createEnvironmentInfo(path.resolve('C:\\OpenJatoBID-server-test'));
  const packagedSkill = path.join(environmentInfo.skillRoots[0], 'builtin', 'SKILL.md');
  const baseRoutes = {
    '/path': {
      directory: environmentInfo.layout.workspaceDir,
      worktree: environmentInfo.layout.workspaceDir,
      home: environmentInfo.layout.homeDir,
      config: environmentInfo.layout.configDir,
      state: environmentInfo.layout.stateDir,
    },
    '/config': {
      ...createEffectiveConfig(environmentInfo),
      plugin_origins: [],
    },
    '/skill': [{ name: 'builtin', location: packagedSkill }],
    '/agent': [{
      name: 'default',
      permission: [
        { permission: 'external_directory', pattern: '*', action: 'deny' },
        { permission: 'external_directory', pattern: environmentInfo.permissionExceptionRoots[0], action: 'allow' },
      ],
    }],
  };

  await withJsonServer(baseRoutes, async (baseUrl) => {
    const check = await verifyServerIsolation(baseUrl, environmentInfo);
    assert.equal(check.success, true);
    assert.equal(check.external_read_denied, true);
    assert.deepEqual(check.loaded_skills, [{ name: 'builtin', location: packagedSkill }]);
  });

  const configWithoutEmptyPluginOrigins = { ...baseRoutes['/config'] };
  delete configWithoutEmptyPluginOrigins.plugin_origins;
  await withJsonServer({ ...baseRoutes, '/config': configWithoutEmptyPluginOrigins }, async (baseUrl) => {
    const check = await verifyServerIsolation(baseUrl, environmentInfo);
    assert.equal(check.success, true);
  });

  const pollutedRoutes = {
    ...baseRoutes,
    '/config': {
      ...baseRoutes['/config'],
      plugin: ['employee-plugin'],
      mcp: { employee: {} },
      skills: { paths: [], urls: ['https://example.com/skill.md'] },
      provider: { employee: {} },
    },
    '/skill': [{ name: 'employee', location: path.resolve('C:\\Users\\Employee\\.opencode\\skills\\employee') }],
    '/agent': [{
      name: 'default',
      permission: [
        { permission: 'external_directory', pattern: '*', action: 'deny' },
        { permission: 'external_directory', pattern: path.resolve('C:\\Users\\Employee'), action: 'allow' },
      ],
    }],
  };
  await withJsonServer(pollutedRoutes, async (baseUrl) => {
    await assert.rejects(
      verifyServerIsolation(baseUrl, environmentInfo),
      (error) => {
        const violations = error.isolationCheck?.violations || [];
        return error.selfCheckStage === 'isolation-check'
          && violations.some((item) => item.includes('插件'))
          && violations.some((item) => item.includes('MCP'))
          && violations.some((item) => item.includes('远程 Skill'))
          && violations.some((item) => item.includes('Provider'))
          && violations.some((item) => item.includes('允许目录之外的 Skill'))
          && violations.some((item) => item.includes('* deny 后存在越界规则'));
      },
    );
  });
});

test('Server 复核逐项校验本次写入的模型配置且不回显敏感值', async () => {
  const environmentInfo = createEnvironmentInfo(path.resolve('C:\\OpenJatoBID-config-drift-test'));
  const attackerApiKey = 'attacker-api-key-must-not-leak';
  const effectiveConfig = createEffectiveConfig(environmentInfo);
  effectiveConfig.autoupdate = true;
  effectiveConfig.model = 'external/large';
  effectiveConfig.small_model = 'external/small';
  effectiveConfig.provider.yibiao.npm = '@ai-sdk/openai';
  effectiveConfig.provider.yibiao.options = {
    baseURL: 'https://external.example/v1',
    apiKey: attackerApiKey,
    timeout: 999,
  };
  effectiveConfig.provider.yibiao.models = {
    default: {
      name: 'External model',
      limit: { context: 4096, output: 1024 },
    },
    extra: {},
  };

  const routes = {
    '/path': {
      directory: environmentInfo.layout.workspaceDir,
      worktree: environmentInfo.layout.workspaceDir,
      home: environmentInfo.layout.homeDir,
      config: environmentInfo.layout.configDir,
      state: environmentInfo.layout.stateDir,
    },
    '/config': effectiveConfig,
    '/skill': [],
    '/agent': [{
      name: 'default',
      permission: [{ permission: 'external_directory', pattern: '*', action: 'deny' }],
    }],
  };

  await withJsonServer(routes, async (baseUrl) => {
    await assert.rejects(
      verifyServerIsolation(baseUrl, environmentInfo),
      (error) => {
        const violations = error.isolationCheck?.violations || [];
        const details = `${error.message}\n${violations.join('\n')}`;
        return error.selfCheckStage === 'isolation-check'
          && violations.some((item) => item.includes('autoupdate'))
          && violations.some((item) => item.includes('npm'))
          && violations.some((item) => item.includes('baseURL'))
          && violations.some((item) => item.includes('apiKey'))
          && violations.some((item) => item.includes('timeout'))
          && violations.some((item) => item.includes('models'))
          && violations.some((item) => item.includes('contextLength'))
          && violations.some((item) => item.includes('model/small_model'))
          && !details.includes(attackerApiKey);
      },
    );
  });
});

test('Server 复核对畸形配置集合、Skill 和 Agent 响应 fail-closed', async () => {
  const environmentInfo = createEnvironmentInfo(path.resolve('C:\\OpenJatoBID-malformed-test'));
  const baseRoutes = {
    '/path': {
      directory: environmentInfo.layout.workspaceDir,
      worktree: environmentInfo.layout.workspaceDir,
      home: environmentInfo.layout.homeDir,
      config: environmentInfo.layout.configDir,
      state: environmentInfo.layout.stateDir,
    },
    '/config': {
      ...createEffectiveConfig(environmentInfo),
      plugin_origins: [],
    },
    '/skill': [],
    '/agent': [{
      name: 'default',
      permission: [{ permission: 'external_directory', pattern: '*', action: 'deny' }],
    }],
  };
  const cases = [
    {
      label: '最终插件',
      routes: { '/config': { ...baseRoutes['/config'], plugin: 'employee-plugin' } },
    },
    {
      label: '最终插件来源',
      routes: { '/config': { ...baseRoutes['/config'], plugin_origins: { employee: true } } },
    },
    {
      label: '最终 Skill 路径',
      routes: { '/config': { ...baseRoutes['/config'], skills: { paths: 'C:\\Users\\Employee\\skill', urls: [] } } },
    },
    {
      label: '最终远程 Skill',
      routes: { '/config': { ...baseRoutes['/config'], skills: { paths: [], urls: 'https://example.com/skill.md' } } },
    },
    {
      label: 'MCP',
      routes: { '/config': { ...baseRoutes['/config'], mcp: [] } },
    },
    {
      label: 'Skill 响应',
      routes: { '/skill': { name: 'employee', location: 'C:\\Users\\Employee\\external-skill' } },
    },
    {
      label: 'Agent 响应',
      routes: { '/agent': { default: { permission: [] } } },
    },
  ];

  for (const item of cases) {
    await withJsonServer({ ...baseRoutes, ...item.routes }, async (baseUrl) => {
      await assert.rejects(
        verifyServerIsolation(baseUrl, environmentInfo),
        (error) => error.selfCheckStage === 'isolation-check'
          && (error.isolationCheck?.violations || []).some((violation) => violation.includes(item.label)),
        `${item.label} 畸形响应必须导致隔离复核失败`,
      );
    });
  }
});

test('Server 复核拒绝工作目录、HOME、Config、State 越界以及缺少全局拒绝规则', async () => {
  const environmentInfo = createEnvironmentInfo(path.resolve('C:\\OpenJatoBID-path-test'));
  const routes = {
    '/path': {
      directory: path.resolve('C:\\Users\\Employee\\project'),
      worktree: path.resolve('C:\\Users\\Employee\\project'),
      home: path.resolve('C:\\Users\\Employee'),
      config: path.resolve('C:\\Users\\Employee\\.config\\opencode'),
      state: path.resolve('C:\\Users\\Employee\\.local\\state\\opencode'),
    },
    '/config': {
      ...createEffectiveConfig(environmentInfo),
      plugin_origins: [],
    },
    '/skill': [],
    '/agent': [{ name: 'default', permission: [] }],
  };

  await withJsonServer(routes, async (baseUrl) => {
    await assert.rejects(
      verifyServerIsolation(baseUrl, environmentInfo),
      (error) => {
        const violations = error.isolationCheck?.violations || [];
        return violations.some((item) => item.includes('工作目录越界'))
          && violations.some((item) => item.includes('工作树越界'))
          && violations.some((item) => item.includes('Server HOME 不符合预期'))
          && violations.some((item) => item.includes('Server 配置目录不符合预期'))
          && violations.some((item) => item.includes('Server 状态目录不符合预期'))
          && violations.some((item) => item.includes('缺少 external_directory * deny'));
      },
    );
  });
});
