const FIELD_LABELS = {
  project_name: '项目名称', project_number: '项目编号', project_type: '项目类型', project_budget: '项目预算',
  project_address: '项目地址', company_name: '公司名称', contact_person: '联系人', contact_phone: '联系电话',
  email: '联系邮箱', bid_submission_deadline: '投标截止时间', bid_opening_time: '开标时间',
  implementation_period: '实施周期／交付期限', delivery_scope: '交付范围', delivery_location: '交付地点',
  acceptance_requirements: '验收要求', warranty_period: '质保期', response_time: '响应时限',
  procurement_summary: '采购摘要', quotation_summary: '报价摘要', quotation_table: '报价表概况',
  quote_documents: '报价文件', scoring: '评分构成', method: '评标方法', principles: '评标原则',
};

function cell(value) {
  const text = String(value ?? '未提供');
  if (/^https?:\/\/\S+$/i.test(text)) return `[来源链接](${text.replace(/[()]/g, (part) => encodeURIComponent(part))})`;
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function flatten(value, prefix = '') {
  if (Array.isArray(value)) {
    if (!value.length) return [[prefix, '[]']];
    return value.flatMap((item, index) => flatten(item, `${prefix}[${index + 1}]`));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return [[prefix, '{}']];
    return entries.flatMap(([key, item]) => flatten(item, prefix ? `${prefix}／${FIELD_LABELS[key] || key}` : FIELD_LABELS[key] || key));
  }
  return [[prefix, value === null || value === undefined ? '未提供' : String(value)]];
}

function buildBidAnalysisReportMarkdown(state, projectName, at = new Date().toISOString()) {
  const selected = new Set(state.bidAnalysisSelectedTaskIds || []);
  const definitions = (state.bidAnalysisTaskDefinitions || []).filter((item) => selected.has(item.id));
  const saved = definitions.filter((item) => state.bidAnalysisTasks?.[item.id]?.status === 'success');
  if (!saved.length) throw new Error('没有已保存的招标解析结果');
  const sourceFiles = state.analysisSourceFiles || (state.analysisStale ? [] : state.tenderFiles || []);
  const lines = [
    '# 招标文件解析报告', '',
    `项目：${projectName || '未命名项目'}`, '',
    `导出时间：${at}`, '',
    `最近解析时间：${state.bidAnalysisTask?.updated_at || state.bidAnalysisTask?.started_at || '未记录'}`, '',
    `解析模式：${state.bidAnalysisMode === 'full' ? '完整解析' : '重点解析'}`, '',
    `解析状态：${saved.length === definitions.length ? '已完成' : `部分完成（${saved.length}/${definitions.length}）`}`, '',
    `资料状态：${state.analysisStale ? '来源已变化，原解析结果待重新核对' : '与当前已存来源一致'}`, '',
    `解析使用的来源修订：${state.analysisSourceHash || '未记录'}`, '',
    `投标范围：${state.analysisSourceSectionTitle || (state.bidSectionMode === 'single' ? '单标段' : '未选择或未记录')}`, '',
    '## 解析时来源文件', '',
    ...(sourceFiles.length ? ['| 文件名称 | 文件类型 | 导入时间 | 内容哈希 |', '| --- | --- | --- | --- |',
      ...sourceFiles.map((file) => `| ${cell(file.fileName)} | ${cell(file.fileName.split('.').pop()?.toUpperCase() || '文件')} | ${cell(file.importedAt)} | ${cell(file.sourceHash || file.contentHash)} |`)]
      : ['解析时来源清单未记录；不展示当前文件，以免与旧解析结果错误配对。']),
    '', `当前资料修订：${state.tenderFile?.originalContentHash || state.tenderFile?.contentHash || '未提供'}`, '',
  ];
  for (const definition of definitions) {
    const task = state.bidAnalysisTasks?.[definition.id];
    const status = task?.status === 'success' ? '已完成' : task?.status === 'error' ? '失败' : '未完成';
    lines.push(`## ${definition.label}`, '', `状态：${status}`, '');
    if (task?.error) lines.push(`错误：${task.error}`, '');
    const content = String(task?.content || '').trim();
    if (!content) { lines.push('无已保存内容。', ''); continue; }
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = undefined; }
    if (parsed && typeof parsed === 'object') {
      lines.push('| 字段 | 内容 |', '| --- | --- |', ...flatten(parsed).map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`), '');
    } else {
      lines.push(content, '');
    }
  }
  return lines.join('\n');
}

module.exports = { buildBidAnalysisReportMarkdown };
