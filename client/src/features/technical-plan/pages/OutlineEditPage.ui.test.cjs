const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const stylesPath = path.resolve(__dirname, '../../../styles/feature-technical-plan.css');
const stylesSource = fs.readFileSync(stylesPath, 'utf8');
const pagePath = path.resolve(__dirname, 'OutlineEditPage.tsx');
const pageSource = fs.readFileSync(pagePath, 'utf8');

test('目录生成配置按实际区块数量分配行高，知识库选择区占据剩余空间', () => {
  assert.match(stylesSource, /\.outline-generation-config-body\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.outline-generation-config-body\.has-expansion-mode\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.outline-generation-config-body\.has-dev-tools\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.outline-generation-config-body\.has-expansion-mode\.has-dev-tools\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\);/);
  assert.match(stylesSource, /\.outline-generation-config-main\s*\{[^}]*grid-template-columns:\s*minmax\(340px,\s*0\.92fr\)\s+minmax\(0,\s*1\.08fr\);/);
});

test('字数预设固定生效，不再展示总开关', () => {
  assert.doesNotMatch(pageSource, /draftWordControlEnabled/);
  assert.match(pageSource, /enabled:\s*true,/);
  assert.match(pageSource, /全文字数\/页数预设/);
});

test('目录生成弹窗扩大工作面并压缩 Agent 调试卡片', () => {
  assert.match(stylesSource, /\.outline-generation-config-card\s*\{[^}]*width:\s*min\(1040px,[^;]+;[^}]*height:\s*min\(820px,[^;]+;/);
  assert.match(stylesSource, /\.outline-agent-debug-option\s*\{[^}]*padding:\s*10px\s+12px;/);
  assert.match(stylesSource, /\.outline-generation-config-card \.content-regenerate-actions > button\s*\{[^}]*min-width:\s*104px;[^}]*min-height:\s*40px;/);
});
