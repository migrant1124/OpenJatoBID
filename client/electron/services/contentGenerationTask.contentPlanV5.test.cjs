'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { __contentPlanContractRuntime } = require('./contentGenerationTask.cjs');

function contract() {
  return {
    writing_profile: 'deep',
    section_role: '承担实施方案的闭环说明',
    scoring_point_ids: ['R1.P1'], value_anchor_ids: ['A1'],
    must_answer_questions: ['如何形成实施闭环'], key_claims: ['按项目实际资料执行'],
    implementation_steps: ['启动', '执行', '验收'], quantitative_details: ['阈值待确认'],
    deliverables: ['实施记录'], acceptance_criteria: ['验收确认'], evidence_requirements: ['待提供证明材料'],
    cross_section_boundaries: { owns: ['实施闭环'], excludes: ['售后服务'], related_node_ids: ['1.1.1'] },
    knowledge: { item_ids: ['K1'] }, facts: { titles: ['项目地点'] },
    table: { needed: true, purpose: '展示实施步骤' },
    table_briefs: [{ title: '实施步骤表', purpose: '展示阶段和产物', columns: ['阶段', '产物'] }],
    illustration_briefs: [{ title: '实施闭环图', purpose: '展示闭环', visual_role: '流程说明' }],
    target_words: { min: 300, preferred: 500, max: 800 }, forbidden_repetition: ['售后服务细则'],
  };
}

test('Content Plan v5 保留完整章节写作合同并拒绝 v4 复用', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan(contract(), new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  assert.doesNotThrow(() => __contentPlanContractRuntime.validateContentPlan(plan));
  const stored = __contentPlanContractRuntime.createStoredContentPlan(plan, 'moderate', { prompt_version: 'content-plan-v5' });
  assert.equal(stored.plan_version, 5);
  assert.equal(__contentPlanContractRuntime.normalizeStoredContentPlan(stored).plan.writing_profile, 'deep');
  assert.equal(__contentPlanContractRuntime.normalizeStoredContentPlan({ plan_version: 4, plan }), null);
});

test('深度写作合同进入正文提示词，编排提示词要求完整合同', () => {
  const plan = __contentPlanContractRuntime.normalizeContentPlan(contract(), new Set(['K1']), new Set(['项目地点']), { writingProfile: 'deep' });
  const contentPrompt = __contentPlanContractRuntime.buildChapterContentMessages({
    chapter: { id: '1.1.1', title: '实施步骤', description: '实施闭环' }, projectOverview: '', selectedFactsText: '', regenerateRequirement: '', contentPlan: plan, knowledgeContents: [],
  }).map((message) => message.content).join('\n');
  assert.match(contentPrompt, /深度写作/);
  assert.match(contentPrompt, /实施闭环/);
  const planningPrompt = __contentPlanContractRuntime.buildChapterContentPlanMessages({
    chapter: { id: '1.1.1', title: '实施步骤', description: '实施闭环' }, parentChapters: [], siblingChapters: [], projectOverview: '', bidAnalysisFactsText: '', globalFactTitlesText: '', regenerateRequirement: '', tableRequirement: 'moderate', maxTables: 2, tableTotalSections: 1, knowledgeItems: [], writingProfile: 'deep', chapterWritingTask: { chapter_node_id: '1.1' },
  }).map((message) => message.content).join('\n');
  assert.match(planningPrompt, /SectionWritingContract/);
  assert.match(planningPrompt, /"writing_profile": "deep"/);
});
