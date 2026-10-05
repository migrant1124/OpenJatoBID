const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixture, call } = require('./pi-upgrade-fixture.cjs');

test('真实 Pi 1.0.0 的 PPT profile 只执行明确宿主工具，普通对话仍只读', { timeout: 60000 }, async (t) => {
  let saved;
  const fixture = await createFixture({ handler(body) {
    return body.messages.at(-1)?.role === 'tool' ? { text: '合成计划候选已保存，等待真实确认' } : { calls: [call('ppt_plan', { title: '合成测试' })] };
  } });
  t.after(() => fixture.close());
  const pptTools = async ({ codingAgent, Type }) => [codingAgent.defineTool({ name: 'ppt_plan', label: '保存计划', description: '仅保存隔离的合成计划', parameters: Type.Object({ title: Type.String() }), async execute(_id, input) { saved = input.title; return { content: [{ type: 'text', text: 'awaiting_confirmation' }], details: {} }; } })];
  const ppt = await fixture.session({ mode: 'ppt', pptTools });
  assert.deepEqual(ppt.session.getActiveToolNames(), ['ppt_plan']);
  assert.equal(ppt.snapshot.cache_warming, 'off'); assert.deepEqual(ppt.snapshot.skills, []);
  await ppt.session.prompt('保存合成计划'); assert.equal(saved, '合成测试');
  const conversation = await fixture.session({ mode: 'conversation' });
  assert.deepEqual(new Set(conversation.session.getActiveToolNames()), new Set(['read', 'find', 'ls']));
  await assert.rejects(fixture.session({ mode: 'ppt' }), /PPT 专用工具未提供/);
});
