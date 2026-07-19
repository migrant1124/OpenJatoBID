const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase, schemaVersion } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

function createTestApp(userDataPath) {
  const app = new EventEmitter();
  app.getPath = (name) => {
    assert.equal(name, 'userData');
    return userDataPath;
  };
  return app;
}

test('v1.4.5 质量矩阵和目录质量字段可持久化且旧字段保持兼容', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-quality-'));
  const app = createTestApp(userDataPath);
  const sqlite = createSqliteDatabase(app);
  const store = createTechnicalPlanStore({ app, db: sqlite.db, fileService: {} });

  try {
    assert.equal(schemaVersion, 20);
    store.updateTechnicalPlan({
      outlineData: {
        outline: [{
          id: '2',
          title: '实施方案',
          description: '项目实施总体安排',
          deep_writing: true,
          deep_writing_recommended: true,
          deep_writing_reason: '对应核心评分项',
          deep_writing_source: 'ai',
          writing_profile: 'deep',
          value_anchor_ids: ['A1'],
          mapped_scoring_point_ids: ['R1.P1'],
        }],
      },
      requirementResponseMatrix: {
        schema_version: 1,
        revision: 'matrix-1',
        scoring_points: [{
          scoring_point_id: 'R1.P1',
          group_requirement_id: 'R1',
          title: '实施方案完整性',
          requirement_text: '提供完整实施方案',
          scoring_rule: '完整得分',
          source_refs: [],
          mandatory_level: 'important',
          expected_response_types: ['content'],
          high_score_conditions: ['包含实施安排'],
          mapped_node_ids: ['2'],
          primary_node_id: '2',
          status: 'mapped',
        }],
        rejection_risks: [],
        hidden_requirements: [],
        value_anchors: [{
          anchor_id: 'A1',
          title: '进度保障',
          category: 'schedule-assurance',
          base_scoring_point_ids: ['R1.P1'],
          business_value: '突出进度可执行性',
          directory_recommended: false,
          deep_writing_recommended: true,
          support_state: 'industry-template',
          content_requirements: ['说明进度控制机制'],
          table_recommendations: [],
          visual_recommendations: [],
          risk_notes: [],
          route: 'writing',
          status: 'accepted',
        }],
      },
      outlineQualityReview: { can_proceed: true, warnings: [] },
      contentGenerationPlans: {
        '2': {
          plan_version: 5,
          plan: { section_role: '实施总体安排' },
          fingerprint: { outline_node_hash: 'node-v1', prompt_version: 'content-plan-v5' },
        },
      },
    });

    const loaded = store.loadTechnicalPlan();
    const item = loaded.outlineData.outline[0];
    assert.equal(item.deep_writing, true);
    assert.equal(item.writing_profile, 'deep');
    assert.deepEqual(item.value_anchor_ids, ['A1']);
    assert.deepEqual(loaded.requirementResponseMatrix.scoring_points[0].mapped_node_ids, ['2']);
    assert.equal(loaded.outlineQualityReview.can_proceed, true);
    assert.equal(loaded.contentGenerationPlans['2'].fingerprint.prompt_version, 'content-plan-v5');

    const columns = sqlite.db.prepare('PRAGMA table_info(technical_plan_outline_nodes)').all().map((row) => row.name);
    assert.ok(columns.includes('quality_metadata_json'));
    assert.ok(sqlite.db.prepare('SELECT requirement_response_matrix_json FROM technical_plan_meta WHERE id = 1').get().requirement_response_matrix_json);
  } finally {
    sqlite.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
