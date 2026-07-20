const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hookPath = path.join(__dirname, 'useTechnicalPlanWorkflow.ts');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const homePath = path.resolve(__dirname, '../pages/TechnicalPlanHome.tsx');
const homeSource = fs.readFileSync(homePath, 'utf8');

test('后台任务回放后以工作区完整快照清除已失效的运行态', () => {
  assert.match(hookSource, /export function normalizeTechnicalPlanState\(/);
  assert.match(hookSource, /setState\(normalizeTechnicalPlanState\(cachedState\)\);/);
  assert.match(homeSource, /getActiveTasks\(\)\.then\(async \(\) =>/);
  assert.match(homeSource, /const latestState = await window\.yibiao\?\.technicalPlan\.loadState\(\);/);
  assert.match(homeSource, /setState\(normalizeTechnicalPlanState\(latestState\)\);/);
});
