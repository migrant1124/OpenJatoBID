'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPiUserQuestionTool } = require('./piUserQuestionTool.cjs');

const Type = {
  Object: () => ({}),
  String: () => ({}),
  Optional: (value) => value,
  Array: () => ({}),
  Boolean: () => ({}),
};

test('ask-user 将用户回答作为结构化工具结果返回', async () => {
  const tool = createPiUserQuestionTool({
    Type,
    requestUserQuestion: async (request) => {
      assert.equal(request.question, '请确认目录层级');
      return { answer: '保持当前目录', selected_option: '保持当前目录', is_custom: false };
    },
  });
  const result = await tool.execute('tool-call', {
    question: '请确认目录层级',
    options: [
      { label: '保持当前目录', custom: false },
      { label: '调整目录安排', custom: true },
    ],
  });
  assert.equal(result.details.answered, true);
  assert.equal(result.details.answer, '保持当前目录');
});

test('ask-user 拒绝多个自定义输入选项', async () => {
  const tool = createPiUserQuestionTool({ Type, requestUserQuestion: async () => ({}) });
  await assert.rejects(
    tool.execute('tool-call', {
      question: '请确认目录层级',
      options: [{ label: '补充一', custom: true }, { label: '补充二', custom: true }],
    }),
    /最多只能有一个/u,
  );
});
