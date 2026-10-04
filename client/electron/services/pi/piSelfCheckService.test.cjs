const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePiSessionSnapshot, EXPECTED_PI_TOOLS } = require('./piSelfCheckService.cjs');
const { PI_RETRY_ERROR_NORMALIZER_PATH } = require('./piRetryErrorNormalizer.cjs');
const dependencies = require('../../../package.json').dependencies;
const snapshot = () => ({ sdk_version: dependencies['@earendil-works/pi-coding-agent'], pi_ai_version: dependencies['@earendil-works/pi-ai'],
  cache_warming: 'off', context_files: ['<yibiao-agent-workspace>'], skills: [], prompts: [], extensions: [PI_RETRY_ERROR_NORMALIZER_PATH], active_tools: [...EXPECTED_PI_TOOLS] });

test('自检只接受实际目标版本、off 和完整工具白名单', () => {
  assert.deepEqual(validatePiSessionSnapshot(snapshot()), { resourcesValid: true, toolsValid: true, configurationValid: true });
  for (const patch of [{ sdk_version: '0.80.10' }, { pi_ai_version: '' }, { cache_warming: 'streaming' }]) {
    assert.equal(validatePiSessionSnapshot({ ...snapshot(), ...patch }).configurationValid, false);
  }
  assert.equal(validatePiSessionSnapshot({ ...snapshot(), active_tools: [...EXPECTED_PI_TOOLS, 'mcp'] }).toolsValid, false);
});

test('自检只允许命名归一化扩展，缺失或混入外部资源仍失败', () => {
  for (const patch of [{ extensions: [] }, { extensions: [PI_RETRY_ERROR_NORMALIZER_PATH, '外部扩展'] }, { skills: ['外部技能'] }, { context_files: ['外部AGENTS'] }]) {
    assert.equal(validatePiSessionSnapshot({ ...snapshot(), ...patch }).resourcesValid, false);
  }
});
