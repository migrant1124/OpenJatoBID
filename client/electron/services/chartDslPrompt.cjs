const { CHART_TYPES } = require('./chartDslSchema.cjs');

function buildChartDslPrompt({ title, chartType, reference }) {
  return `你是佳图投标技术方案结构化图表生成助手。仅返回 JSON，不要 Markdown、HTML、JavaScript、CSS 或 URL。\n图表类型必须为 ${chartType || '以下之一'}：${CHART_TYPES.join(', ')}。\n标题：${title}\n使用 schema_version=1、theme=jato-business、layout.width=1240，并仅输出与该图表类型匹配的数据字段。所有文本为纯文本；不得编造正文不存在的事实。\n参考正文：\n${reference}`;
}

module.exports = { buildChartDslPrompt };
