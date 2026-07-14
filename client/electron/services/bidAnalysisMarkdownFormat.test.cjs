const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FORMAT_STATUS_EXPLICIT,
  FORMAT_STATUS_UNSPECIFIED,
  getBidAnalysisTaskById,
  getBidAnalysisTaskDefinitions,
  getBidAnalysisTasks,
  getResponseFileFormatStatus,
  isBidAnalysisTaskResultValid,
  runBidAnalysisTask,
  runSingleBidAnalysisPromptTask,
} = require('./bidAnalysisTask.cjs');

function successfulContent(task) {
  if (task.id === 'responseFileRequirements') return `${FORMAT_STATUS_UNSPECIFIED}\n\n未找到明确技术文件目录格式。`;
  return task.output === 'json' ? '{}' : `${task.label}测试结果`;
}

function createWorkspace(formatState) {
  const requiredTasks = getBidAnalysisTasks('key');
  let state = {
    bidSectionMode: 'single',
    bidAnalysisSelectedTaskIds: requiredTasks.map((task) => task.id),
    bidAnalysisTask: { task_id: 'run-format-test', status: 'running' },
    bidAnalysisTasks: Object.fromEntries(requiredTasks.map((task) => [task.id, {
      id: task.id,
      label: task.label,
      status: task.id === 'responseFileRequirements' ? formatState.status : 'success',
      content: task.id === 'responseFileRequirements' ? formatState.content : successfulContent(task),
    }])),
  };
  return {
    readTenderMarkdown: () => '脱敏后的当前投标范围文本',
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    getState: () => state,
  };
}

test('format requirements is the third required Markdown task and the old structured task is inactive', () => {
  const definitions = getBidAnalysisTaskDefinitions();
  assert.equal(definitions.length, 18);
  assert.equal(definitions.filter((task) => task.required).length, 7);
  assert.deepEqual(definitions[2], {
    id: 'responseFileRequirements',
    label: '格式要求',
    required: true,
    output: 'markdown',
    description: '技术文件目录、固定表格、承诺函、签章和编排要求。',
    group: 'key',
  });
  assert.equal(getBidAnalysisTaskById('bidDocumentFormatRequirements'), undefined);
});

test('format requirements accepts only the fixed first-line status marker', () => {
  const task = getBidAnalysisTaskById('responseFileRequirements');
  assert.equal(getResponseFileFormatStatus(`${FORMAT_STATUS_EXPLICIT}\n\n# 技术文件`), 'explicit');
  assert.equal(getResponseFileFormatStatus(`${FORMAT_STATUS_UNSPECIFIED}\n\n未找到明确格式`), 'unspecified');
  assert.equal(getResponseFileFormatStatus('# 格式要求\n【技术文件目录状态】：明确'), undefined);
  assert.equal(isBidAnalysisTaskResultValid(task, { status: 'success', content: '没有固定状态行' }), false);
});

test('format requirements uses one Markdown chat request and no JSON or anchor path', async () => {
  const task = getBidAnalysisTaskById('responseFileRequirements');
  let chatCalls = 0;
  let jsonCalls = 0;
  const result = await runSingleBidAnalysisPromptTask({
    aiService: {
      chat: async (request) => {
        chatCalls += 1;
        const prompt = request.messages.map((message) => message.content).join('\n');
        assert.match(prompt, /【技术文件目录状态】：明确/u);
        assert.match(prompt, /【技术文件目录状态】：未明确/u);
        assert.doesNotMatch(prompt, /anchor_ids|source-anchor|profile_id/u);
        return `${FORMAT_STATUS_EXPLICIT}\n\n# 技术文件\n\n- 技术方案`;
      },
      requestJson: async () => { jsonCalls += 1; return {}; },
    },
    fileContent: '脱敏后的当前投标范围文本',
    task,
  });
  assert.equal(chatCalls, 1);
  assert.equal(jsonCalls, 0);
  assert.equal(getResponseFileFormatStatus(result), 'explicit');
});

test('single-item format retry stores valid Markdown and rejects a missing status marker', async () => {
  const validWorkspace = createWorkspace({ status: 'error', content: '' });
  let chatCalls = 0;
  let backgroundTask = validWorkspace.getState().bidAnalysisTask;
  const updateTask = (partial) => {
    backgroundTask = { ...backgroundTask, ...partial };
    return backgroundTask;
  };
  await runBidAnalysisTask({
    aiService: {
      getConfig: () => ({}),
      chat: async () => { chatCalls += 1; return `${FORMAT_STATUS_EXPLICIT}\n\n# 技术文件`; },
    },
    workspaceStore: validWorkspace,
    updateTask,
    payload: {
      mode: 'key',
      selected_task_ids: getBidAnalysisTasks('key').map((task) => task.id),
      task_ids: ['responseFileRequirements'],
      run_id: 'run-format-test',
    },
  });
  assert.equal(chatCalls, 1);
  assert.equal(validWorkspace.getState().bidAnalysisTasks.responseFileRequirements.status, 'success');
  assert.equal(validWorkspace.getState().bidAnalysisTask.status, 'success');

  const invalidWorkspace = createWorkspace({ status: 'error', content: '' });
  backgroundTask = invalidWorkspace.getState().bidAnalysisTask;
  await runBidAnalysisTask({
    aiService: { getConfig: () => ({}), chat: async () => '# 技术文件' },
    workspaceStore: invalidWorkspace,
    updateTask,
    payload: {
      mode: 'key',
      selected_task_ids: getBidAnalysisTasks('key').map((task) => task.id),
      task_ids: ['responseFileRequirements'],
      run_id: 'run-format-test',
    },
  });
  assert.equal(invalidWorkspace.getState().bidAnalysisTasks.responseFileRequirements.status, 'error');
  assert.match(invalidWorkspace.getState().bidAnalysisTasks.responseFileRequirements.error, /缺少有效的技术文件目录状态/u);
});
