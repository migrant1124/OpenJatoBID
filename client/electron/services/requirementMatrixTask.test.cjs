const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAnalysisContext,
  buildRequirementMatrixPrompt,
  runRequirementMatrixTask,
} = require('./requirementMatrixTask.cjs');

test('评分响应矩阵提示词要求原子评分点、风险与隐性要求分流', () => {
  const context = buildAnalysisContext({
    projectOverview: '项目包含实施与验收。',
    techRequirements: '技术评分包含实施计划和质量控制。',
    bidAnalysisTasks: {
      discardedBids: { content: '未按要求提交附件可能否决。' },
    },
  });
  const prompt = buildRequirementMatrixPrompt(context);

  assert.match(prompt, /原子评分点/u);
  assert.match(prompt, /否决/u);
  assert.match(prompt, /隐性要求/u);
  assert.match(prompt, /R1\.P1/u);
  assert.match(prompt, /项目包含实施与验收/u);
  assert.match(prompt, /不得编造/u);
});

test('评分响应矩阵摘要限制长度并只选取相关解析结果', () => {
  const context = buildAnalysisContext({
    projectOverview: 'A'.repeat(30000),
    bidAnalysisTasks: {
      responseFileRequirements: { content: '格式要求' },
    },
  });

  assert.ok(context.length <= 24000);
  assert.match(context, /项目概述/u);
});

test('评分响应矩阵任务只在合法矩阵通过规范化后写入工作区', async () => {
  let state = {
    projectOverview: '项目概述',
    techRequirements: '技术评分要求',
    bidAnalysisTasks: {},
  };
  const updates = [];
  const matrix = {
    schema_version: 1,
    revision: 'matrix-test',
    scoring_points: [{
      scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施计划', requirement_text: '提交实施计划', scoring_rule: '完整得分',
      source_refs: [], mandatory_level: 'important', expected_response_types: ['content'], high_score_conditions: ['明确阶段'], mapped_node_ids: [], status: 'unmapped',
    }],
    rejection_risks: [], hidden_requirements: [], value_anchors: [],
  };
  const workspaceStore = {
    loadTechnicalPlan: () => state,
    readTenderMarkdown: () => '招标文件原文',
    updateTechnicalPlan: (partial) => {
      updates.push(partial);
      state = { ...state, ...partial };
      return state;
    },
  };
  const taskUpdates = [];

  await runRequirementMatrixTask({
    aiService: { getConfig: () => ({}) },
    workspaceStore,
    updateTask: (patch) => {
      taskUpdates.push(patch);
      return { task_id: 'matrix-task', ...patch };
    },
    runPromptTask: async () => JSON.stringify(matrix),
  });

  assert.equal(state.requirementResponseMatrix.revision, 'matrix-test');
  assert.equal(state.requirementResponseMatrix.scoring_points.length, 1);
  assert.equal(taskUpdates.at(-1).status, 'success');
  assert.equal(updates.filter((item) => item.requirementResponseMatrix).length, 1);
});
