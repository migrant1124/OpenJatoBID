const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deriveResponseCompletion,
  protectWriteForResponseMode,
} = require('./contentResponseModes.cjs');

test('manual leaves are export-complete without generated body text', () => {
  const result = deriveResponseCompletion([
    { id: '1.1', title: '人工章节', description: '填写服务承诺', manual_input_required: true, content: '' },
    { id: '1.2', title: 'AI章节', description: '生成实施方案', content: '已生成正文' },
  ]);

  assert.equal(result.response_complete, true);
  assert.deepEqual(result.pending_node_ids, []);
  assert.equal(protectWriteForResponseMode({ manual_input_required: true }, 'generate').allowed, false);
  assert.equal(protectWriteForResponseMode({}, 'generate').allowed, true);
});
