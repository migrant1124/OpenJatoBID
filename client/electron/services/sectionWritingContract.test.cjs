'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTENT_PLAN_VERSION,
  buildChapterWritingTask,
  buildContentPlanFingerprint,
  isSameContentPlanFingerprint,
  validateSectionWritingContract,
} = require('./sectionWritingContract.cjs');

test('章节写作合同指纹会覆盖目录、矩阵、事实和知识库版本', () => {
  assert.equal(CONTENT_PLAN_VERSION, 5);
  const context = {
    item: { id: '1.1.1', title: '实施步骤', description: '说明实施闭环', deep_writing: true, writing_profile: 'deep' },
    parentChapters: [{ id: '1', title: '技术方案' }, { id: '1.1', title: '实施方案', value_anchor_ids: ['A1'] }],
  };
  const base = buildContentPlanFingerprint({
    context,
    requirementResponseMatrix: { revision: 'r1' },
    globalFacts: [{ id: 'F1', title: '项目地点', content: '广州' }],
    knowledgeDocumentRevisions: ['K1:a'],
  });
  assert.equal(base.writing_profile, 'deep');
  assert.equal(isSameContentPlanFingerprint(base, { ...base }), true);
  assert.equal(isSameContentPlanFingerprint(base, { ...base, scoring_matrix_revision: 'r2' }), false);
});

test('章节任务书按二级目录共享评分职责且合同校验完整字段', () => {
  const contexts = [{
    item: { id: '1.1.1', title: '实施步骤', description: '实施步骤' },
    parentChapters: [{ id: '1', title: '技术方案' }, { id: '1.1', title: '实施方案', value_anchor_ids: ['A1'] }],
  }];
  const task = buildChapterWritingTask(contexts, { scoring_points: [{ scoring_point_id: 'R1.P1', primary_node_id: '1.1', high_score_conditions: ['闭环'] }] });
  assert.deepEqual(task.scoring_point_ids, ['R1.P1']);
  assert.deepEqual(task.value_anchor_ids, ['A1']);
  assert.doesNotThrow(() => validateSectionWritingContract({
    writing_profile: 'deep', section_role: '实施步骤', scoring_point_ids: ['R1.P1'], value_anchor_ids: ['A1'],
    must_answer_questions: ['如何闭环'], key_claims: [], implementation_steps: [], quantitative_details: [], deliverables: [], acceptance_criteria: [], evidence_requirements: [],
    cross_section_boundaries: { owns: ['实施'], excludes: [], related_node_ids: ['1.1.1'] },
    knowledge: { item_ids: [] }, facts: { titles: [] }, table_briefs: [], illustration_briefs: [],
    target_words: { min: 300, preferred: 500, max: 800 }, forbidden_repetition: [],
  }));
});
