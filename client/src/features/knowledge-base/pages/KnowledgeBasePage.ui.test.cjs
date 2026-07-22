const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, 'KnowledgeBasePage.tsx');
const stylesPath = path.resolve(__dirname, '../../../styles/feature-knowledge-base.css');
const pageSource = fs.readFileSync(pagePath, 'utf8');
const stylesSource = fs.readFileSync(stylesPath, 'utf8');

test('文件夹重命名使用受控 Radix Dialog，不再调用 window.prompt', () => {
  assert.doesNotMatch(pageSource, /window\.prompt\s*\(/);
  assert.match(pageSource, /interface RenameFolderState/);
  assert.match(pageSource, /<Dialog\.Root open=\{Boolean\(renameFolderState\)\}/);
  assert.match(pageSource, /onOpenChange=\{\(open\) => !open && closeRenameFolder\(\)\}/);
  assert.match(pageSource, /onOpenAutoFocus=\{[^}]*select\(\)/s);
  assert.match(pageSource, /onSubmit=\{[^}]*submitRenameFolder/s);
  assert.match(pageSource, /value=\{renameFolderState\?\.name \|\| ''\}/);
  assert.match(pageSource, /onClick=\{closeRenameFolder\}[^>]*>取消<\/button>/);
  assert.match(pageSource, /renameFolderBusy/);
  assert.match(pageSource, /className="knowledge-rename-error" role="alert"/);
});

test('重命名提交显式保护空值、同名、重复提交和 IPC 空返回', () => {
  const submitStart = pageSource.indexOf('const submitRenameFolder = async () => {');
  const submitEnd = pageSource.indexOf('const deleteFolder = async', submitStart);
  const submitSource = pageSource.slice(submitStart, submitEnd);
  const busyGuard = submitSource.indexOf('if (renameFolderBusy || !renameFolderState) return');
  const emptyGuard = submitSource.indexOf('if (!name)');
  const sameNameGuard = submitSource.indexOf('if (name === renameFolderState.originalName)');
  const ipcCall = submitSource.indexOf('knowledgeBase.renameFolder(renameFolderState.folderId, name)');

  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.ok(busyGuard >= 0 && emptyGuard > busyGuard && sameNameGuard > emptyGuard && ipcCall > sameNameGuard);
  assert.match(submitSource, /if \(!folder\)[\s\S]*throw new Error/);
  assert.match(submitSource, /folders: prev\.folders\.map/);
  assert.match(submitSource, /setRenameFolderState\(null\)/);
  assert.match(submitSource, /catch \(error\)[\s\S]*setRenameFolderError\(/);
  assert.match(pageSource, /disabled=\{renameFolderBusy \|\| !renameFolderState\?\.name\.trim\(\)\}/);
});

test('Viewer Header 使用独立语义区并将模式和开发者操作分组', () => {
  for (const className of [
    'knowledge-viewer-label',
    'knowledge-viewer-file-name',
    'knowledge-viewer-count',
    'knowledge-viewer-back',
    'knowledge-viewer-mode-actions',
    'knowledge-viewer-developer-actions',
  ]) {
    assert.match(pageSource, new RegExp(`className=\\"[^\\"]*${className}`));
  }
  assert.match(pageSource, /knowledge-viewer-mode-actions[\s\S]*知识条目[\s\S]*Markdown/);
});

test('Viewer Header 支持长文件名和三档无横向滚动布局', () => {
  assert.match(stylesSource, /\.knowledge-viewer-bar\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*auto\s+minmax\(260px,\s*1fr\)\s+auto\s+auto\s+auto;/);
  assert.match(stylesSource, /\.knowledge-viewer-bar\s*\{[^}]*flex:\s*0 0 auto;/);
  assert.match(stylesSource, /\.knowledge-viewer-file-name\s*\{[\s\S]*min-width:\s*0;[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/);
  assert.match(stylesSource, /\.knowledge-viewer-mode-actions\s*\{[\s\S]*display:\s*grid;/);
  assert.match(stylesSource, /@media\s*\(min-width:\s*860px\)\s*and\s*\(max-width:\s*1100px\)/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*859px\)/);
  assert.match(stylesSource, /\.knowledge-viewer-page\s*\{[\s\S]*overflow-x:\s*hidden;/);
  assert.doesNotMatch(stylesSource, /\.knowledge-viewer-bar \.knowledge-breadcrumb strong\s*\{[\s\S]*white-space:\s*nowrap;/);
});

test('文档列表支持当前文件夹多选、全选和批量删除', () => {
  assert.match(pageSource, /selectedDocumentIds/);
  assert.match(pageSource, /ref=\{selectAllDocumentsRef\}[\s\S]*type="checkbox"[\s\S]*checked=\{allDocumentsSelected\}/);
  assert.match(pageSource, /aria-label=\{`选择文档 \$\{document\.file_name\}`\}/);
  assert.match(pageSource, /setSelectedDocumentIds\(allDocumentsSelected \? new Set\(\) : new Set\(documents\.map/);
  assert.match(pageSource, /knowledgeBase\.deleteDocuments\(documentIds\)/);
  assert.match(pageSource, /确定批量删除选中的 \$\{selectedDocuments\.length\} 个文档吗？删除后无法恢复/);
  assert.match(pageSource, /batchDeleting \? '删除中\.\.\.' : '批量删除'/);
  assert.match(stylesSource, /\.knowledge-document-card\.is-selected/);
  assert.match(stylesSource, /\.knowledge-document-title-main\s*\{[\s\S]*grid-template-columns:\s*auto auto minmax\(0, 1fr\);/);
});

test('无可沉淀正文使用中性的已跳过状态，不显示为失败', () => {
  assert.match(pageSource, /skipped:\s*'已跳过'/);
  assert.match(stylesSource, /\.knowledge-status\.is-skipped\s*\{/);
});

test('开发者模式可一次提交全部待匹配文档，并说明匹配对象', () => {
  assert.match(pageSource, /pendingMatchingDocuments = index\.documents\.filter/);
  assert.match(pageSource, /匹配待处理（\$\{pendingMatchingDocuments\.length\}）/);
  assert.match(pageSource, /for \(const document of pendingMatchingDocuments\)/);
  assert.match(pageSource, /开发者模式已暂停自动匹配，可点击“匹配待处理”批量处理/);
});
