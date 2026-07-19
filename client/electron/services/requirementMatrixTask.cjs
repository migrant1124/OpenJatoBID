const { runBidAnalysisPromptTask } = require('./bidAnalysisTask.cjs');
const { normalizeRequirementResponseMatrix } = require('./technicalPlanQualityModel.cjs');
const { splitUserTextByContextLimit } = require('../utils/userTextSplitter.cjs');

function buildRequirementMatrixPrompt(analysisContext = '') {
  return `任务：基于招标文件，建立投标文件质量响应矩阵。

目标：
1. 把每个可独立得分、扣分或需要明确响应的技术要求拆成原子评分点；不能把整段评分标准压缩成一个点。
2. 单独识别可能导致否决、重大偏离、格式/附件/签章/提交问题的风险，并给出处理路由。
3. 单独识别脚注、表注、交叉引用、附件、上传、命名等隐性要求；不要把行政要求硬塞进技术正文目录。
4. 所有来源引用只保留短摘录，严禁复制整段招标文件；招标文件没有的信息不得编造。

输出约束：
- 仅输出一个 JSON 对象，禁止输出 Markdown 或解释。
- 字段和值必须符合以下结构；无内容时使用空数组。
- scoring_point_id 使用 R1.P1、R1.P2 形式；每个评分点都写出评分规则、高分条件、期望响应类型和最合适的目录承载位置线索。
- source_refs 的 source_type 只能是 tender、appendix、footnote、original-plan、knowledge、user-input；quote 必须是短摘录。
- mandatory_level 只能是 normal、important、high、potential-rejection。
- expected_response_types 只能包含 content、table、illustration、evidence、commitment、manual。
- rejection_risks 的 handling_route 只能是 outline、fixed-form、evidence、export、submission、manual-review。
- hidden_requirements 的 handling_route 只能是 outline、content、fixed-form、evidence、export、submission、manual-review。

JSON 结构：
{
  "schema_version": 1,
  "revision": "matrix-v1",
  "scoring_points": [{
    "scoring_point_id": "R1.P1",
    "group_requirement_id": "R1",
    "title": "评分点名称",
    "requirement_text": "需响应的要求",
    "scoring_rule": "评分或扣分规则",
    "score_value": 0,
    "score_text": "分值说明",
    "source_refs": [{"source_type":"tender","quote":"短摘录","section":"章节位置"}],
    "mandatory_level": "important",
    "expected_response_types": ["content", "table"],
    "high_score_conditions": ["高分条件"],
    "mapped_node_ids": [],
    "status": "unmapped"
  }],
  "rejection_risks": [{
    "risk_id": "RR1",
    "source_refs": [{"source_type":"tender","quote":"短摘录"}],
    "trigger": "否决或重大风险触发条件",
    "category": "format",
    "risk_level": "potential-rejection",
    "handling_route": "submission",
    "mapped_node_ids": [],
    "mitigation": "处理措施",
    "status": "unhandled"
  }],
  "hidden_requirements": [{
    "hidden_requirement_id": "HR1",
    "source_kind": "footnote",
    "requirement_text": "隐性要求",
    "source_refs": [{"source_type":"footnote","quote":"短摘录"}],
    "handling_route": "manual-review",
    "mapped_node_ids": [],
    "status": "unhandled"
  }],
  "value_anchors": []
}

现有招标解析摘要（仅作辅助，仍以招标原文为准）：
${analysisContext || '暂无额外摘要'}`;
}

function buildAnalysisContext(plan = {}) {
  const entries = [
    ['项目概述', plan.projectOverview],
    ['技术评分要求', plan.techRequirements],
    ['无效标与废标项', plan.bidAnalysisTasks?.discardedBids?.content],
    ['格式要求', plan.bidAnalysisTasks?.responseFileRequirements?.content],
  ];
  return entries
    .map(([title, value]) => String(value || '').trim() ? `【${title}】\n${String(value).trim()}` : '')
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 24000);
}

async function runRequirementMatrixTask({ aiService, workspaceStore, updateTask, runPromptTask = runBidAnalysisPromptTask }) {
  const plan = workspaceStore.loadTechnicalPlan() || {};
  const tenderMarkdown = workspaceStore.readTenderMarkdown();
  if (!String(tenderMarkdown || '').trim()) {
    throw new Error('请先上传并解析招标文件，再建立评分响应矩阵');
  }

  const analysisContext = buildAnalysisContext(plan);
  const task = {
    id: 'requirementResponseMatrix',
    label: '评分响应矩阵',
    output: 'json',
    prompt: () => buildRequirementMatrixPrompt(analysisContext),
  };
  updateTask({ status: 'running', progress: 10, logs: ['正在原子化评分要求、否决风险和隐性要求'] }, workspaceStore.loadTechnicalPlan());

  const currentConfig = typeof aiService.getConfig === 'function' ? aiService.getConfig() : {};
  const matrix = await runPromptTask({
    aiService,
    fileContent: tenderMarkdown,
    fileSegments: splitUserTextByContextLimit(tenderMarkdown, currentConfig),
    task,
    jsonNormalizer: normalizeRequirementResponseMatrix,
  });
  const normalizedMatrix = normalizeRequirementResponseMatrix(JSON.parse(matrix));
  const nextState = workspaceStore.updateTechnicalPlan({ requirementResponseMatrix: normalizedMatrix });
  updateTask({
    status: 'success',
    progress: 100,
    error: undefined,
    logs: [`已建立评分响应矩阵：${normalizedMatrix.scoring_points.length} 个评分点、${normalizedMatrix.rejection_risks.length} 个风险、${normalizedMatrix.hidden_requirements.length} 个隐性要求`],
  }, nextState);
}

module.exports = {
  buildAnalysisContext,
  buildRequirementMatrixPrompt,
  runRequirementMatrixTask,
};
