const { WEEK_MS, businessContent, hash } = require('./resourceStore.cjs');

function createResourceSyncService({ store, adapters, now = Date.now }) {
  const jobs = new Map(), waiters = new Map();
  let timer = null, stopped = false, draining = null;
  async function execute(task) {
    const sourceId = task.source_id;
    if (!store.claim(sourceId, Boolean(task.scheduled))) { store.finishTask(task.task_id, 'cancelled', { skipped: true }); return { skipped: true }; }
    store.database.prepare("UPDATE resource_sync_tasks SET status = 'running', scheduled = 0, updated_at = ? WHERE task_id = ?").run(now(), task.task_id);
    const controller = new AbortController(); jobs.set(sourceId, { controller, taskId: task.task_id });
    const counts = { attempted: 0, preparedNew: 0, unchanged: 0, failed: 0, reusedOld: 0, publishedChanges: 0, failedIds: [] };
    store.audit(sourceId, 'CHECKING', { taskId: task.task_id });
    try {
      const source = store.getSource(sourceId), result = await adapters.entries(source, controller.signal);
      counts.commit = result.commit;
      const previous = store.snapshot().items.filter((item) => item.sourceId === sourceId);
      if (!result.entries.length || (previous.length > 20 && result.entries.length < previous.length / 2)) throw new Error('来源异常空清单或骤减，保留旧快照');
      const last = store.database.prepare("SELECT result_json FROM resource_sync_tasks WHERE source_id = ? AND status IN ('partial', 'failed') ORDER BY sequence DESC LIMIT 1").get(sourceId);
      const retry = last?.result_json ? JSON.parse(last.result_json) : null;
      const onlyFailed = task.retry_failed && retry?.commit === result.commit && retry.failedIds ? new Set(retry.failedIds) : null;
      const completed = []; let cursor = 0;
      async function worker() {
        while (cursor < result.entries.length && !controller.signal.aborted) {
          const entry = result.entries[cursor++], old = previous.find((item) => item.upstreamId === entry.id);
          if (onlyFailed && !onlyFailed.has(entry.id) && old) { completed.push(old); counts.unchanged++; continue; }
          counts.attempted++;
          try {
            const prepared = await adapters.prepare(source, entry, result.commit, controller.signal);
            completed.push(prepared);
            if (old && hash(businessContent(old)) === hash(businessContent(prepared))) counts.unchanged++;
            else counts.preparedNew++;
          } catch (error) {
            if (controller.signal.aborted) break;
            counts.failed++; counts.failedIds.push(entry.id);
            if (old) { completed.push(old); counts.reusedOld++; }
            store.audit(sourceId, 'ITEM_FAILED', { taskId: task.task_id, resourceId: `${sourceId}:${entry.id}`, stage: error.stage || 'unknown', code: error.code || 'unknown', retryable: error.retryable !== false, message: String(error.message) });
          }
        }
      }
      await Promise.all([worker(), worker()]);
      if (controller.signal.aborted || store.task(task.task_id).cancel_requested) throw new Error('本次资源同步已停止');
      const before = store.snapshot().version, version = completed.length ? store.publishSource(sourceId, completed) : before;
      counts.publishedChanges = version !== before ? store.snapshot().changes.length : 0;
      const error = counts.failed ? `${counts.failed}项未完成` : null;
      store.finish(sourceId, { error });
      const status = counts.failed ? completed.length ? 'partial' : 'failed' : 'completed';
      const outcome = { ...counts, version, count: completed.length, failures: counts.failed };
      store.finishTask(task.task_id, status, outcome); store.audit(sourceId, status === 'completed' ? 'CHECKED' : status.toUpperCase(), { taskId: task.task_id, ...outcome });
      return outcome;
    } catch (error) {
      const cancelled = controller.signal.aborted || store.task(task.task_id).cancel_requested;
      const outcome = { ...counts, error: String(error.message), cancelled: Boolean(cancelled) };
      store.finish(sourceId, { error: String(error.message) }); store.finishTask(task.task_id, cancelled ? 'cancelled' : 'failed', outcome);
      store.audit(sourceId, cancelled ? 'CANCELLED' : 'FAILED', { taskId: task.task_id, ...outcome });
      if (!cancelled) throw error;
      return outcome;
    } finally { jobs.delete(sourceId); }
  }
  function drain() {
    if (stopped || draining) return draining;
    draining = (async () => {
      while (!stopped) {
        const task = store.database.prepare("SELECT * FROM resource_sync_tasks WHERE status = 'queued' ORDER BY sequence LIMIT 1").get();
        if (!task) break;
        try { const result = await execute(task); waiters.get(task.task_id)?.forEach((item) => item.resolve(result)); }
        catch (error) { waiters.get(task.task_id)?.forEach((item) => item.reject(error)); }
        finally { waiters.delete(task.task_id); }
      }
    })().finally(() => { draining = null; if (!stopped && store.database.prepare("SELECT 1 FROM resource_sync_tasks WHERE status = 'queued' LIMIT 1").get()) queueMicrotask(() => void drain()); });
    return draining;
  }
  function accept(input, selection = false) {
    const result = store.accept(input, selection);
    for (const id of result.cancelled) cancel(id);
    // 批次受理立即返回，网络任务在事务结束后的微任务中执行。
    queueMicrotask(() => void drain());
    return result;
  }
  async function check(id, options = {}) {
    if (stopped || !store.getSource(id)?.enabled) return { skipped: true };
    const value = store.enqueue(id, options);
    const result = new Promise((resolve, reject) => { const list = waiters.get(value.taskId) || []; list.push({ resolve, reject }); waiters.set(value.taskId, list); });
    void drain(); return result;
  }
  async function runDue() {
    if (stopped) return;
    for (const source of store.listSources()) if (source.enabled && source.nextDueAt <= now()) store.enqueue(source.sourceId, { scheduled: true });
    await drain();
  }
  function start() { if (timer) return; stopped = false; void runDue(); timer = setInterval(() => void runDue(), 60000); timer.unref?.(); }
  async function stop() { stopped = true; clearInterval(timer); timer = null; for (const job of jobs.values()) job.controller.abort(); await draining; }
  function cancel(id) {
    const active = store.activeTask(id) || store.database.prepare("SELECT * FROM resource_sync_tasks WHERE source_id = ? AND cancel_requested = 1 AND status = 'cancelled' ORDER BY sequence DESC LIMIT 1").get(id);
    if (active) { store.database.prepare("UPDATE resource_sync_tasks SET cancel_requested = 1, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END WHERE task_id = ?").run(active.task_id); waiters.get(active.task_id)?.forEach((item) => item.resolve({ cancelled: true })); waiters.delete(active.task_id); }
    jobs.get(id)?.controller.abort(); return { cancelled: Boolean(active || jobs.has(id)) };
  }
  return { check, runDue, start, stop, cancel, applySelection: (input) => accept(input, true), enqueueChecks: (input) => accept(input),
    enable: async (id, enabled) => { store.setEnabled(id, enabled); if (enabled) return check(id, { scheduled: true }); cancel(id); },
    plan: () => ({ periodMs: WEEK_MS, periodLabel: '每周一次', running: Boolean(timer), settingsRevision: store.revision(), sources: store.listSources(), tasks: store.taskSummary() }) };
}
module.exports = { createResourceSyncService };
