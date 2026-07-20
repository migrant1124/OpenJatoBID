const assert = require('node:assert/strict');
const test = require('node:test');

const { FOCUS_WRITING_REVISION, runFocusWritingTask } = require('./focusWritingTask.cjs');

test('重点编写项识别只以技术评分要求为模型输入', async () => {
  let request;
  const matrix = await runFocusWritingTask({
    aiService: {
      async requestJson(options) {
        request = options;
        return {
          focus_items: [{
            id: 'F1',
            title: '实施组织与保障',
            requirement_text: '项目实施方案完整可行',
            score_text: '最高 10 分',
            high_score_conditions: ['组织机制完整且可执行'],
            suggested_section: '项目实施方案',
            writing_focus: '突出组织、流程、责任和验收闭环',
          }],
        };
      },
    },
    techRequirements: '## 技术评分项\n实施组织与保障：最高 10 分。',
  });

  assert.equal(request.messages.at(-1).content.includes('实施组织与保障：最高 10 分。'), true);
  assert.equal(request.messages.at(-1).content.includes('招标文件正文'), false);
  assert.equal(matrix.revision, FOCUS_WRITING_REVISION);
  assert.equal(matrix.scoring_points.length, 1);
  assert.equal(matrix.scoring_points[0].mandatory_level, 'high');
  assert.equal(matrix.scoring_points[0].suggested_section, '项目实施方案');
  assert.deepEqual(matrix.rejection_risks, []);
  assert.deepEqual(matrix.hidden_requirements, []);
  assert.deepEqual(matrix.value_anchors, []);
});
