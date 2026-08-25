const assert = require('node:assert/strict');
const test = require('node:test');

test('提示词优先插入光标位置，无法获取光标时用空行追加', async () => {
  const { mergePromptAtSelection } = await import('./promptInsertion.ts');
  assert.deepEqual(mergePromptAtSelection('前后', '提示', 1, 1), { text: '前提示后', caret: 3 });
  assert.deepEqual(mergePromptAtSelection('已有内容', '提示'), { text: '已有内容\n\n提示', caret: 8 });
  assert.deepEqual(mergePromptAtSelection('', '提示'), { text: '提示', caret: 2 });
});
