const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPromptLibrarySchema, seedBundledPromptLibrary } = require('./sqliteDatabase.cjs');
const { createPromptLibraryStore } = require('./promptLibraryStore.cjs');
const { createPromptLibraryService } = require('./promptLibraryService.cjs');

function createStore() {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
  return { db, store: createPromptLibraryStore({ db }) };
}

test('安装包固有提示词按稳定 ID 初始化且不污染同名用户分组', () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
  const seed = {
    groups: [{ groupId: 'bundled-group', groupName: '内置分组', description: '', iconKey: 'green', sortOrder: 0, isSystem: false }],
    prompts: [{ promptId: 'bundled-prompt', groupId: 'bundled-group', title: '内置提示词', contentMarkdown: '初始内容', contentChars: 4, sortOrder: 0 }],
  };
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO prompt_groups
    (group_id, group_name, description, icon_key, sort_order, is_system, created_at, updated_at)
    VALUES ('user-group', '内置分组', '', 'blue', 0, 0, ?, ?)`).run(at, at);
  db.prepare(`INSERT INTO prompt_items
    (prompt_id, group_id, title, content_markdown, source, content_chars, sort_order, created_at, updated_at)
    VALUES ('user-prompt', 'user-group', '内置提示词', '用户原文', 'manual', 4, 0, ?, ?)`).run(at, at);

  seedBundledPromptLibrary(db, seed);
  db.prepare('UPDATE prompt_items SET content_markdown = ? WHERE prompt_id = ?').run('用户修改', 'bundled-prompt');
  seedBundledPromptLibrary(db, seed);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM prompt_groups WHERE group_name = ?').get('内置分组').count, 2);
  assert.equal(db.prepare('SELECT content_markdown FROM prompt_items WHERE prompt_id = ?').get('user-prompt').content_markdown, '用户原文');
  assert.equal(db.prepare('SELECT content_markdown FROM prompt_items WHERE prompt_id = ?').get('bundled-prompt').content_markdown, '用户修改');

  db.prepare('UPDATE prompt_items SET deleted_at = ? WHERE prompt_id = ?').run(at, 'bundled-prompt');
  db.prepare('UPDATE prompt_groups SET deleted_at = ? WHERE group_id = ?').run(at, 'bundled-group');
  seedBundledPromptLibrary(db, seed);
  assert.equal(db.prepare('SELECT deleted_at FROM prompt_items WHERE prompt_id = ?').get('bundled-prompt').deleted_at, at);
  assert.equal(db.prepare('SELECT deleted_at FROM prompt_groups WHERE group_id = ?').get('bundled-group').deleted_at, at);
  db.close();
});

test('真实安装包资源可完整初始化 6 个分组和 31 条提示词', () => {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
  seedBundledPromptLibrary(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM prompt_groups WHERE deleted_at IS NULL').get().count, 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM prompt_items WHERE deleted_at IS NULL').get().count, 31);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('提示词分组和提示词 CRUD 持久化并执行软删除约束', () => {
  const { db, store } = createStore();
  const general = store.listGroups()[0];
  assert.equal(general.groupName, '通用提示词');
  const group = store.createGroup({ groupName: '技术方案编写', description: '方案模板', iconKey: 'green' });
  assert.throws(() => store.createGroup({ groupName: '技术方案编写' }), /已存在/);
  const prompt = store.createPrompt({ groupId: group.groupId, title: '实施方案', contentMarkdown: '第一版' });
  assert.equal(store.updatePrompt({ promptId: prompt.promptId, contentMarkdown: '第二版' }).contentMarkdown, '第二版');
  assert.equal(store.listPrompts({ query: '技术方案' }).length, 1);
  assert.equal(store.deleteGroup(group.groupId).success, true);
  assert.equal(store.listPrompts({ groupId: group.groupId }).length, 0);
  db.close();
});

test('默认通用分组可连同组内提示词删除', () => {
  const { db, store } = createStore();
  const general = store.listGroups()[0];
  store.createPrompt({ groupId: general.groupId, title: '待删除提示词' });
  assert.equal(store.deleteGroup(general.groupId).success, true);
  assert.equal(store.listGroups().some((group) => group.groupId === general.groupId), false);
  assert.equal(store.listPrompts({ groupId: general.groupId }).length, 0);
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
