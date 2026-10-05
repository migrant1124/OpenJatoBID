const { WEEK_MS } = require('./resourceStore.cjs');

function createResourceSyncService({ store, adapters, now = Date.now }) {
  const jobs = new Map();
  let timer = null, stopped = false;
  async function check(sourceId, { scheduled = false } = {}) {
    if (stopped) return { skipped: true };
    if (jobs.has(sourceId)) return jobs.get(sourceId).promise;
    if (!store.claim(sourceId, scheduled)) return { skipped: true };
    const controller = new AbortController();
    const promise = (async () => {
      const source = store.getSource(sourceId);
      store.audit(sourceId, 'CHECKING', { scheduled });
      try {
        const result = await adapters.entries(source, controller.signal);
        const previous = store.snapshot().items.filter((item) => item.sourceId === sourceId);
        if (!result.entries.length || (previous.length > 20 && result.entries.length < previous.length / 2)) throw new Error('来源异常空清单或骤减，保留旧快照');
        const completed = []; let failures = 0; let cursor = 0;
        // 文件准备最多两路，独立于授权/统计服务及模型队列。
        async function worker() {
          while (cursor < result.entries.length && !controller.signal.aborted) {
            const entry = result.entries[cursor++];
            try { completed.push(await adapters.prepare(source, entry, result.commit, controller.signal)); }
            catch (error) {
              failures += 1;
              const old = previous.find((item) => item.upstreamId === entry.id);
              if (old) completed.push(old);
              store.audit(sourceId, 'ITEM_FAILED', { resourceId: `${sourceId}:${entry.id}`, message: String(error.message) });
            }
          }
        }
        await Promise.all([worker(), worker()]);
        if (controller.signal.aborted) throw new Error('本次资源同步已停止');
        const version = completed.length ? store.publishSource(sourceId, completed) : store.snapshot().version;
        const error = failures ? `${failures}项未完成，保留旧版本；可重试失败来源` : null;
        store.finish(sourceId, { error }); store.audit(sourceId, error ? 'PARTIAL' : 'CHECKED', { version, failures, count: completed.length });
        return { version, failures, count: completed.length };
      } catch (error) {
        store.finish(sourceId, { error: String(error.message) });
        store.audit(sourceId, controller.signal.aborted ? 'CANCELLED' : 'FAILED', { message: String(error.message) });
        throw error;
      }
    })();
    jobs.set(sourceId, { controller, promise });
    try { return await promise; } finally { jobs.delete(sourceId); }
  }
  async function runDue() {
    for (const source of store.listSources()) { if (stopped) break; if (source.enabled && source.nextDueAt <= now()) await check(source.sourceId, { scheduled: true }).catch(() => {}); }
  }
  function start() {
    if (timer) return;
    stopped = false;
    void runDue();
    // 仅观察到期锚点，绝不以观察频率代替全库周检查。
    timer = setInterval(() => void runDue(), 60000); timer.unref?.();
  }
  async function stop() {
    stopped = true;
    if (timer) clearInterval(timer); timer = null;
    for (const job of jobs.values()) job.controller.abort();
    await Promise.allSettled([...jobs.values()].map((job) => job.promise));
  }
  return { check, runDue, start, stop, cancel: (id) => jobs.get(id)?.controller.abort(),
    enable: async (id, enabled) => { store.setEnabled(id, enabled); if (enabled) await check(id, { scheduled: true }); },
    plan: () => ({ periodMs: WEEK_MS, periodLabel: '每周一次', running: Boolean(timer), sources: store.listSources() }) };
}

module.exports = { createResourceSyncService };
