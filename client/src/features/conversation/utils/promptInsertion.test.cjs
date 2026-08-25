const assert = require('node:assert/strict');
const test = require('node:test');

test('提示词覆盖当前输入框内容', async () => {
  const { replaceDraftWithPrompt } = await import('./promptInsertion.ts');
  assert.deepEqual(replaceDraftWithPrompt('提示'), { text: '提示', caret: 2 });
});
