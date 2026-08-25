const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPromptLibrarySchema } = require('./sqliteDatabase.cjs');
const { createPromptLibraryStore } = require('./promptLibraryStore.cjs');
const { createPromptLibraryService } = require('./promptLibraryService.cjs');

function createStore() {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
  return { db, store: createPromptLibraryStore({ db }) };
}

test('提示词分组和提示词 CRUD 持久化并执行软删除约束', () => {
  const { db, store } = createStore();
  const general = store.listGroups()[0];
  assert.equal(general.groupName, '通用提示词');
  const group = store.createGroup({ groupName: '技术方案编写', description: '方案模板', iconKey: 'green' });
  assert.throws(() => store.createGroup({ groupName: '技术方案编写' }), /已存在/);
  const prompt = store.createPrompt({ groupId: group.groupId, title: '实施方案', contentMarkdown: '第一版' });
  assert.equal(store.updatePrompt({ promptId: prompt.promptId, contentMarkdown: '第二版' }).contentMarkdown, '第二版');
  assert.equal(store.listPrompts({ query: '技术方案' }).length, 1);
  assert.throws(() => store.deleteGroup(group.groupId), /仍有提示词/);
  store.deletePrompt(prompt.promptId);
  assert.equal(store.listPrompts({ groupId: group.groupId }).length, 0);
  assert.equal(store.deleteGroup(group.groupId).success, true);
  db.close();
});

test('批量导入复用文档解析并保持一个文档对应一条提示词', async () => {
  const { db, store } = createStore();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-library-'));
  const files = [path.join(directory, '需求分析.md'), path.join(directory, '技术方案.txt')];
  files.forEach((file) => fs.writeFileSync(file, 'source', 'utf8'));
  const service = createPromptLibraryService({
    app: {},
    configStore: { load: () => ({ file_parser: { provider: 'local' } }) },
    store,
    dialogApi: { showOpenDialog: async () => ({ canceled: false, filePaths: files }) },
    parseDocument: async (_app, file) => `正文：${path.basename(file)}`,
  });
  const groupId = store.listGroups()[0].groupId;
  const prepared = await service.prepareBatchImport({ groupId });
  assert.equal(prepared.items.length, 2);
  assert.equal('filePath' in prepared.items[0], false);
  const result = await service.commitBatchImport({ items: prepared.items.map(({ importId, title, groupId: targetGroupId }) => ({ importId, title, groupId: targetGroupId })) });
  assert.deepEqual([result.successCount, result.failedCount], [2, 0]);
  assert.deepEqual(store.listPrompts().map((item) => item.title).sort(), ['技术方案', '需求分析']);
  fs.rmSync(directory, { recursive: true, force: true });
  db.close();
});
