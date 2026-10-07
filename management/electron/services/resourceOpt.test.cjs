const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabaseService } = require('./databaseService.cjs');
const { createResourceStore, WEEK_MS, changesBetween } = require('./resourceStore.cjs');
const { createResourceSyncService } = require('./resourceSyncService.cjs');
const item = (sourceId, id, title = id) => ({ resourceId: `${sourceId}:${id}`, sourceId, upstreamId: id, title, center: 'prompts', kind: 'prompt', prompt: '测试', status: 'ready', assets: [] });
function setup(t, adapters, now = () => 10000) {
  const db = createDatabaseService({ databasePath: ':memory:' }), sources = ['a', 'b', 'c'].map((sourceId) => ({ sourceId }));
  const store = createResourceStore({ database: db.database, sources, now }), service = createResourceSyncService({ store, adapters, now });
  t.after(async () => { await service.stop(); db.close(); }); return { store, service, sources };
}
const wait = async (store) => { for (let i = 0; i < 500; i++) { if (!store.taskSummary().some((task) => ['queued', 'running'].includes(task.status))) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('队列未结算'); };

test('OPT手动在途跨周观察去重且消费到期槽，周锚点不漂移', async(t)=>{
  let at=10000,release; const barrier=new Promise(resolve=>{release=resolve;});
  const {store,service}=setup(t,{entries:async()=>{await barrier;return{commit:'一',entries:[{id:'一'}]};},prepare:async(source)=>item(source.sourceId,'一')},()=>at);
  store.setEnabled('a',true);store.claim('a',true);store.finish('a');const anchor=store.getSource('a').anchorAt;
  const checking=service.check('a');await Promise.resolve();at+=WEEK_MS;const observed=service.runDue();
  assert.equal(store.taskSummary().filter(row=>row.sourceId==='a').length,1);assert(store.getSource('a').nextDueAt>at);assert.equal(store.getSource('a').anchorAt,anchor);
  release();await checking;await observed;assert.equal(store.taskSummary().length,1);
});

test('OPT审计脱敏保留合法JSON与嵌套字段，不泄露口令/本地路径',t=>{
  const {store}=setup(t,{});store.audit('a','FAILED',{message:'Bearer secret-token C:\\Users\\test\\private.txt',nested:{api_key:'secret-key',url:'https://user:pass@example.test/file'}});
  const detail=JSON.parse(store.audits()[0].detailJson);assert(!JSON.stringify(detail).includes('secret'));assert(!detail.message.includes('C:'));assert.equal(detail.nested.api_key,'[已脱敏]');
});
test('OPT批次事务、重复requestId/在途来源去重、受理不等待下载、FIFO来源1/文件2', async (t) => {
  let unblock, active = 0, peak = 0, files = 0, filePeak = 0; const order = [];
  const barrier = new Promise((resolve) => { unblock = resolve; });
  const { store, service } = setup(t, { entries: async (source) => { active++; peak = Math.max(peak, active); order.push(source.sourceId); await barrier; return { commit: 'one', entries: [1,2,3].map((id) => ({ id })) }; },
    prepare: async (source, entry) => { files++; filePeak = Math.max(filePeak, files); await new Promise((resolve) => setTimeout(resolve, 5)); files--; if (entry.id === 3) active--; return item(source.sourceId, entry.id); } });
  const input = { requestId: 'batch', expectedSettingsRevision: 0, enabledSourceIds: ['a', 'b', 'c'] };
  const result = service.applySelection(input); assert.equal(result.accepted, true); assert.equal(result.tasks.length, 3); assert.deepEqual(service.applySelection(input), result);
  assert.equal(service.enqueueChecks({ requestId: 'manual', sourceIds: ['a'] }).tasks[0].taskId, result.tasks[0].taskId);
  await Promise.resolve(); assert.equal(order.length, 1); assert.equal(store.getSource('a').enabled, true);
  unblock(); await wait(store); assert.equal(peak, 1); assert.equal(filePeak, 2); assert.deepEqual(order, ['a','b','c']);
});
test('OPT队列写入失败整批回滚，旧revision不得覆盖新配置', (t) => {
  const { store, service } = setup(t, {});
  store.database.exec("CREATE TRIGGER opt_fail BEFORE INSERT ON resource_sync_tasks WHEN NEW.source_id = 'b' BEGIN SELECT RAISE(ABORT, '测试建任务失败'); END");
  assert.throws(() => service.applySelection({ requestId: 'bad', expectedSettingsRevision: 0, enabledSourceIds: ['a','b'] }), /建任务失败/);
  assert.equal(store.getSource('a').enabled, false); assert.equal(store.taskSummary().length, 0); assert.equal(store.revision(), 0);
  assert.throws(() => service.applySelection({ requestId: 'stale', expectedSettingsRevision: 4, enabledSourceIds: [] }), /设置已变化/);
});
test('OPT中断恢复排队保留，已取消不恢复，手动/跨周/重新启用保留锚点', async (t) => {
  let at = 10000, calls = 0;
  const { store, service, sources } = setup(t, { entries: async () => { calls++; return { commit: 'one', entries: [{ id: 1 }] }; }, prepare: async (source) => item(source.sourceId, 1) }, () => at);
  service.applySelection({ requestId: 'first', expectedSettingsRevision: 0, enabledSourceIds: ['a'] }); await wait(store);
  at += 1000; service.enqueueChecks({ requestId: 'check', sourceIds: ['a'] }); await wait(store); assert.equal(store.getSource('a').anchorAt, 10000); assert.equal(store.getSource('a').nextDueAt, 10000 + WEEK_MS);
  at += WEEK_MS * 3; await service.runDue(); await service.runDue(); assert.equal(calls, 3);
  service.applySelection({ requestId: 'off', expectedSettingsRevision: 1, enabledSourceIds: [] });
  service.applySelection({ requestId: 'on', expectedSettingsRevision: 2, enabledSourceIds: ['a'] }); await wait(store); assert.equal(store.getSource('a').anchorAt, 10000);
  const queued = store.enqueue('a'); store.database.prepare("UPDATE resource_sync_tasks SET status = 'running' WHERE task_id = ?").run(queued.taskId);
  createResourceStore({ database: store.database, sources, now: () => at }); assert.equal(store.task(queued.taskId).status, 'queued');
  service.cancel('a'); assert.equal(store.task(queued.taskId).status, 'cancelled');
});
test('OPT14失败、旧复用与新增统计分开，失败重试同提交仅失败项，无变化零发布', async (t) => {
  let broken = true, prepares = 0;
  const { store, service } = setup(t, { entries: async () => ({ commit: 'one', entries: Array.from({ length: 16 }, (_, id) => ({ id })) }), prepare: async (source, entry) => { prepares++; if (entry.id < 14 && broken) throw Object.assign(new Error('测试下载失败 token=private'), { stage: 'download', code: 'TEST' }); return item(source.sourceId, entry.id); } });
  store.setEnabled('a', true); store.publishSource('a', [item('a', 0)]);
  const partial = await service.check('a'); assert.equal(partial.failed, 14); assert.equal(partial.reusedOld, 1); assert.equal(partial.preparedNew, 2); assert.equal(partial.publishedChanges, 2); assert.equal(store.getSource('a').successAt, null);
  broken = false; const retry = await service.check('a', { retryFailed: true }); assert.equal(prepares, 30); assert.equal(retry.unchanged, 3); assert.equal(retry.preparedNew, 13);
  const version = store.snapshot().version; await service.check('a'); assert.equal(store.snapshot().version, version);
  const page = store.audits({ status: 'ITEM_FAILED', limit: 3 }); assert.equal(page.total, 14); assert.equal(page.items.length, 3); assert(!JSON.stringify(page).includes('private'));
});
test('OPT业务assetId、顺序、时间和临时路径变化不发布，真实hash改变仍发布', () => {
  const before = { ...item('a', 1), assets: [{ assetId: 'random1', hash: 'same', role: 'cover', page: 1 }, { assetId: 'x', hash: 'orig', role: 'original' }] };
  const after = { ...before, checkedAt: 999, path: 'temporary', assets: [{ assetId: 'y', hash: 'orig', role: 'original' }, { assetId: 'random2', hash: 'same', role: 'cover', page: 1 }] };
  assert.equal(changesBetween([before], [after]).length, 0); after.assets[0].hash = 'changed'; assert.equal(changesBetween([before], [after]).length, 1);
});
