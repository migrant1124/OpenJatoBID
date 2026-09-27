const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema, createPromptLibrarySchema } = require('./sqliteDatabase.cjs');
const { createImageStudioSources, publicAddress } = require('./imageStudioSources.cjs');

function database() {
  const db = new DatabaseSync(':memory:');
  createPromptLibrarySchema(db);
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
  assert.equal(store.listItems({ sourceId: 'openjatobid-starter' }).total, 8);
  store.saveSource({ sourceId: 'openjatobid-starter', enabled: false });
  createImageStudioSources({ db });
  assert.equal(store.listSources().find((source) => source.sourceId === 'openjatobid-starter').enabled, false);
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
  assert.equal(store.listItems({ sourceId }).total, 0);
  assert.equal((await store.refreshSource(sourceId)).count, 4);
  assert.equal(store.listItems({ sourceId }).total, 4);
  data = entries(4).map((item) => ({ ...item, updatedAt: '2026-09-26' }));
  assert.equal((await store.refreshSource(sourceId)).unchanged, true);
  data = entries(1, 'b');
  await assert.rejects(store.refreshSource(sourceId, { confirmedReplace: true }), /骤减/);
  assert.equal(store.listItems({ sourceId }).total, 4);
  data = entries(4, 'c');
  assert.equal((await store.refreshSource(sourceId)).count, 4);
  waiting = true;
  const pending = store.refreshSource(sourceId, { confirmedReplace: true });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  store.saveSource({ sourceId, url: 'https://example.com/new.json' });
  assert.equal(store.listSources().find((source) => source.sourceId === sourceId).lastSuccessAt, null);
  release();
  await assert.rejects(pending, /设置已变化/);
  assert.equal(store.listItems({ sourceId }).total, 4);
  assert.equal(publicAddress('127.0.0.1'), false);
  assert.equal(publicAddress('192.168.1.1'), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  db.close();
});

test('40 条整页有准确总数，七天检查无变化推进成功时间', async () => {
  const db = database();
  let now = new Date('2026-09-01T00:00:00Z');
  let calls = 0;
  const store = createImageStudioSources({ db, clock: () => now,
    fetcher: async () => { calls += 1; return new Response(JSON.stringify(entries(80))); },
    urlValidator: async () => {} });
  const sourceId = 'awesome-gpt-image';
  await store.refreshSource(sourceId);
  assert.deepEqual([store.listItems({ sourceId, limit: 40, offset: 40 }).items.length,
    store.listItems({ sourceId, limit: 40, offset: 40 }).total], [40, 80]);
  assert.equal(store.listItems({ sourceId, limit: 40, offset: 80 }).items.length, 0);
  const first = store.listSources().find((source) => source.sourceId === sourceId);
  now = new Date('2026-09-08T00:00:00Z');
  await store.refreshSource(sourceId);
  const second = store.listSources().find((source) => source.sourceId === sourceId);
  assert.equal(second.lastSuccessAt, now.toISOString());
  assert.equal(second.contentAppliedAt, first.contentAppliedAt);
  assert.equal(calls, 2);
  db.close();
});

test('分页边界 0、1、39、40、41、80、81 条不产生空白末页', async () => {
  for (const count of [0, 1, 39, 40, 41, 80, 81]) {
    const db = database();
    const store = createImageStudioSources({ db,
      fetcher: async () => new Response(JSON.stringify(entries(count))), urlValidator: async () => {} });
    const sourceId = 'awesome-gpt-image';
    if (count) await store.refreshSource(sourceId);
    const total = store.listItems({ sourceId, limit: 40 }).total;
    const lastOffset = Math.max(0, Math.ceil(total / 40) - 1) * 40;
    const page = store.listItems({ sourceId, limit: 40, offset: lastOffset });
    assert.equal(total, count);
    assert.equal(page.items.length, count ? count - lastOffset : 0);
    assert.equal(lastOffset + 40 >= total, true);
    db.close();
  }
});

