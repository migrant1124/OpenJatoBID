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

test('manual subtree leaves skip AI generation and do not block export', () => {
  const manual = {
    id: '1.1', title: '人工编制章节', description: '请人工填写合同与证明材料。',
    manual_input_required: true, content: '',
  };
  const normal = { id: '1.2', title: '实施方案', description: '生成实施措施', allow_ai_children: true };
  const outline = [{ id: '1', title: '技术文件', description: '目录', manual_input_required: true, children: [manual, normal] }];

  assert.deepEqual(
    __developerContentExpansionPatchRuntime.collectFreeformLeafContexts(outline).map(({ item }) => item.id),
    ['1.2'],
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
