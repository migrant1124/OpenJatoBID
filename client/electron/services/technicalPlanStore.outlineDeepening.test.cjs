const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

function createTestApp(userDataPath) {
  const app = new EventEmitter();
  app.getPath = () => userDataPath;
  return app;
}

function matrix() {
  return {
    schema_version: 1,
    revision: 'store-deepening',
    scoring_points: [{
      scoring_point_id: 'R1.P1', group_requirement_id: 'R1', title: '实施', requirement_text: '明确实施方案', scoring_rule: '完整得分', source_refs: [],
      mandatory_level: 'important', expected_response_types: ['content'], high_score_conditions: ['职责清晰'], mapped_node_ids: ['1.1'], primary_node_id: '1.1', status: 'mapped',
    }],
    rejection_risks: [], hidden_requirements: [], value_anchors: [],
  };
}

test('应用局部深化仅失效目标子树的计划和状态，并保留旧正文素材', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-deepening-'));
  const app = createTestApp(userDataPath);
  const sqlite = createSqliteDatabase(app);
  const store = createTechnicalPlanStore({ app, db: sqlite.db, fileService: {} });

  try {
    store.updateTechnicalPlan({
      requirementResponseMatrix: matrix(),
      outlineData: {
        outline: [{ id: '1', title: '技术方案', description: '技术方案', children: [{
          id: '1.1', title: '实施方案', description: '实施方案', deep_writing: false, deep_writing_recommended: false, writing_profile: 'standard',
          mapped_scoring_point_ids: ['R1.P1'], value_anchor_ids: [], children: [{
            id: '1.1.1', title: '组织', description: '组织', children: [{ id: '1.1.1.1', title: '职责', description: '职责', content: '原职责正文' }],
          }],
        }, {
          id: '1.2', title: '服务承诺', description: '服务承诺', children: [{ id: '1.2.1', title: '响应', description: '响应', content: '保留正文' }],
        }] }],
      },
    });
    sqlite.db.prepare("INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at) VALUES ('1.1.1.1', 'success', NULL, '2026-01-01T00:00:00.000Z'), ('1.2.1', 'success', NULL, '2026-01-01T00:00:00.000Z')").run();
    sqlite.db.prepare("INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at) VALUES ('1.1.1.1', '{\"plan_version\":4,\"plan\":{}}', '2026-01-01T00:00:00.000Z'), ('1.2.1', '{\"plan_version\":4,\"plan\":{}}', '2026-01-01T00:00:00.000Z')").run();
    store.updateTechnicalPlan({ contentIllustrationPlan: { plan: { items: [{ section_ids: ['1.1.1.1'] }, { section_ids: ['1.2.1'] }] } } });

    const saved = store.applyOutlineDeepening({
      patch: {
        schema_version: 1, target_node_id: '1.1', deep_writing: true, deep_writing_reason: '评分点复杂',
        additions: [{ parent_id: '1.1.1.1', title: '岗位交接', description: '明确交接产物' }],
      },
    });

    const target = saved.outlineData.outline[0].children[0];
    assert.equal(target.deep_writing, true);
    assert.equal(target.children[0].children[0].children[0].id, '1.1.1.1.1');
    assert.equal(target.children[0].children[0].content, '原职责正文');
    assert.equal(saved.contentGenerationSections['1.1.1.1'], undefined);
    assert.equal(saved.contentGenerationSections['1.2.1'].content, '保留正文');
    assert.equal(saved.contentGenerationPlans['1.1.1.1'], undefined);
    assert.ok(saved.contentGenerationPlans['1.2.1']);
    assert.deepEqual(saved.contentIllustrationPlan.plan.items.map((item) => item.section_ids[0]), ['1.2.1']);

    const cancelled = store.setOutlineDeepWriting({ targetNodeId: '1.1', deepWriting: false });
    const cancelledTarget = cancelled.outlineData.outline[0].children[0];
    assert.equal(cancelledTarget.deep_writing, false);
    assert.equal(cancelledTarget.deep_writing_source, 'user');
    assert.equal((cancelledTarget.children[0].children[0].children || []).length, 0);
  } finally {
    sqlite.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
