const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { app } = require('electron');
const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('../electron/services/technicalPlanStore.cjs');

function exitWithCode(code) {
  if (app?.isReady?.()) {
    app.exit(code);
    return;
  }
  process.exit(code);
}

function createFixtureApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function getBackupFiles(databasePath) {
  const directory = path.dirname(databasePath);
  const prefix = `${path.basename(databasePath)}.backup-`;
  return fs.readdirSync(directory).filter((name) => name.startsWith(prefix)).sort();
}

function seedV17Fixture(databasePath) {
  const db = new Database(databasePath);
  const timestamp = '2026-07-13T00:00:00.000Z';
  try {
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      INSERT INTO technical_plan_meta (
        id, workflow_kind, step, bid_analysis_mode, outline_mode, outline_expansion_mode,
        outline_project_name, outline_project_overview, created_at, updated_at
      ) VALUES (1, 'technical-plan', 'outline-generation', 'key', 'aligned', 'ai-complement', ?, ?, ?, ?)
    `).run('旧项目', '旧项目概况', timestamp, timestamp);
    db.prepare(`
      INSERT INTO technical_plan_bid_items (
        item_id, label, status, content, error, sort_order, updated_at
      ) VALUES ('projectOverview', '项目概况', 'success', ?, NULL, 0, ?)
    `).run('旧招标解析内容', timestamp);
    db.prepare(`
      INSERT INTO technical_plan_outline_nodes (
        node_id, parent_node_id, sort_order, level, title, description,
        source_requirement_id, source_requirement_title, knowledge_item_ids_json,
        content, created_at, updated_at
      ) VALUES ('legacy-node', NULL, 0, 1, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `).run('旧章节标题', '旧章节说明', JSON.stringify(['legacy-knowledge']), '旧章节正文', timestamp, timestamp);
    db.prepare(`
      INSERT INTO technical_plan_tasks (
        type, task_id, status, progress, logs_json, stats_json, error,
        pause_requested, started_at, updated_at
      ) VALUES ('outline-generation', 'legacy-task', 'success', 100, ?, NULL, NULL, 0, ?, ?)
    `).run(JSON.stringify(['旧任务已完成']), timestamp, timestamp);

    db.exec(`
      DROP TABLE technical_plan_response_templates;
      ALTER TABLE technical_plan_meta DROP COLUMN selected_format_profile_id;
      ALTER TABLE technical_plan_meta DROP COLUMN selected_format_profile_hash;
      ALTER TABLE technical_plan_bid_items DROP COLUMN normalized_hash;
      ALTER TABLE technical_plan_outline_nodes DROP COLUMN format_constraints_json;
      ALTER TABLE technical_plan_outline_nodes DROP COLUMN response_state_json;
      PRAGMA user_version = 17;
    `);
  } finally {
    db.close();
  }
}

function findOnlyOutlineNode(state) {
  assert.equal(state.outlineData?.outline?.length, 1);
  return state.outlineData.outline[0];
}

function assertLegacyState(state) {
  const node = findOnlyOutlineNode(state);
  assert.equal(state.step, 'bid-analysis');
  assert.equal(state.bidAnalysisTasks.projectOverview.content, '旧招标解析内容');
  assert.equal(state.outlineGenerationTask?.status, 'success');
  assert.equal(node.title, '旧章节标题');
  assert.equal(node.description, '旧章节说明');
  assert.equal(node.content, '旧章节正文');
  assert.equal(node.numbering_policy, 'auto');
  assert.equal(node.response_mode, 'freeform-markdown');
  assert.equal(node.title_locked, false);
  assert.equal(node.order_locked, false);
  assert.equal(node.level_locked, false);
  assert.deepEqual(node.knowledge_item_ids, ['legacy-knowledge']);
}

function assertThrowsClosed(store, db, column, badValue, expectedMessage) {
  const previous = db.prepare(`SELECT ${column} AS value FROM technical_plan_outline_nodes WHERE node_id = ?`).get('legacy-node').value;
  db.prepare(`UPDATE technical_plan_outline_nodes SET ${column} = ? WHERE node_id = ?`).run(badValue, 'legacy-node');
  assert.throws(() => store.loadTechnicalPlan(), expectedMessage);
  db.prepare(`UPDATE technical_plan_outline_nodes SET ${column} = ? WHERE node_id = ?`).run(previous, 'legacy-node');
  assert.doesNotThrow(() => store.loadTechnicalPlan());
}

function runSmoke() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openjatobid-format-smoke-'));
  const fixtureApp = createFixtureApp(userDataPath);
  let connection;
  try {
    connection = createSqliteDatabase(fixtureApp);
    const databasePath = connection.path;
    assert.equal(connection.schemaVersion, 18);
    connection.close();
    connection = null;

    seedV17Fixture(databasePath);
    assert.deepEqual(getBackupFiles(databasePath), []);

    connection = createSqliteDatabase(fixtureApp);
    assert.equal(connection.schemaVersion, 18);
    assert.equal(connection.db.pragma('user_version', { simple: true }), 18);
    const backupsAfterUpgrade = getBackupFiles(databasePath);
    assert.equal(backupsAfterUpgrade.length, 1, 'v17 -> v18 升级前应生成一份数据库备份');
    assertLegacyState(createTechnicalPlanStore({ app: fixtureApp, db: connection.db }).loadTechnicalPlan());
    connection.close();
    connection = null;

    connection = createSqliteDatabase(fixtureApp);
    assert.equal(connection.db.pragma('user_version', { simple: true }), 18);
    assert.deepEqual(getBackupFiles(databasePath), backupsAfterUpgrade, '重复打开 v18 数据库不应重复迁移或备份');

    const store = createTechnicalPlanStore({ app: fixtureApp, db: connection.db });
    assertLegacyState(store.loadTechnicalPlan());

    const responseTemplate = {
      template_id: 'template-commitment-1',
      kind: 'locked-commitment',
      analysis_item_id: 'bidDocumentFormatRequirements',
      profile_id: 'format-profile-1',
      format_node_id: 'format-node-1',
      source_title: '投标承诺函',
      source_location: {
        source_file_id: 'tender-file-1',
        source_file_name: '招标文件.md',
        markdown_line_start: 10,
        markdown_line_end: 18,
        excerpt: '我方郑重承诺：',
      },
      template: {
        kind: 'locked-commitment',
        segments: [
          { type: 'locked', text: '我方郑重承诺：' },
          { type: 'slot', slot_id: 'company-name', label: '投标人名称', value_source: 'company-knowledge', required: true },
        ],
      },
      confirmed: false,
    };
    const constrainedNode = {
      id: 'legacy-node',
      title: '旧章节标题',
      description: '旧章节说明',
      content: '旧章节正文',
      format_node_id: 'format-node-1',
      source_number: '1.1',
      source_title: '投标承诺函',
      numbering_policy: 'preserve-source',
      required_in_outline: true,
      response_required: true,
      title_locked: true,
      order_locked: true,
      level_locked: true,
      response_mode: 'locked-commitment',
      allow_ai_children: false,
      template_id: responseTemplate.template_id,
      missing_evidence_risk: 'potential-rejection',
      mapped_requirement_ids: ['requirement-1'],
      template_values: {
        template_id: responseTemplate.template_id,
        slot_values: { 'company-name': '测试投标人' },
        knowledge_item_ids: ['knowledge-1'],
        missing_slots: [],
      },
      knowledge_item_ids: ['knowledge-1'],
      response_status: 'responded-substantive',
      compliance_risk: 'warning',
      compliance_message: '待人工复核承诺内容',
    };

    store.updateTechnicalPlan({ outlineData: null });
    let state = store.updateTechnicalPlan({
      selectedFormatProfileId: 'format-profile-1',
      selectedFormatProfileHash: 'format-profile-hash-1',
      responseTemplates: [responseTemplate],
      bidAnalysisTasks: {
        ...store.loadTechnicalPlan().bidAnalysisTasks,
        projectOverview: {
          ...store.loadTechnicalPlan().bidAnalysisTasks.projectOverview,
          normalized_hash: 'normalized-bid-hash-1',
        },
        bidDocumentFormatRequirements: {
          id: 'bidDocumentFormatRequirements',
          label: '格式要求',
          status: 'success',
          content: JSON.stringify({ schema_version: 1, has_explicit_technical_format: true, profiles: [], template_ids: [responseTemplate.template_id] }),
          normalized_hash: 'format-analysis-hash-1',
        },
      },
      outlineData: {
        outline: [constrainedNode],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    });

    assert.equal(state.selectedFormatProfileId, 'format-profile-1');
    assert.equal(state.selectedFormatProfileHash, 'format-profile-hash-1');
    assert.equal(state.bidAnalysisTasks.projectOverview.normalized_hash, 'normalized-bid-hash-1');
    assert.equal(state.responseTemplates.length, 1);
    assert.deepEqual(state.responseTemplates[0].template, responseTemplate.template);
    let node = findOnlyOutlineNode(state);
    assert.equal(node.format_node_id, 'format-node-1');
    assert.equal(node.numbering_policy, 'preserve-source');
    assert.equal(node.response_mode, 'locked-commitment');
    assert.equal(node.response_status, 'responded-substantive');
    assert.equal(node.compliance_risk, 'warning');
    assert.deepEqual(node.template_values, constrainedNode.template_values);

    state = store.confirmResponseTemplate({ templateId: responseTemplate.template_id, template: responseTemplate.template });
    assert.equal(state.responseTemplates[0].confirmed, true);
    assert.match(state.responseTemplates[0].locked_hash, /^[a-f0-9]{64}$/);
    state = store.saveLockedTemplateValues({
      nodeId: 'legacy-node',
      templateId: responseTemplate.template_id,
      slotValues: { 'company-name': '测试投标人' },
    });
    node = findOnlyOutlineNode(state);
    assert.equal(node.content, '我方郑重承诺：测试投标人');
    assert.equal(node.response_status, 'responded-substantive');
    assert.throws(() => store.saveChapterContent({ nodeId: 'legacy-node', content: '伪造完整承诺函' }), /受控模板|不能覆盖/);

    state = store.saveGlobalFacts([]);
    node = findOnlyOutlineNode(state);
    assert.equal(node.content, '我方郑重承诺：测试投标人', '全局事实变化不得清空受控模板正文却保留旧状态');
    assert.equal(node.response_status, 'responded-substantive');
    assert.deepEqual(node.template_values.slot_values, { 'company-name': '测试投标人' });

    const rawRoundTrip = connection.db.prepare(`
      SELECT format_constraints_json, response_state_json
      FROM technical_plan_outline_nodes
      WHERE node_id = ?
    `).get('legacy-node');
    assert.equal(JSON.parse(rawRoundTrip.format_constraints_json).format_node_id, 'format-node-1');
    assert.equal(JSON.parse(rawRoundTrip.response_state_json).response_status, 'responded-substantive');

    state = store.saveOutline({
      reason: 'sort',
      outlineData: {
        outline: [{ id: 'legacy-node', title: '旧章节标题', description: 'Renderer 未回传新增字段' }],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    });
    node = findOnlyOutlineNode(state);
    assert.equal(node.format_node_id, 'format-node-1');
    assert.equal(node.numbering_policy, 'preserve-source');
    assert.equal(node.response_mode, 'locked-commitment');
    assert.equal(node.response_status, 'responded-substantive');
    assert.equal(node.compliance_risk, 'none');
    assert.deepEqual(node.template_values.slot_values, { 'company-name': '测试投标人' });
    assert.equal(node.knowledge_item_ids, undefined);

    assertThrowsClosed(store, connection.db, 'format_constraints_json', '{broken-format-json', /目录格式约束|JSON|损坏/);
    assertThrowsClosed(store, connection.db, 'response_state_json', '[]', /目录响应状态|对象|损坏/);

    assert.throws(() => store.saveOutline({
      reason: 'edit',
      outlineData: {
        outline: [{ ...node, title: '试图改名固定目录' }],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    }), /标题不可修改/);
    assert.throws(() => store.saveOutline({
      reason: 'delete',
      outlineData: { outline: [], project_name: '旧项目', project_overview: '旧项目概况' },
    }), /不可删除/);
    assert.throws(() => store.saveOutline({
      reason: 'add-root',
      outlineData: {
        outline: [node, { id: '2', title: '非法并列目录', description: '' }],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    }), /不允许新增并列一级目录/);

    assert.throws(() => store.updateTechnicalPlan({
      outlineData: {
        outline: [{ ...node, response_mode: 'freeform-markdown' }],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    }), /约束|response_mode|固定目录/);
    assert.throws(() => store.updateTechnicalPlan({
      outlineData: {
        outline: [{ ...node, id: 'renumbered-node', content: '通过换 ID 伪造固定正文' }],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    }), /受控响应|专用|固定/);

    state = store.saveStructuredBidAnalysisResult({
      task: {
        id: 'bidDocumentFormatRequirements',
        label: '格式要求',
        status: 'success',
        content: JSON.stringify({ schema_version: 1, has_explicit_technical_format: true, profiles: [], template_ids: [responseTemplate.template_id] }),
      },
      normalizedHash: 'format-analysis-hash-1',
      responseTemplates: [{ ...responseTemplate, confirmed: false, locked_hash: undefined }],
    });
    assert.ok(state.outlineData, '相同完整格式 Hash 必须保留现有目录');
    assert.equal(state.responseTemplates[0].confirmed, true, '相同完整格式 Hash 必须保留模板确认状态');

    state = store.saveOutlineConfig({
      referenceKnowledgeDocumentIds: [],
      outlineExpansionMode: 'ai-complement',
      selectedFormatProfileId: 'format-profile-1',
    });
    assert.ok(state.outlineData, '重复保存相同 profile 不得清理目录');
    assert.equal(state.responseTemplates[0].confirmed, true, '重复保存相同 profile 不得重置模板确认');

    state = store.saveOutlineConfig({
      referenceKnowledgeDocumentIds: [],
      outlineExpansionMode: 'ai-complement',
      selectedFormatProfileId: 'format-profile-2',
    });
    assert.equal(
      connection.db.prepare('SELECT step FROM technical_plan_meta WHERE id = 1').get().step,
      'outline-generation',
      '切换格式 profile 必须把持久化步骤退回目录生成',
    );
    assert.equal(state.step, 'bid-analysis', '旧夹具缺少 7 项关键解析，加载门禁应继续退回招标解析');
    assert.equal(state.outlineData, null, '切换格式 profile 必须事务性失效旧目录');
    assert.equal(state.selectedFormatProfileId, 'format-profile-2');
    assert.equal(state.selectedFormatProfileHash, undefined);
    assert.equal(state.responseTemplates[0].confirmed, false, '切换格式 profile 必须重置模板确认状态');

    state = store.updateTechnicalPlan({
      selectedFormatProfileId: 'format-profile-1',
      selectedFormatProfileHash: 'format-profile-hash-1',
      outlineData: {
        outline: [constrainedNode],
        project_name: '旧项目',
        project_overview: '旧项目概况',
      },
    });

    state = store.saveStructuredBidAnalysisResult({
      task: {
        id: 'bidDocumentFormatRequirements',
        label: '格式要求',
        status: 'success',
        content: JSON.stringify({ schema_version: 1, has_explicit_technical_format: true, profiles: [], template_ids: [responseTemplate.template_id] }),
      },
      normalizedHash: 'format-analysis-hash-2',
      responseTemplates: [{ ...responseTemplate, confirmed: false, locked_hash: undefined }],
    });
    assert.equal(state.outlineData, null, '格式 Hash 变化必须事务性失效旧目录');
    assert.equal(state.selectedFormatProfileId, undefined);
    assert.equal(state.selectedFormatProfileHash, undefined);
    assert.equal(state.responseTemplates[0].confirmed, false, '格式 Hash 变化必须重置模板确认状态');

    console.log('[technical-plan-format-smoke] v17 -> v18 migration, persistence, fail-closed JSON, and omission preservation passed.');
    connection.close();
    connection = null;
    fs.rmSync(userDataPath, { recursive: true, force: true });
    exitWithCode(0);
  } catch (error) {
    if (connection) connection.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
    console.error('[technical-plan-format-smoke] failed.');
    console.error(error?.stack || error?.message || String(error));
    exitWithCode(1);
  }
}

if (app?.whenReady) {
  app.whenReady().then(runSmoke, (error) => {
    console.error('[technical-plan-format-smoke] Electron app failed to become ready.');
    console.error(error?.stack || error?.message || String(error));
    exitWithCode(1);
  });
} else {
  runSmoke();
}
