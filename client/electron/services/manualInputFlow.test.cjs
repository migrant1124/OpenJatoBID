const assert = require('node:assert/strict');
const test = require('node:test');

const { __developerContentExpansionPatchRuntime } = require('./contentGenerationTask.cjs');
const { deriveResponseCompletion, protectWriteForResponseMode } = require('./contentResponseModes.cjs');
const { resolveTechnicalPlanExportPayload } = require('./exportService.cjs');

function fakeStore(outline) {
  return {
    loadTechnicalPlan: () => ({ outlineData: { project_name: '测试项目', outline } }),
    validateProtectedResponses: () => ({ valid: true }),
  };
}

test('人工祖先的全部叶子继承 AI 禁写，且不阻止导出', () => {
  const manual = {
    id: '1.1', title: '人工编制章节', description: '请人工填写合同与证明材料。',
    manual_input_required: true, content: '',
  };
  const normal = { id: '1.2', title: '实施方案', description: '生成实施措施', allow_ai_children: true };
  const outline = [{ id: '1', title: '技术文件', description: '目录', manual_input_required: true, children: [manual, normal] }];

  assert.deepEqual(
    __developerContentExpansionPatchRuntime.collectFreeformLeafContexts(outline).map(({ item }) => item.id),
    [],
  );
  assert.equal(protectWriteForResponseMode(manual, 'full-regenerate').allowed, false);
  assert.equal(deriveResponseCompletion([manual], { taskStatus: 'success' }).response_complete, true);
  assert.doesNotThrow(() => resolveTechnicalPlanExportPayload({ source: 'technical-plan' }, fakeStore([manual])));
});

test('四级和五级叶子都进入正文生成目标，人工五级叶子继续排除', () => {
  const outline = [{
    id: '1', title: '技术方案', children: [{
      id: '1.1', title: '服务方案', children: [{
        id: '1.1.1', title: '实施组织', children: [
          { id: '1.1.1.1', title: '四级正文叶子' },
          { id: '1.1.1.2', title: '人员分工', children: [
            { id: '1.1.1.2.1', title: '五级正文叶子' },
            { id: '1.1.1.2.2', title: '人工五级叶子', manual_input_required: true },
          ] },
        ],
      }],
    }],
  }];

  assert.deepEqual(
    __developerContentExpansionPatchRuntime.collectFreeformLeafContexts(outline).map(({ item }) => item.id),
    ['1.1.1.1', '1.1.1.2.1'],
  );
});

test('同章三级、四级、重点五级共七个叶子按实际树选取', () => {
  const leaf = (id, title) => ({ id, title, description: title });
  const outline = [{ id: '1', title: '技术方案', children: [{ id: '1.1', title: '服务方案', focus_priority: 'service-plan', children: [
    leaf('1.1.1', '沟通响应时效'),
    { id: '1.1.2', title: '现场保护与清理', children: [leaf('1.1.2.1', '既有设施保护'), leaf('1.1.2.2', '清理清运与环境恢复')] },
    { id: '1.1.3', title: '应急处置', children: [leaf('1.1.3.1', '需求变更处置'), { id: '1.1.3.2', title: '现场突发处置', children: [
      leaf('1.1.3.2.1', '作业暂停与现场隔离'), leaf('1.1.3.2.2', '情况确认与方案调整'), leaf('1.1.3.2.3', '恢复作业前复核'),
    ] }] },
  ] }] }];
  const contexts = __developerContentExpansionPatchRuntime.collectFreeformLeafContexts(outline);
  assert.deepEqual(contexts.map(({ item }) => item.id), ['1.1.1', '1.1.2.1', '1.1.2.2', '1.1.3.1', '1.1.3.2.1', '1.1.3.2.2', '1.1.3.2.3']);
  assert.deepEqual(contexts[0].parentChapters.map((item) => item.title), ['技术方案', '服务方案']);
});
