const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  getOpenCodeAgents,
  getOpenCodeConfig,
  getOpenCodePath,
  getOpenCodeSkills,
} = require('./opencodeHttpClient.cjs');
const { isPathInsideAnyRoot } = require('./opencodeEnvironment.cjs');

const ISOLATION_CHECK_TIMEOUT_MS = 15 * 1000;

function normalizePath(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return Boolean(left && right && normalizePath(left) === normalizePath(right));
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function summarizeSkills(skills) {
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    name: String(skill?.name || ''),
    ...(skill?.location ? { location: String(skill.location) } : {}),
  }));
}

function validateSkills(skills, allowedRoots, violations, source) {
  if (!Array.isArray(skills)) {
    violations.push(`${source} Skill 响应类型无效，应为数组`);
    return;
  }
  skills.forEach((rawSkill, index) => {
    if (!isObjectRecord(rawSkill)) {
      violations.push(`${source} Skill 第 ${index + 1} 项类型无效，应为对象`);
      return;
    }
    if (typeof rawSkill.name !== 'string' || !rawSkill.name.trim()) {
      violations.push(`${source} Skill 第 ${index + 1} 项缺少有效名称`);
    }
    if (rawSkill.location !== undefined && rawSkill.location !== null && typeof rawSkill.location !== 'string') {
      violations.push(`${source} Skill ${rawSkill.name || index + 1} 的位置类型无效`);
      return;
    }
    const skill = summarizeSkills([rawSkill])[0];
    if (!skill.location || skill.location === '<built-in>') return;
    if (isPathInsideAnyRoot(allowedRoots, skill.location)) return;
    violations.push(`${source}加载了允许目录之外的 Skill：${skill.name || '未命名'}（${skill.location}）`);
  });
}

function createIsolationCheck(environmentInfo, overrides = {}) {
  const { layout } = environmentInfo;
  return {
    success: false,
    workspace_dir: layout.workspaceDir,
    home_dir: layout.homeDir,
    config_dir: layout.configDir,
    temp_dir: layout.tempDir,
    allowed_roots: [...environmentInfo.allowedRoots],
    effective_permission: '',
    external_read_denied: false,
    loaded_skills: [],
    violations: [],
    ...overrides,
  };
}

function createIsolationError(message, isolationCheck) {
  const error = new Error(message);
  error.selfCheckStage = 'isolation-check';
  error.isolationCheck = isolationCheck;
  return error;
}

