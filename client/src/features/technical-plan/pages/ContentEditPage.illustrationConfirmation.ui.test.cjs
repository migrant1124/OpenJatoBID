const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pageSource = fs.readFileSync(path.resolve(__dirname, 'ContentEditPage.tsx'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '../../../styles/feature-technical-plan.css'), 'utf8');

test('图片编排确认突出 AI 推荐并将人工选择作为兜底', () => {
  const modalSource = pageSource.slice(pageSource.indexOf('<Dialog.Title>图片编排确认</Dialog.Title>'), pageSource.indexOf('<Dialog.Root\n        open={Boolean(requirementItem)}'));
  assert.match(modalSource, /AI 推荐视觉风格/);
  assert.match(modalSource, /人工兜底调整/);
  assert.match(modalSource, /仅当 AI 推荐与项目实际不符时调整/);
  assert.match(modalSource, /已人工指定/);
  assert.doesNotMatch(modalSource, />取消<\/button>/);
});

test('图片编排确认使用紧凑顶部与风格图标', () => {
  assert.match(pageSource, /function VisualStyleIcon/);
  assert.match(pageSource, /case '党群阵地':/);
  assert.match(pageSource, /case '工会活动':/);
  assert.match(pageSource, /case '安监环':/);
  assert.match(stylesSource, /\.content-generation-config-card\.illustration-confirmation-card\s*\{[^}]*width:\s*min\(1120px,/);
  assert.match(stylesSource, /\.illustration-confirmation-metrics\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/);
  assert.match(stylesSource, /\.illustration-style-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(300px,\s*\.95fr\)/);
});
