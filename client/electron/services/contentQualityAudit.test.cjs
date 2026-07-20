'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { auditContentQuality, rankContentExpansionCandidates } = require('./contentQualityAudit.cjs');

const contexts = [
  { item: { id: '1.1.1', title: '实施步骤' }, parentChapters: [{ id: '1' }, { id: '1.1' }] },
  { item: { id: '1.2.1', title: '售后服务' }, parentChapters: [{ id: '1' }, { id: '1.2' }] },
];

test('评分价值和合同缺口优先级不再按最短正文排序', () => {
  const ranked = rankContentExpansionCandidates(contexts, {
    sections: { '1.1.1': { content: '实施内容'.repeat(100) }, '1.2.1': { content: '短' } },
    plans: { '1.1.1': { plan: { writing_profile: 'deep', target_words: { min: 300, preferred: 800 }, value_anchor_ids: ['A1'], evidence_requirements: ['证明'] } }, '1.2.1': { plan: { writing_profile: 'standard', target_words: { min: 100, preferred: 100 } } } },
    requirementResponseMatrix: { scoring_points: [{ primary_node_id: '1.1', mandatory_level: 'high' }] },
  });
  assert.equal(ranked[0].context.item.id, '1.1.1');
});

test('质量审核输出评分覆盖、执行性、合规和模拟评分', () => {
  const audit = auditContentQuality({
    contexts,
    sections: { '1.1.1': { content: '实施动作、参数阈值、验收交付和闭环'.repeat(20) }, '1.2.1': { content: '' } },
    plans: { '1.1.1': { plan: { writing_profile: 'deep' } }, '1.2.1': { plan: { writing_profile: 'standard' } } },
    requirementResponseMatrix: { scoring_points: [{ scoring_point_id: 'R1.P1', primary_node_id: '1.1' }, { scoring_point_id: 'R2.P1', primary_node_id: '1.2' }], rejection_risks: [], hidden_requirements: [] },
  });
  assert.equal(audit.label, '模拟评分/预估');
  assert.deepEqual(audit.scoring_coverage.uncovered_scoring_point_ids, ['R2.P1']);
  assert.equal(audit.reviewer_simulation.items.length, 2);
});
