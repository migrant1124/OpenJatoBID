'use strict';

const WRITING_POLICY_VERSION = 'writing-v1.7.3';

const CONTENT_WRITING_POLICY = `正文表达规则（${WRITING_POLICY_VERSION}）：
- 围绕本节职责和必须回答的问题组织内容，使评审人员能够理解方案及关键做法。
- 使用自然、正式、清楚的中文；句长由语义决定，可以正常表达条件、因果、顺序和目的，不按固定字数拆句，也不要求每句使用相同主语。
- 解释和论述优先形成完整自然段。真实步骤、并列检查项和对照信息可以使用列表或表格；需要突出方法时可以使用简短的无编号加粗引导语，但不套用固定结构。
- 实施方法说明关键动作、处理方式及必要的复核或交接，只展开本节适用的内容，不机械补齐人员、时限、参数、记录和验收全部要素。
- 项目背景和全局事实用于理解项目并约束准确性，不是逐节复述清单；其他章节负责的事项不重复完整展开，但招标要求独立响应的内容必须保留。`;

const FACT_AND_METHOD_POLICY = `方法与事实边界：
- 招标文件未详细规定的一般实施方法，可以在采购范围和已知条件下合理补充并直接融入正文，不使用“AI建议”或一般方法“待确认”标签。
- 不得虚构企业已有人员、设备、资质、业绩或其他事实；不得擅自增加具体数量、时限、质保、服务等级和免费服务范围等承诺；拟采用的方法不得写成已经完成或已经具备的事实。
- 已有招标要求、项目事实和明确指标必须准确保留。不适用的量化或证明要素允许为空，真正缺失的必填资料沿用原处理方式。
- 不改变固定承诺原文、受保护表格、人工编制内容及当前任务不允许修改的材料；资料冲突沿用原冲突处理。`;

const PLANNING_POLICY = `章节编排规则（${WRITING_POLICY_VERSION}）：
- section_role 表达本节需要解决的问题；must_answer_questions 表达必须让读者理解的回答；implementation_steps 只是方法素材和必要顺序，不要求最终正文按字段逐项列出。
- 项目背景只用于理解，全局事实只在正文涉及时约束准确性；不得把两者规划成每节必写的介绍。
- cross_section_boundaries.excludes、related_node_ids 和 forbidden_repetition 必须反映章节分工；不得因此省略招标要求的独立响应。
- 只规划本节适用且有依据的量化、交付、验收和证据要素；不适用的数组保持为空，不生成“阈值待确认”等伪信息。
- 一般实施方法可以直接规划，不新增软件用户审批或导出前审核。`;

const REVISION_POLICY = `局部正文修订规则：
- 只补当前缺口并与相邻原文自然衔接，保留既有实质信息，不靠复述项目背景凑篇幅。
- 写作要求只作用于新增或替换的正文值，不修改原文锚点、ID、JSON 结构和其他协议字段。
- 保留数字、单位、条件、表格、图片引用、承诺和受保护内容，不把局部修复扩大为全文润色。
- 原文含有〔PU:evidence_id〕稳定引用标记时原样保留，不删除、换绑或自行新增证据标识。`;

function compact(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function formatSectionWritingContext({ chapter, ancestors, siblings, exclusions, relatedExcerpts, maxChars = 5000 } = {}) {
  const lines = [
    `当前章节：${compact(chapter?.id)} ${compact(chapter?.title)}`.trim(),
    ...(compact(chapter?.role) ? [`当前职责：${compact(chapter.role)}`] : []),
  ];
  const ancestorLines = (ancestors || []).map((item) => `- ${compact(item.id)} ${compact(item.title)}：${compact(item.description)}`).filter((line) => line.trim());
  if (ancestorLines.length) lines.push('上级共通背景与边界（仅取本节相关部分，不复述兄弟职责）：', ...ancestorLines);
  const siblingLines = (siblings || [])
    .filter((item) => compact(item?.id) && compact(item?.id) !== compact(chapter?.id))
    .map((item) => `- ${compact(item.id)} ${compact(item.title)}：${compact(item.role) || '按标题承担对应职责'}`);
  if (siblingLines.length) lines.push('同级章节职责（用于分工，不要求在正文中逐项引用）：', ...siblingLines);
  const excluded = (exclusions || []).map(compact).filter(Boolean);
  if (excluded.length) lines.push(`本节避免完整展开：${[...new Set(excluded)].join('；')}`);

  const excerptLines = [];
  const excerptNodeIds = [];
  for (const item of relatedExcerpts || []) {
    const content = compact(item?.content);
    if (!content) continue;
    const excerpt = content.slice(-500);
    const candidate = `- ${compact(item.id)} ${compact(item.title)}：${excerpt}`;
    if ([...lines, '已落盘相关正文摘录（仅用于避免复述和自然衔接，不代表本节必须引用）：', ...excerptLines, candidate].join('\n').length > maxChars) break;
    excerptLines.push(candidate);
    excerptNodeIds.push(compact(item.id));
  }
  if (excerptLines.length) lines.push('已落盘相关正文摘录（仅用于避免复述和自然衔接，不代表本节必须引用）：', ...excerptLines);
  return { text: lines.join('\n').slice(0, maxChars), excerpt_node_ids: excerptNodeIds };
}

module.exports = {
  CONTENT_WRITING_POLICY,
  FACT_AND_METHOD_POLICY,
  PLANNING_POLICY,
  REVISION_POLICY,
  WRITING_POLICY_VERSION,
  formatSectionWritingContext,
};
