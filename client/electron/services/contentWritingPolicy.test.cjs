'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatSectionWritingContext } = require('./contentWritingPolicy.cjs');

test('轻量章节上下文保留静态职责、排除主题并限制已落盘摘录预算', () => {
  const context = formatSectionWritingContext({
    chapter: { id: '1.1.2', title: '执行方法', role: '说明执行过程' },
    siblings: [
      { id: '1.1.1', title: '启动安排', role: '说明启动准备' },
      { id: '1.1.2', title: '执行方法', role: '说明执行过程' },
      { id: '1.1.3', title: '售后服务', role: '说明售后支持' },
    ],
    exclusions: ['售后服务', '完整项目主体关系'],
    relatedExcerpts: [
      { id: '1.1.1', title: '启动安排', content: '启动阶段先核对资料范围，再形成交接清单。'.repeat(20) },
      { id: '1.1.3', title: '售后服务', content: '售后阶段处理服务请求并形成记录，相关事项由售后章节完整说明。'.repeat(50) },
    ],
    maxChars: 900,
  });
  assert.match(context.text, /同级章节职责/);
  assert.match(context.text, /本节避免完整展开：售后服务；完整项目主体关系/);
  assert.ok(context.text.length <= 900);
  assert.deepEqual(context.excerpt_node_ids, ['1.1.1']);
});