function runOpenCodeCli(opencodeBin, args, options) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(opencodeBin, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`OpenCode 逻辑隔离预检超时：${args.join(' ')}`));
    }, options.timeoutMs || ISOLATION_CHECK_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`OpenCode 逻辑隔离预检无法启动：${error?.message || String(error)}`));
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`OpenCode 逻辑隔离预检失败：${args.join(' ')}，code=${code ?? 'null'}，signal=${signal || 'null'}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseDebugPaths(output) {
  const result = {};
  String(output || '').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^(\S+)\s+(.+?)\s*$/);
    if (match) result[match[1]] = match[2];
  });
  return result;
}

function parseDebugSkills(output) {
  try {
    const value = JSON.parse(String(output || '').trim() || '[]');
    if (!Array.isArray(value)) throw new Error('返回值不是数组');
    return value;
  } catch (error) {
    throw new Error(`无法解析 opencode debug skill 输出：${error?.message || String(error)}`);
  }
}

async function runOpenCodeCliIsolationPreflight({
  opencodeBin,
  workspaceDir,
  env,
  environmentInfo,
  runCli = runOpenCodeCli,
}) {
  const isolationCheck = createIsolationCheck(environmentInfo);
  try {
    const pathsResult = await runCli(
      opencodeBin,
      ['debug', 'paths', '--pure'],
      { cwd: workspaceDir, env, timeoutMs: ISOLATION_CHECK_TIMEOUT_MS },
    );
    const skillsResult = await runCli(
      opencodeBin,
      ['debug', 'skill', '--pure'],
      { cwd: workspaceDir, env, timeoutMs: ISOLATION_CHECK_TIMEOUT_MS },
    );
    const debugPaths = parseDebugPaths(pathsResult.stdout);
    const requiredPaths = ['home', 'data', 'bin', 'log', 'repos', 'cache', 'config', 'state', 'tmp'];
    requiredPaths.forEach((key) => {
      const value = debugPaths[key];
      if (!value) {
        isolationCheck.violations.push(`opencode debug paths 缺少 ${key} 路径`);
        return;
      }
      if (!isPathInsideAnyRoot(environmentInfo.mutableRoots, value)) {
        isolationCheck.violations.push(`OpenCode ${key} 路径越界：${value}`);
      }
    });
    if (debugPaths.home && !samePath(debugPaths.home, environmentInfo.layout.homeDir)) {
      isolationCheck.violations.push(`OpenCode HOME 不符合预期：${debugPaths.home}`);
    }
    if (debugPaths.config && !samePath(debugPaths.config, environmentInfo.layout.configDir)) {
      isolationCheck.violations.push(`OpenCode 配置目录不符合预期：${debugPaths.config}`);
    }

    const skills = parseDebugSkills(skillsResult.stdout);
    isolationCheck.loaded_skills = summarizeSkills(skills);
    validateSkills(skills, environmentInfo.skillRoots, isolationCheck.violations, 'CLI 预检');
    if (isolationCheck.violations.length) {
      throw createIsolationError(`OpenCode 逻辑隔离预检失败：${isolationCheck.violations.join('；')}`, isolationCheck);
    }
    return { debugPaths, skills: isolationCheck.loaded_skills };
  } catch (error) {
    if (error?.isolationCheck) throw error;
    isolationCheck.violations.push(error?.message || String(error));
    throw createIsolationError(`OpenCode 逻辑隔离预检失败：${error?.message || String(error)}`, isolationCheck);
  }
}

function getExternalDirectoryPermission(config) {
  const value = config?.permission?.external_directory;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String(value['*'] || '');
  return '';
}

function validateEmptyObject(value, label, violations) {
  if (!isObjectRecord(value)) {
    violations.push(`${label}类型无效，应为空对象`);
    return;
  }
  if (Object.keys(value).length) {
    violations.push(`${label}包含未授权配置：${Object.keys(value).join('、')}`);
  }
}

function validateEmptyArray(value, label, violations, options = {}) {
  if (value === undefined && options.allowMissing) return;
  if (!Array.isArray(value)) {
    violations.push(`${label}类型无效，应为空数组`);
    return;
  }
  if (value.length) {
    violations.push(`${label}包含未授权配置`);
  }
}

function addConfigMismatch(violations, field) {
  violations.push(`OpenCode 最终配置 ${field} 与本次写入值不一致`);
}

function validateExpectedProviderConfig(config, expectedConfig, expectedProxyToken, violations) {
  if (!isObjectRecord(expectedConfig)) {
    violations.push('OpenCode Server 复核缺少本次实际写入的 expected config');
    return;
  }

  if (config.autoupdate !== expectedConfig.autoupdate) {
    addConfigMismatch(violations, 'autoupdate');
  }

  const provider = config.provider;
  const expectedProvider = expectedConfig.provider;
  if (!isObjectRecord(provider) || !isObjectRecord(expectedProvider)) {
    violations.push('最终 Provider 配置类型无效，应为对象');
    return;
  }

  const providerIds = Object.keys(provider).sort();
  const expectedProviderIds = Object.keys(expectedProvider).sort();
  if (providerIds.length !== expectedProviderIds.length
    || providerIds.some((providerId, index) => providerId !== expectedProviderIds[index])) {
    violations.push('最终 Provider 配置受到外部污染');
    return;
  }

  const actualYibiao = provider.yibiao;
  const expectedYibiao = expectedProvider.yibiao;
  if (!isObjectRecord(actualYibiao) || !isObjectRecord(expectedYibiao)) {
    violations.push('最终 provider.yibiao 配置类型无效，应为对象');
    return;
  }

  if (actualYibiao.npm !== expectedYibiao.npm) addConfigMismatch(violations, 'provider.yibiao.npm');
  if (actualYibiao.name !== expectedYibiao.name) addConfigMismatch(violations, 'provider.yibiao.name');

  const actualOptions = actualYibiao.options;
  const expectedOptions = expectedYibiao.options;
  if (!isObjectRecord(actualOptions) || !isObjectRecord(expectedOptions)) {
    violations.push('最终 provider.yibiao.options 配置类型无效，应为对象');
  } else {
    if (actualOptions.baseURL !== expectedOptions.baseURL) {
      addConfigMismatch(violations, 'provider.yibiao.options.baseURL');
    }
    const acceptedApiKeys = new Set([
      expectedOptions.apiKey,
      expectedProxyToken,
    ].filter((value) => typeof value === 'string' && value));
    if (typeof actualOptions.apiKey !== 'string' || !acceptedApiKeys.has(actualOptions.apiKey)) {
      addConfigMismatch(violations, 'provider.yibiao.options.apiKey');
    }
    if (actualOptions.timeout !== expectedOptions.timeout) {
      addConfigMismatch(violations, 'provider.yibiao.options.timeout');
    }
  }

  const actualModels = actualYibiao.models;
  const expectedModels = expectedYibiao.models;
  if (!isObjectRecord(actualModels) || !isObjectRecord(expectedModels)) {
    violations.push('最终 provider.yibiao.models 配置类型无效，应为对象');
    return;
  }
  const actualModelIds = Object.keys(actualModels).sort();
  const expectedModelIds = Object.keys(expectedModels).sort();
  if (actualModelIds.length !== expectedModelIds.length
    || actualModelIds.some((modelId, index) => modelId !== expectedModelIds[index])) {
    addConfigMismatch(violations, 'provider.yibiao.models');
  }

  const actualDefault = actualModels.default;
  const expectedDefault = expectedModels.default;
  if (!isObjectRecord(actualDefault) || !isObjectRecord(expectedDefault)) {
    violations.push('最终 provider.yibiao.models.default 配置类型无效，应为对象');
    return;
  }
  if (actualDefault.name !== expectedDefault.name) {
    addConfigMismatch(violations, 'provider.yibiao.models.default.name');
  }
  if (!isObjectRecord(actualDefault.limit) || !isObjectRecord(expectedDefault.limit)) {
    violations.push('最终 provider.yibiao.models.default.limit 配置类型无效，应为对象');
    return;
  }
  if (actualDefault.limit.context !== expectedDefault.limit.context) {
    addConfigMismatch(violations, 'provider.yibiao.models.default.limit.contextLength');
  }
  if (actualDefault.limit.output !== expectedDefault.limit.output) {
    addConfigMismatch(violations, 'provider.yibiao.models.default.limit.output');
  }

  if (config.model !== expectedConfig.model || config.small_model !== expectedConfig.small_model) {
    addConfigMismatch(violations, 'model/small_model');
  }
}

function validateEffectiveConfig(config, environmentInfo, expectedConfig, expectedProxyToken, violations) {
  if (!isObjectRecord(config)) {
    violations.push('OpenCode Server 配置响应类型无效，应为对象');
    return;
  }
  const expectedAgentsPath = environmentInfo.toolEnvironment.agentsPath;
  const instructions = config.instructions;
  if (!Array.isArray(instructions)) {
    violations.push('最终额外指令类型无效，应为数组');
  } else if (instructions.length !== 1 || !samePath(instructions[0], expectedAgentsPath)) {
    violations.push(`最终额外指令来源不符合预期：${instructions.join('、') || '无'}`);
  }
  validateEmptyArray(config.plugin, '最终插件', violations);
  // OpenCode 的 /config 会省略空 plugin_origins；字段一旦出现则必须是空数组。
  validateEmptyArray(config.plugin_origins, '最终插件来源', violations, { allowMissing: true });
  if (!isObjectRecord(config.skills)) {
    violations.push('最终 Skill 配置类型无效，应为对象');
  } else {
    const skillPaths = config.skills.paths;
    const skillUrls = config.skills.urls;
    if (!Array.isArray(skillPaths)) {
      violations.push('最终 Skill 路径类型无效，应为数组');
    } else {
      skillPaths.forEach((item) => {
        if (typeof item !== 'string' || !item.trim()) {
          violations.push('最终 Skill 路径包含无效值');
        } else if (!isPathInsideAnyRoot(environmentInfo.skillRoots, item)) {
          violations.push(`最终配置中的 Skill 路径越界：${item}`);
        }
      });
    }
    if (!Array.isArray(skillUrls)) {
      violations.push('最终远程 Skill 类型无效，应为数组');
    } else if (skillUrls.length) {
      violations.push(`最终配置中存在远程 Skill：${skillUrls.join('、')}`);
    }
  }
  validateEmptyObject(config.mcp, 'MCP', violations);
  if (!samePath(config.shell, environmentInfo.shellPath)) {
    violations.push(`最终 Shell 不符合预期：${config.shell || '未设置'}`);
  }
  validateExpectedProviderConfig(config, expectedConfig, expectedProxyToken, violations);
  if (!isObjectRecord(config.provider)) {
    violations.push('最终 Provider 配置类型无效，应为对象');
  } else {
    const providerIds = Object.keys(config.provider);
    if (providerIds.length !== 1 || providerIds[0] !== 'yibiao') {
      violations.push(`最终 Provider 配置受到外部污染：${providerIds.join('、') || '无'}`);
    }
  }
  if (config.model !== 'yibiao/default' || config.small_model !== 'yibiao/default') {
    violations.push('最终模型配置受到外部污染');
  }
}

function validateAgentPermissions(agents, environmentInfo, violations) {
  if (!Array.isArray(agents)) {
    violations.push('OpenCode Server Agent 响应类型无效，应为数组');
    return false;
  }
  if (!agents.length) {
    violations.push('OpenCode Server 未返回 Agent 权限信息');
    return false;
  }
  let valid = true;
  agents.forEach((agent, agentIndex) => {
    if (!isObjectRecord(agent)) {
      valid = false;
      violations.push(`OpenCode Server Agent 第 ${agentIndex + 1} 项类型无效，应为对象`);
      return;
    }
    if (!Array.isArray(agent.permission)) {
      valid = false;
      violations.push(`Agent ${agent.name || '未命名'} 的权限类型无效，应为数组`);
      return;
    }
    const rules = agent.permission;
    rules.forEach((rule, ruleIndex) => {
      if (isObjectRecord(rule)) return;
      valid = false;
      violations.push(`Agent ${agent.name || '未命名'} 的第 ${ruleIndex + 1} 条权限类型无效，应为对象`);
    });
    const externalRules = rules.filter((rule) => rule?.permission === 'external_directory');
    const wildcardDenyIndex = externalRules.findLastIndex(
      (rule) => rule?.pattern === '*' && rule?.action === 'deny',
    );
    if (wildcardDenyIndex < 0) {
      valid = false;
      violations.push(`Agent ${agent?.name || '未命名'} 缺少 external_directory * deny`);
      return;
    }
    externalRules.slice(wildcardDenyIndex + 1).forEach((rule) => {
      if (rule?.action === 'deny') return;
      if (rule?.action === 'allow' && isPathInsideAnyRoot(environmentInfo.permissionExceptionRoots, rule?.pattern)) return;
      valid = false;
      violations.push(`Agent ${agent?.name || '未命名'} 在 * deny 后存在越界规则：${rule?.pattern || '未知'} ${rule?.action || '未知'}`);
    });
  });
  return valid;
}

async function verifyOpenCodeServerIsolation({
  server,
  environmentInfo,
  expectedConfig,
  expectedProxyToken,
}) {
  const isolationCheck = createIsolationCheck(environmentInfo);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('OpenCode 逻辑隔离验证超时')), ISOLATION_CHECK_TIMEOUT_MS);
  try {
    const serverPaths = await getOpenCodePath(server, { signal: controller.signal });
    const config = await getOpenCodeConfig(server, { signal: controller.signal });
    const skills = await getOpenCodeSkills(server, { signal: controller.signal });
    const agents = await getOpenCodeAgents(server, { signal: controller.signal });
    if (!isObjectRecord(serverPaths)) {
      isolationCheck.violations.push('OpenCode Server 路径响应类型无效，应为对象');
    } else {
      if (!samePath(serverPaths.directory, environmentInfo.layout.workspaceDir)) {
        isolationCheck.violations.push(`OpenCode Server 工作目录越界：${serverPaths.directory || '未知'}`);
      }
      if (serverPaths.worktree !== '/' && !samePath(serverPaths.worktree, environmentInfo.layout.workspaceDir)) {
        isolationCheck.violations.push(`OpenCode Server 工作树越界：${serverPaths.worktree || '未知'}`);
      }
      if (!samePath(serverPaths.home, environmentInfo.layout.homeDir)) {
        isolationCheck.violations.push(`OpenCode Server HOME 不符合预期：${serverPaths.home || '未知'}`);
      }
      if (!samePath(serverPaths.config, environmentInfo.layout.configDir)) {
        isolationCheck.violations.push(`OpenCode Server 配置目录不符合预期：${serverPaths.config || '未知'}`);
      }
      if (!samePath(serverPaths.state, environmentInfo.layout.stateDir)) {
        isolationCheck.violations.push(`OpenCode Server 状态目录不符合预期：${serverPaths.state || '未知'}`);
      }
    }

    isolationCheck.effective_permission = getExternalDirectoryPermission(config);
    if (isolationCheck.effective_permission !== 'deny') {
      isolationCheck.violations.push(`external_directory 最终权限不是 deny：${isolationCheck.effective_permission || '未设置'}`);
    }
    validateEffectiveConfig(
      config,
      environmentInfo,
      expectedConfig,
      expectedProxyToken,
      isolationCheck.violations,
    );
    isolationCheck.loaded_skills = summarizeSkills(skills);
    validateSkills(skills, environmentInfo.skillRoots, isolationCheck.violations, 'OpenCode Server');
    const agentPermissionValid = validateAgentPermissions(agents, environmentInfo, isolationCheck.violations);
    isolationCheck.external_read_denied = isolationCheck.effective_permission === 'deny' && agentPermissionValid;
    isolationCheck.success = isolationCheck.violations.length === 0;
    if (!isolationCheck.success) {
      throw createIsolationError(`OpenCode 逻辑隔离验证失败：${isolationCheck.violations.join('；')}`, isolationCheck);
    }
    return isolationCheck;
  } catch (error) {
    if (error?.isolationCheck) throw error;
    isolationCheck.violations.push(error?.message || String(error));
    throw createIsolationError(`OpenCode 逻辑隔离验证失败：${error?.message || String(error)}`, isolationCheck);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runOpenCodeCliIsolationPreflight,
  verifyOpenCodeServerIsolation,
};
