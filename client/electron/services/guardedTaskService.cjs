'use strict';

const { createGuardedOutlineRunner } = require('./outlineGenerationGuard.cjs');
const {
  createGuardedContentRunner,
  recoverInterruptedContentBackup,
} = require('./contentGenerationGuard.cjs');
const outlineTaskModule = require('./outlineGenerationTask.cjs');
const contentTaskModule = require('./contentGenerationTask.cjs');

const OUTLINE_GUARD_FLAG = Symbol.for('openjatobid.outline-generation-guarded');
const CONTENT_GUARD_FLAG = Symbol.for('openjatobid.content-generation-guarded');

if (!outlineTaskModule[OUTLINE_GUARD_FLAG]) {
  outlineTaskModule.runOutlineGenerationTask = createGuardedOutlineRunner(outlineTaskModule.runOutlineGenerationTask);
  Object.defineProperty(outlineTaskModule, OUTLINE_GUARD_FLAG, { value: true });
}
if (!contentTaskModule[CONTENT_GUARD_FLAG]) {
  contentTaskModule.runContentGenerationTask = createGuardedContentRunner(contentTaskModule.runContentGenerationTask);
  Object.defineProperty(contentTaskModule, CONTENT_GUARD_FLAG, { value: true });
}

const taskServicePath = require.resolve('./taskService.cjs');
delete require.cache[taskServicePath];
const baseTaskServiceModule = require(taskServicePath);
const baseCreateTaskService = baseTaskServiceModule.createTaskService;

function createTaskService(options) {
  // Restore an interrupted full-regeneration backup before load-state IPC can expose
  // the partially-cleared workspace to the renderer. getActiveTasks keeps a fallback
  // check for older startup sequences and tests that construct services lazily.
  recoverInterruptedContentBackup(options?.technicalPlanStore);
  const service = baseCreateTaskService(options);
  const getActiveTasks = service.getActiveTasks.bind(service);
  return {
    ...service,
    getActiveTasks() {
      recoverInterruptedContentBackup(options?.technicalPlanStore);
      return getActiveTasks();
    },
  };
}

// ipc/index.cjs imports taskService.cjs directly. Publish the guarded factory through
// that module's cached exports so both import paths resolve to the same implementation.
baseTaskServiceModule.createTaskService = createTaskService;
module.exports = baseTaskServiceModule;
