const assert = require('node:assert/strict');
const test = require('node:test');
const { createSystemDiagnosticsService } = require('./systemDiagnosticsService.cjs');

test('快速诊断不调用外部模型并返回安全状态', async () => {
  const service = createSystemDiagnosticsService({ app: { getVersion: () => '1.4.0', getPath: () => require('node:os').tmpdir() } });
  const snapshot = await service.runAll();
  assert.equal(snapshot.results.find((item) => item.id === 'app-version').status, 'ok');
  assert.equal(snapshot.results.find((item) => item.id === 'text-model').status, 'skipped');
  assert.equal(snapshot.results.some((item) => /API Key|许可证正文|手机号/.test(item.message)), false);
});
