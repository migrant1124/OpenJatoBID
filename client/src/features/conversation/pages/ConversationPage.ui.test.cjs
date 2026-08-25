const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pageSource = fs.readFileSync(path.join(__dirname, 'ConversationPage.tsx'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(__dirname, '../hooks/useConversationWorkspace.ts'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../../../styles/feature-conversation.css'), 'utf8');

test('会话列表按时间归类、悬停显示菜单并支持批量删除', () => {
  assert.match(pageSource, /'今天'[\s\S]*'昨天'[\s\S]*'7 天内'[\s\S]*'30 天内'[\s\S]*'更早'/);
  assert.doesNotMatch(pageSource.match(/function ThreadItem[\s\S]*?\n}/)?.[0] || '', /lastMessagePreview|formatTime\(thread\.updatedAt\)/);
  assert.match(pageSource, /批量删除会话/);
  assert.match(pageSource, /workspace\.deleteThreads/);
  assert.match(cssSource, /\.conversation-thread-item:hover \.conversation-more-menu[\s\S]*opacity: 1/);
  assert.match(cssSource, /\.conversation-dialog \.danger-action:hover:not\(:disabled\)[\s\S]*background: #d14343;[\s\S]*box-shadow:/);
});

test('批量删除期间不加载即将删除的会话', () => {
  assert.match(workspaceSource, /listThreads\(\{ query: search \}\);[\s\S]*if \(deletingThreadsRef\.current\) return '';/);
  assert.match(workspaceSource, /event\.type === 'thread-list-changed'[\s\S]*if \(deletingThreadsRef\.current\) return;[\s\S]*loadThreads\(query\)/);
  assert.match(workspaceSource, /deletingThreadsRef\.current = true;[\s\S]*activeThreadRef\.current = '';[\s\S]*finally[\s\S]*loadThreads\(query, ''\)/);
});
