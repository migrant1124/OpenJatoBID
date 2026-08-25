const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pageSource = fs.readFileSync(path.join(__dirname, 'ConversationPage.tsx'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(__dirname, '../hooks/useConversationWorkspace.ts'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../../../styles/feature-conversation.css'), 'utf8');
const toastCssSource = fs.readFileSync(path.join(__dirname, '../../../styles/shared-toast.css'), 'utf8');
const promptLibrarySource = fs.readFileSync(path.join(__dirname, '../../prompt-library/components/PromptLibraryDialog.tsx'), 'utf8');

test('会话列表按时间归类、悬停显示菜单并支持批量删除', () => {
  assert.match(pageSource, /'今天'[\s\S]*'昨天'[\s\S]*'7 天内'[\s\S]*'30 天内'[\s\S]*'更早'/);
  assert.doesNotMatch(pageSource.match(/function ThreadItem[\s\S]*?\n}/)?.[0] || '', /lastMessagePreview|formatTime\(thread\.updatedAt\)/);
  assert.match(pageSource, /批量删除会话/);
  assert.match(pageSource, /workspace\.deleteThreads/);
  assert.match(pageSource, /conversation-attach-button[\s\S]*?<svg[^>]*aria-hidden="true"[\s\S]*?<span>添加附件<\/span>/);
  assert.doesNotMatch(pageSource, /conversation-attach-button[^\n]*>⌕/);
  assert.match(cssSource, /\.conversation-attach-button \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*gap: 2px;/);
  assert.match(cssSource, /\.conversation-thread-item:hover \.conversation-more-menu[\s\S]*opacity: 1/);
  assert.match(cssSource, /\.conversation-dialog \.danger-action:hover:not\(:disabled\)[\s\S]*background: #d14343;[\s\S]*box-shadow:/);
  assert.match(cssSource, /\.prompt-delete-dialog \.danger-action:hover:not\(:disabled\)[\s\S]*background: #d14343;[\s\S]*box-shadow:/);
  assert.match(pageSource, /conversation-prompt-button[\s\S]*提示词库/);
  assert.match(promptLibrarySource, />插入到输入框<\/button>/);
  assert.match(promptLibrarySource, /window\.setTimeout\(\(\) => \{ void saveCurrent\(\); \}, 800\)/);
});

test('批量删除期间不加载即将删除的会话', () => {
  assert.match(workspaceSource, /listThreads\(\{ query: search \}\);[\s\S]*if \(deletingThreadsRef\.current\) return '';/);
  assert.match(workspaceSource, /event\.type === 'thread-list-changed'[\s\S]*if \(deletingThreadsRef\.current\) return;[\s\S]*loadThreads\(query\)/);
  assert.match(workspaceSource, /deletingThreadsRef\.current = true;[\s\S]*activeThreadRef\.current = '';[\s\S]*finally[\s\S]*loadThreads\(query, ''\)/);
});

test('对话输入框仅通过上边沿调节高度', () => {
  assert.match(pageSource, /conversation-composer-resize-handle/);
  assert.match(cssSource, /\.conversation-composer-resize-handle \{[^}]*cursor: ns-resize;/);
  assert.match(cssSource, /\.conversation-composer textarea \{[^}]*resize: none;/);
  assert.doesNotMatch(cssSource, /\.conversation-composer textarea \{[^}]*resize: vertical;/);
});

test('系统提示词分组默认显示', () => {
  assert.match(toastCssSource, /\.app-toast-viewport \{[^}]*z-index: 2147483647;/);
  assert.doesNotMatch(cssSource, /\.prompt-group-list section > div:first-child > button:last-child/);
  assert.match(cssSource, /\.prompt-group-row:hover \.prompt-row-menu,[\s\S]*opacity: 1;/);
  assert.match(cssSource, /\.prompt-library-primary-tools \{[^}]*repeat\(2,[^}]*\}/);
  assert.match(cssSource, /\.prompt-library-primary-tools > button \{[^}]*height: 24px;[^}]*font-size: 11px;/);
  assert.match(cssSource, /\.prompt-library-actions \.prompt-import-menu button \{[^}]*white-space: nowrap;/);
  assert.match(promptLibrarySource, /prompt-library-actions"><details className="prompt-import-menu"/);
  assert.match(promptLibrarySource, /querySelectorAll<HTMLDetailsElement>\('\.prompt-library-dialog details\[open\]'\)[\s\S]*if \(!menu\.contains\(target\)\) menu\.open = false;/);
  assert.match(promptLibrarySource, /selectedGroupId \|\| UNGROUPED_GROUP_ID/);
  assert.match(promptLibrarySource, /const importSingle = async \(\) => \{[\s\S]*?const targetGroupId = favorite \? UNGROUPED_GROUP_ID : selectedGroupId \|\| UNGROUPED_GROUP_ID;/);
  assert.match(promptLibrarySource, /if \(!groups\.length\) \{ showToast\('请先新建分组，再批量导入提示词。', 'info'\); return; \}/);
  assert.match(promptLibrarySource, /prompt-ungrouped-list[\s\S]*renderPromptRow\(prompt, UNGROUPED_GROUP_ID\)/);
  assert.doesNotMatch(promptLibrarySource, /renderGroupSection\(UNGROUPED_GROUP_ID, '未分组'/);
  assert.doesNotMatch(promptLibrarySource, /disabled=\{!selectedGroupId\}[^>]*>新建提示词/);
});
