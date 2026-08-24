const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');
const { buildStandaloneMarkdownDocxResult } = require('./exportService.cjs');

test('standalone export contains only the selected answer and no technical-plan disclaimer', async () => {
  const result = await buildStandaloneMarkdownDocxResult({ title: '会话标题', markdown: '正文回答\n\n| 项目 | 内容 |\n| --- | --- |\n| A | B |' });
  const xml = new AdmZip(result.buffer).readAsText('word/document.xml');
  assert.match(xml, /会话标题/);
  assert.match(xml, /正文回答/);
  assert.doesNotMatch(xml, /内容由 AI 生成/);
});

test('standalone export does not duplicate an existing H1', async () => {
  const result = await buildStandaloneMarkdownDocxResult({ title: '会话标题', markdown: '# 回答标题\n\n正文' });
  const xml = new AdmZip(result.buffer).readAsText('word/document.xml');
  assert.equal((xml.match(/回答标题/g) || []).length, 1);
  assert.doesNotMatch(xml, /会话标题/);
});
