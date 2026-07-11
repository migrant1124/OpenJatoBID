const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_EVENTS = 10000;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function createAnalyticsQueueStore({
  filePath,
  now = () => new Date(),
  maxEvents = DEFAULT_MAX_EVENTS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}) {
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function write(events) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempFile, `${JSON.stringify(events)}\n`, 'utf8');
      fs.renameSync(tempFile, filePath);
    } catch (error) {
      try { fs.rmSync(tempFile, { force: true }); } catch {}
      throw error;
    }
  }

  function prune(events) {
    const cutoff = now().getTime() - maxAgeMs;
    return events
      .filter((event) => new Date(event.occurredAt).getTime() >= cutoff)
      .slice(-maxEvents);
  }

  function list() {
    const events = read();
    const next = prune(events);
    if (next.length !== events.length) write(next);
    return next;
  }

  function replace(events) {
    write(prune(events));
  }

  function enqueue(event) {
    replace([...list(), event]);
  }

  return { enqueue, list, replace };
}

module.exports = { DEFAULT_MAX_AGE_MS, DEFAULT_MAX_EVENTS, createAnalyticsQueueStore };
