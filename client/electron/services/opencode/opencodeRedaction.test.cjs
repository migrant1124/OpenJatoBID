const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REDACTED,
  redactOpenCodeSensitiveText,
  redactOpenCodeSensitiveValue,
} = require('./opencodeRedaction.cjs');
const {
  buildSelfCheckReportMarkdown,
  compactSelfCheckError,
} = require('./opencodeSelfCheckService.cjs');

test('OpenCode 脱敏器清除已知 token、密码、Authorization 和 API key', () => {
  const proxyToken = 'proxy-token-secret-123456';
  const serverPassword = 'server-password-secret-654321';
  const input = [
    `raw=${proxyToken}`,
    `raw=${serverPassword}`,
    'Authorization: Bearer bearer-secret-value',
    'Authorization=Basic YmFzaWMtc2VjcmV0',
    'apiKey="api-key-secret-value"',
    'OPENCODE_SERVER_PASSWORD=environment-secret',
  ].join('\n');

  const output = redactOpenCodeSensitiveText(input, [proxyToken, serverPassword]);
  for (const secret of [
    proxyToken,
    serverPassword,
    'bearer-secret-value',
    'YmFzaWMtc2VjcmV0',
    'api-key-secret-value',
    'environment-secret',
  ]) {
    assert.equal(output.includes(secret), false);
  }
  assert.equal(output.includes(REDACTED), true);

  assert.deepEqual(
    redactOpenCodeSensitiveValue({
      authHeader: 'Basic direct-secret',
      api_key: 'api-secret',
      proxy_token: 'proxy-secret',
      input_tokens: 42,
    }),
    {
      authHeader: REDACTED,
      api_key: REDACTED,
      proxy_token: REDACTED,
      input_tokens: 42,
    },
  );
});

test('自检错误与 Markdown 报告在落盘或展示前保持脱敏', () => {
  const proxyToken = 'proxy-token-in-self-check';
  const serverPassword = 'server-password-in-self-check';
  const error = new Error(`启动失败 Authorization: Bearer ${proxyToken}`);
  error.openCodeStdoutTail = `stdout ${proxyToken}`;
  error.openCodeStderrTail = `OPENCODE_SERVER_PASSWORD=${serverPassword}`;
  error.openCodeRequestLog = [{ headers: { Authorization: `Basic ${serverPassword}` } }];
  error.isolationCheck = { apiKey: proxyToken, violations: [`api_key=${proxyToken}`] };

  const compact = compactSelfCheckError(error, [proxyToken, serverPassword]);
  const report = buildSelfCheckReportMarkdown({
    success: false,
    status: 'error',
    message: error.message,
    error: compact,
    diagnostics: compact,
    isolation_check: compact.isolation_check,
  }, [proxyToken, serverPassword]);
  const serialized = `${JSON.stringify(compact)}\n${report}`;

  assert.equal(serialized.includes(proxyToken), false);
  assert.equal(serialized.includes(serverPassword), false);
  assert.equal(serialized.includes(REDACTED), true);
});
