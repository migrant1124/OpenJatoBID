const { normalizeRequirementResponseMatrix } = require('./technicalPlanQualityModel.cjs');

const FOCUS_WRITING_REVISION = 'focus-writing-v2';

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} 必须是非空字符串`);
  return normalized;
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function shortText(value, limit = 240) {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function normalizeFocusWritingResponse(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!source) throw new Error('重点编写项识别结果必须是对象');
  const seen = new Set();
  const focusItems = (Array.isArray(source.focus_items) ? source.focus_items : []).map((item, index) => {
    const id = requiredString(item?.id || `F${index + 1}`, `focus_items[${index}].id`);
    if (seen.has(id)) throw new Error(`focus_items 存在重复 ID：${id}`);
    seen.add(id);
    const highScoreConditions = uniqueStrings(item?.high_score_conditions || [], `focus_items[${index}].high_score_conditions`);
    if (!highScoreConditions.length) throw new Error(`focus_items[${index}] 缺少高分条件`);
    const scoreValue = item?.score_value;
    if (scoreValue !== undefined && scoreValue !== null && scoreValue !== '') {
      if (!Number.isFinite(Number(scoreValue)) || Number(scoreValue) < 0) {
        throw new Error(`focus_items[${index}].score_value 必须是非负数字或空值`);
      }
    }
    return {
      id,
      title: requiredString(item?.title, `focus_items[${index}].title`),
      requirement_text: requiredString(item?.requirement_text, `focus_items[${index}].requirement_text`),
      score_text: String(item?.score_text || '').trim(),
      ...(scoreValue !== undefined && scoreValue !== null && scoreValue !== '' ? { score_value: Number(scoreValue) } : {}),
      high_score_conditions: highScoreConditions,
      suggested_section: requiredString(item?.suggested_section, `focus_items[${index}].suggested_section`),
      writing_focus: requiredString(item?.writing_focus, `focus_items[${index}].writing_focus`),
    };
  });
  return { focus_items: focusItems };
}

function buildFocusWritingPrompt(techRequirements) {
  return `任务：根据已完成的“技术评分要求”解析结果，识别投标文件中需要重点编写的高分小节。

边界：
1. 只能使用下方“技术评分要求”文本；不得读取、假设或补充完整招标文件中的内容。
2. 输出全部可从文本中识别的技术评分项，以便程序比较分值；没有明确评分项时返回空数组。
3. suggested_section 是投标技术文件中适合承载该重点内容的小节名称建议，不得新增招标文件没有的承诺、案例、人员或资质。
4. 每项必须说明高分条件和重点写作方向。只有原文能明确解析出该评分项的数值分值时才填写 score_value；不能明确解析时必须为 null，不得从“高分”“满分”等描述猜测数值。
5. 只返回 JSON，不要输出 Markdown、解释或额外文字。

返回格式：
{
  "focus_items": [
    {
      "id": "F1",
      "title": "重点评分项名称",
      "requirement_text": "需响应的评分要求",
      "score_text": "最高 10 分",
      "score_value": 10,
      "high_score_conditions": ["满足满分条件的具体要求"],
      "suggested_section": "建议重点编写的小节名称",
      "writing_focus": "该小节应重点展开的内容"
    }
  ]
}

技术评分要求：
${String(techRequirements || '').trim()}`;
}

function createFocusWritingMatrix(response) {
  const focus = normalizeFocusWritingResponse(response);
  return normalizeRequirementResponseMatrix({
    schema_version: 1,
    revision: FOCUS_WRITING_REVISION,
    scoring_points: focus.focus_items.map((item) => ({
      scoring_point_id: item.id,
      group_requirement_id: item.id,
      title: item.title,
      requirement_text: item.requirement_text,
      scoring_rule: item.writing_focus,
      score_text: item.score_text || undefined,
      score_value: item.score_value,
      source_refs: [{ source_type: 'tender', section: '技术评分要求', quote: shortText(item.requirement_text) }],
      mandatory_level: 'high',
      expected_response_types: ['content'],
      high_score_conditions: item.high_score_conditions,
      suggested_section: item.suggested_section,
      writing_focus: item.writing_focus,
      mapped_node_ids: [],
      status: 'unmapped',
    })),
    rejection_risks: [],
    hidden_requirements: [],
    value_anchors: [],
  });
}

function createEmptyFocusWritingMatrix() {
  return createFocusWritingMatrix({ focus_items: [] });
}

async function runFocusWritingTask({ aiService, techRequirements }) {
  if (!String(techRequirements || '').trim()) {
    throw new Error('技术评分要求为空，无法识别重点编写项');
  }
  if (typeof aiService?.requestJson !== 'function') {
    throw new Error('AI 服务尚未初始化');
  }
  const response = await aiService.requestJson({
    messages: [
      { role: 'system', content: '你是投标技术文件重点编写项识别助手。严格依据输入的技术评分要求返回 JSON。' },
      { role: 'user', content: buildFocusWritingPrompt(techRequirements) },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    normalizer: normalizeFocusWritingResponse,
    progressLabel: '重点编写项识别',
    failureMessage: '重点编写项识别结果格式无效',
    logTitle: '重点编写项识别',
  });
  return createFocusWritingMatrix(response);
}

module.exports = {
  FOCUS_WRITING_REVISION,
  buildFocusWritingPrompt,
  createEmptyFocusWritingMatrix,
  createFocusWritingMatrix,
  normalizeFocusWritingResponse,
  runFocusWritingTask,
};
