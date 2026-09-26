const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('../electron/services/technicalPlanStore.cjs');
const { createTechnicalPlanProjects } = require('../electron/services/technicalPlanProjects.cjs');

const testUserData = process.env.JATO_V175_TEST_USERDATA;
if (!testUserData || !path.isAbsolute(testUserData)) throw new Error('JATO_V175_TEST_USERDATA 必须是测试目录的绝对路径');
fs.mkdirSync(testUserData, { recursive: true });
app.setPath('userData', testUserData);

async function seed() {
  const sqlite = createSqliteDatabase(app);
  const sourcePath = path.join(testUserData, 'synthetic-tender.txt');
  fs.writeFileSync(sourcePath, '合成项目资料，仅用于 v1.7.5 UI 验证。\n技术服务方案包含实施流程。', 'utf8');
  const fileService = { importDocument: async () => ({ success: true, file_content: '合成项目资料，仅用于 v1.7.5 UI 验证。\n技术服务方案包含实施流程。', documents: [{
    file_name: 'synthetic-tender.txt', file_content: '合成项目资料，仅用于 v1.7.5 UI 验证。\n技术服务方案包含实施流程。',
    file_path: sourcePath, source_hash: 'synthetic-v175-tender', parser_label: '本地解析',
  }] }) };
  const legacyStore = createTechnicalPlanStore({ app, db: sqlite.db, fileService });
  const projects = createTechnicalPlanProjects({ app, db: sqlite.db, fileService, legacyStore });
  if (!projects.list().length) {
    projects.create({ name: '合成项目A', buyer: '合成采购人', projectNumber: 'SYN-001', lot: '标包一' });
    await projects.store.importTenderDocument();
    const procurementSummary = Object.fromEntries(['target_name', 'package_name', 'package_amount', 'procurement_scope', 'delivery_period', 'delivery_location', 'implementation_scope'].map((key) => [key, '未提供']));
    const quotationSummary = Object.fromEntries(['pricing_method', 'price_evaluation_method', 'price_limit_rule', 'settlement_method', 'platform_or_transaction_requirements', 'tax_and_fee_requirements'].map((key) => [key, '未提供']));
    quotationSummary.invalid_quote_rules = []; quotationSummary.other_explicit_rules = [];
    const procurement = { schema_version: 2, procurement_summary: procurementSummary, quotation_summary: quotationSummary,
      quotation_table: { exists: false, table_name: '', item_count_or_range: '', columns: [], representative_item_categories: [], source_note: '' }, quote_documents: [] };
    const tasks = Object.fromEntries(projects.store.loadTechnicalPlan().bidAnalysisTaskDefinitions.filter((task) => task.required).map((task) => [task.id, {
      status: 'success', content: task.id === 'responseFileRequirements' ? '【技术文件目录状态】：未明确\n未找到明确技术文件目录格式。'
        : JSON.stringify(task.id === 'procurementList' ? procurement : { project_name: '合成项目A', note: '合成测试结果' }),
    }]));
    projects.store.updateTechnicalPlan({ bidAnalysisTasks: tasks, bidAnalysisSelectedTaskIds: Object.keys(tasks), bidAnalysisMode: 'key', bidSectionMode: 'single' });
    projects.store.saveOutline({ outlineData: { project_name: '合成项目A', outline: [{ id: '1', title: '技术服务方案', description: '合成编写说明', children: [{ id: '1.1', title: '实施流程', children: [] }] }] }, reason: 'replace' });
    projects.store.updateStep('document-analysis');
    projects.leave();
    projects.create({ name: '合成项目B' });
    projects.leave();
  }
  projects.close();
  sqlite.close();
}

seed().then(() => require('../electron/bootstrap.cjs')).catch((error) => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
