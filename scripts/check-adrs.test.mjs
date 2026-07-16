import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAdrContent, validateAdrDirectory } from './check-adrs.mjs';

test('现有 ADR 目录通过编号、章节和索引校验', () => {
  assert.deepEqual(validateAdrDirectory(), []);
});

test('ADR 校验拒绝未知状态和缺失章节', () => {
  const errors = validateAdrContent('0001-example.md', '# ADR-0001：示例\n\n## 状态\n\nunknown', new Set(['0001']));
  assert.ok(errors.some((error) => error.includes('状态不合法')));
  assert.ok(errors.some((error) => error.includes('背景')));
});