test('迁移保留已中文化条目，不重复付费翻译', () => {
  const db = database();
  createImageStudioSources({ db });
  db.prepare(`INSERT INTO image_studio_reference_items
    (item_id, source_id, title_zh, title_original, prompt_zh, prompt_original, content_hash, updated_at)
    VALUES ('old', 'awesome-gpt-image', '茶杯', 'Cup', '白色茶杯', 'White cup', 'hash', '2026-09-01')`).run();
  extendImageStudioSchema(db);
  assert.equal(db.prepare("SELECT translation_status AS status FROM image_studio_reference_items WHERE item_id = 'old'").get().status, 'ready');
  db.close();
});

test('注入时钟七天到期，ETag 304 只推进检查时间', async () => {
  const db = database();
  let now = new Date('2026-09-01T00:00:00Z');
  let calls = 0; let conditional = '';
  const store = createImageStudioSources({ db, clock: () => now, urlValidator: async () => {},
    fetcher: async (_url, options) => {
      calls += 1; conditional = options.headers['If-None-Match'] || '';
      return calls === 1 ? new Response(JSON.stringify(entries(1)), { headers: { etag: '"v1"' } })
        : new Response(null, { status: 304 });
    } });
  const sourceId = 'awesome-gpt-image';
  db.prepare('UPDATE image_studio_sources SET enabled = 0 WHERE source_id <> ?').run(sourceId);
  await store.refreshSource(sourceId);
  const applied = store.listSources().find((item) => item.sourceId === sourceId).contentAppliedAt;
  now = new Date('2026-09-07T23:59:59Z');
  assert.deepEqual(await store.runDue(), { checked: false, updatedSourceIds: [] });
  assert.equal(calls, 1);
  now = new Date('2026-09-08T00:00:00Z');
  assert.deepEqual(await store.runDue(), { checked: true, updatedSourceIds: [] });
  assert.equal(calls, 2);
  assert.equal(conditional, '"v1"');
  const after = store.listSources().find((item) => item.sourceId === sourceId);
  assert.equal(after.lastSuccessAt, now.toISOString());
  assert.equal(after.contentAppliedAt, applied);
  await store.runDue(); assert.equal(calls, 2);
  db.close();
});

test('同源并发刷新只发一次请求', async () => {
  const db = database();
  let calls = 0; let release;
  const store = createImageStudioSources({ db, urlValidator: async () => {},
    fetcher: async (url) => {
      calls += 1;
      if (url.includes('awesome-gpt-image')) await new Promise((resolve) => { release = resolve; });
      return new Response(JSON.stringify(entries(1)));
    } });
  const first = store.refreshSource('awesome-gpt-image');
  const second = store.refreshSource('awesome-gpt-image');
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  release(); await Promise.all([first, second]);
  assert.equal(calls, 1);
  db.close();
});

test('单源失败独立退避，不阻塞其他到期来源', async () => {
  const db = database();
  let now = new Date('2026-09-01T00:00:00Z');
  const store = createImageStudioSources({ db, clock: () => now, urlValidator: async () => {},
    fetcher: async (url) => url.includes('awesome-gpt-image')
      ? new Response('error', { status: 503 }) : new Response(JSON.stringify(entries(1))) });
  const other = store.listSources().find((source) => source.sourceId !== 'awesome-gpt-image').sourceId;
  db.prepare('UPDATE image_studio_sources SET enabled = 0 WHERE source_id NOT IN (?, ?)').run('awesome-gpt-image', other);
  await store.runDue();
  const failed = store.listSources().find((source) => source.sourceId === 'awesome-gpt-image');
  const succeeded = store.listSources().find((source) => source.sourceId === other);
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.nextRetryAt, '2026-09-01T01:00:00.000Z');
  assert.equal(succeeded.itemCount, 1);
  now = new Date('2026-09-01T00:30:00Z');
  await store.runDue();
  assert.equal(store.listSources().find((source) => source.sourceId === 'awesome-gpt-image').consecutiveFailures, 1);
  db.close();
});
