const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { dialog } = require('electron');
const { parseDocumentWithConfig } = require('./fileService.cjs');

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.doc', '.docx', '.wps']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_BATCH_FILES = 50;

function preview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

function titleFromFile(filePath) {
  return path.basename(filePath, path.extname(filePath)).trim().slice(0, 100) || '未命名提示词';
}

function createPromptLibraryService({ app, configStore, store, dialogApi = dialog, parseDocument = parseDocumentWithConfig }) {
  const preparedImports = new Map();

  async function chooseFiles(multiple) {
    const result = await dialogApi.showOpenDialog({
      title: multiple ? '批量导入提示词' : '导入提示词',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: '提示词文档', extensions: ['md', 'markdown', 'txt', 'doc', 'docx', 'wps'] }],
    });
    if (result.canceled || !result.filePaths.length) return [];
    if (result.filePaths.length > MAX_BATCH_FILES) throw new Error('一次最多导入 50 个文件。');
    return result.filePaths;
  }

  async function parseFile(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error('当前文件格式不支持。');
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) throw new Error('单个文件不能超过 20MB。');
    const content = String(await parseDocument(app, filePath, configStore.load(), {
      preserveImages: false,
      assetScope: `prompt-library-${crypto.randomUUID()}`,
      suppressFileIdentity: true,
    }) || '').trim();
    if (!content) throw new Error('文档未解析出有效内容。');
    return { filePath, fileName: path.basename(filePath), title: titleFromFile(filePath), content, sizeBytes: stat.size };
  }

  async function importSingle(input = {}) {
    const files = await chooseFiles(false);
    if (!files.length) return { success: false, canceled: true };
    const parsed = await parseFile(files[0]);
    return { success: true, prompt: store.createPrompt({
      groupId: input.groupId,
      title: parsed.title,
      contentMarkdown: parsed.content,
      source: 'single-import',
      sourceFileName: parsed.fileName,
    }) };
  }

  async function prepareBatchImport(input = {}) {
    const files = await chooseFiles(true);
    if (!files.length) return { canceled: true, items: [] };
    const stats = await Promise.all(files.map((filePath) => fs.stat(filePath)));
    if (stats.reduce((sum, stat) => sum + stat.size, 0) > MAX_TOTAL_BYTES) throw new Error('单次批量导入总大小不能超过 200MB。');
    const items = [];
    for (const filePath of files) {
      const importId = crypto.randomUUID();
      try {
        const parsed = await parseFile(filePath);
        preparedImports.set(importId, parsed);
        const expiry = setTimeout(() => preparedImports.delete(importId), 30 * 60 * 1000);
        expiry.unref?.();
        items.push({ importId, fileName: parsed.fileName, title: parsed.title, preview: preview(parsed.content), groupId: input.groupId, status: 'ready' });
      } catch (error) {
        items.push({ importId, fileName: path.basename(filePath), title: titleFromFile(filePath), preview: '', groupId: input.groupId, status: 'error', error: error.message || String(error) });
      }
    }
    return { canceled: false, items };
  }

  async function commitBatchImport(input = {}) {
    const results = [];
    for (const item of input.items || []) {
      const prepared = preparedImports.get(item.importId);
      if (!prepared) { results.push({ importId: item.importId, success: false, error: '导入预览已失效，请重新选择文件。' }); continue; }
      try {
        store.createPrompt({
          groupId: item.groupId,
          title: String(item.title || '').trim().slice(0, 100) || prepared.title,
          contentMarkdown: prepared.content,
          source: 'batch-import',
          sourceFileName: prepared.fileName,
        });
        results.push({ importId: item.importId, success: true });
      } catch (error) {
        results.push({ importId: item.importId, success: false, error: error.message || String(error) });
      } finally {
        preparedImports.delete(item.importId);
      }
    }
    return { successCount: results.filter((item) => item.success).length, failedCount: results.filter((item) => !item.success).length, results };
  }

  return {
    listGroups: () => store.listGroups(),
    createGroup: (input) => store.createGroup(input),
    deleteGroup: (input) => store.deleteGroup(input.groupId),
    listPrompts: (input) => store.listPrompts(input),
    getPrompt: (input) => store.getPrompt(input.promptId),
    createPrompt: (input) => store.createPrompt(input),
    updatePrompt: (input) => store.updatePrompt(input),
    deletePrompt: (input) => store.deletePrompt(input.promptId),
    importSingle,
    prepareBatchImport,
    commitBatchImport,
  };
}

module.exports = { createPromptLibraryService, preview, titleFromFile };
