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

test('质量诊断定位非开头精确重复和轻微改写候选，不改变准入语义', () => {
  const exact = '接收资料后逐项核对项目名称、单位名称、主题文案、数字及计量单位，发现不一致时集中汇总并完成复核。';
  const nearLeft = '版面完成后，将校样与确认文稿逐项对照，检查文字遗漏、图文对应和标识一致性，再提交确认版本。';
  const nearRight = '版面完成之后，将校样同确认文稿逐项对照，检查文字遗漏、图文对应和标识一致性，再提交确认版本。';
  const audit = auditContentQuality({
    contexts,
    sections: {
      '1.1.1': { content: `不同开头内容。\n\n${exact}\n\n${nearLeft}` },
      '1.2.1': { content: `另一个不同开头。\n\n${exact}\n\n${nearRight}` },
    },
    plans: {},
    requirementResponseMatrix: { scoring_points: [], rejection_risks: [], hidden_requirements: [] },
  });
  assert.ok(audit.editorial.duplicates.some((item) => item.type === 'exact-paragraph' && item.left_paragraph_index > 0));
  assert.ok(audit.editorial.duplicates.some((item) => item.type === 'near-paragraph' && item.left_excerpt !== item.right_excerpt));
  assert.equal(audit.can_proceed, true);
});

test('质量诊断保留数值和否定差异，忽略受保护表格，并识别碎片句', () => {
  const positive = '现场检查每周执行2次，完成后形成记录并交由项目负责人复核，确认问题全部关闭后归档。';
  const negative = '现场检查每周不得执行3次，完成后形成记录并交由项目负责人复核，确认问题全部关闭后归档。';
  const table = '| 项目 | 要求 |\n| --- | --- |\n| 质保 | 按招标文件执行 |';
  const audit = auditContentQuality({
    contexts,
    sections: {
      '1.1.1': { content: `${positive}\n\n${table}\n\n我们核对文字。我们核对数字。我们统一格式。我们形成记录。` },
      '1.2.1': { content: `${negative}\n\n${table}` },
    },
    plans: {},
    requirementResponseMatrix: { scoring_points: [], rejection_risks: [], hidden_requirements: [] },
  });
  assert.equal(audit.editorial.duplicates.length, 0);
  assert.equal(audit.editorial.fragmented_expressions[0].node_id, '1.1.1');
});
