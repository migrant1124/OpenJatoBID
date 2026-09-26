const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema } = require('./sqliteDatabase.cjs');
const { createImageStudioSources, publicAddress } = require('./imageStudioSources.cjs');

function database() {
  const db = new DatabaseSync(':memory:');
  createImageStudioSchema(db);
  extendImageStudioSchema(db);
  return db;
}

function entries(count, prefix = 'a') {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, title: `中文标题 ${index}`,
    prompt: `中文提示词 ${index}`, tags: ['中文'], sourceUrl: 'https://example.com' }));
}

test('来源覆盖与删除不会被内置默认值复活', () => {
  const db = database();
  const store = createImageStudioSources({ db });
  const sourceId = 'awesome-gpt-image';
  store.saveSource({ sourceId, url: 'https://example.com/custom.json', enabled: false });
  createImageStudioSources({ db });
  const updated = store.listSources().find((source) => source.sourceId === sourceId);
  assert.equal(updated.url, 'https://example.com/custom.json');
  assert.equal(updated.enabled, false);
  store.deleteSource(sourceId);
  createImageStudioSources({ db });
  assert.equal(store.listSources().some((source) => source.sourceId === sourceId), false);
  store.restoreSource(sourceId);
  assert.equal(store.listSources().some((source) => source.sourceId === sourceId), true);
  db.close();
});

test('来源校验、原子刷新、骤减和改址晚响应保护', async () => {
  const db = database();
  let data = entries(4);
  let release;
  let waiting = false;
  const fetcher = async () => {
    if (waiting) await new Promise((resolve) => { release = resolve; });
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  const store = createImageStudioSources({ db, fetcher, urlValidator: async () => {} });
  const sourceId = 'awesome-gpt-image';
  assert.equal((await store.checkSourceUrl('https://example.com/candidate.json')).count, 4);
  assert.equal(store.listSources().find((source) => source.sourceId === sourceId).itemCount, 0);
  assert.equal((await store.checkSource(sourceId)).count, 4);
  assert.equal(store.listItems().length, 0);
  assert.equal((await store.refreshSource(sourceId)).count, 4);
  assert.equal(store.listItems().length, 4);
  data = entries(4).map((item) => ({ ...item, updatedAt: '2026-09-26' }));
  assert.equal((await store.refreshSource(sourceId)).unchanged, true);
  data = entries(1, 'b');
  await assert.rejects(store.refreshSource(sourceId, { confirmedReplace: true }), /骤减/);
  assert.equal(store.listItems().length, 4);
  data = entries(4, 'c');
  await assert.rejects(store.refreshSource(sourceId), /版本无可比较顺序/);
  waiting = true;
  const pending = store.refreshSource(sourceId, { confirmedReplace: true });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  store.saveSource({ sourceId, url: 'https://example.com/new.json' });
  assert.equal(store.listSources().find((source) => source.sourceId === sourceId).lastSuccessAt, null);
  release();
  await assert.rejects(pending, /设置已变化/);
  assert.equal(store.listItems().length, 4);
  assert.equal(publicAddress('127.0.0.1'), false);
  assert.equal(publicAddress('192.168.1.1'), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  db.close();
});
