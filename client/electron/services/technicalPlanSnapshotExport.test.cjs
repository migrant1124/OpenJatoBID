const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { buildBidAnalysisReportMarkdown } = require('./bidAnalysisReport.cjs');
const { buildOutlineSnapshotDocx, buildStandaloneMarkdownDocxResult } = require('./exportService.cjs');

test('解析报告按已选项目顺序保留结构化值、来源和过期状态', () => {
  const state = {
    bidAnalysisSelectedTaskIds: ['b', 'a'],
    bidAnalysisTaskDefinitions: [{ id: 'a', label: '项目概况' }, { id: 'b', label: '评分信息' }],
    bidAnalysisTasks: { a: { status: 'success', content: '{"project_name":"项目A","zero":0,"flag":false,"empty":[]}' }, b: { status: 'error', error: '模型失败' } },
    tenderFiles: [{ fileName: '新资料.txt', sourceHash: 'new-hash', importedAt: '2026-09-25T00:00:00Z' }],
    analysisSourceFiles: [{ fileName: '旧资料.txt', sourceHash: 'old-hash', importedAt: '2026-09-24T00:00:00Z' }],
    tenderFile: { originalContentHash: 'new-hash' }, analysisSourceHash: 'old-hash', analysisStale: true,
    bidAnalysisMode: 'full', bidAnalysisTask: { updated_at: '2026-09-24T12:00:00Z' }, analysisSourceSectionTitle: '旧标包',
  };
  const report = buildBidAnalysisReportMarkdown(state, '项目A', '2026-09-25T01:00:00Z');
  assert.ok(report.indexOf('## 项目概况') < report.indexOf('## 评分信息'));
  assert.match(report, /部分完成（1\/2）/);
  assert.match(report, /来源已变化/);
  assert.match(report, /完整解析/);
  assert.match(report, /2026-09-24T12:00:00Z/);
  assert.match(report, /旧标包/);
  assert.match(report, /旧资料.txt/);
  assert.doesNotMatch(report, /新资料.txt/);
  assert.match(report, /\| 项目名称 \| 项目A \|/);
  assert.match(report, /\| zero \| 0 \|/);
  assert.match(report, /\| flag \| false \|/);
  assert.match(report, /\| empty \| \[\] \|/);
  assert.match(report, /模型失败/);
});

test('解析报告的 Markdown 表格在 DOCX 中保持可编辑单元格', async () => {
  const markdown = buildBidAnalysisReportMarkdown({
    bidAnalysisSelectedTaskIds: ['a'], bidAnalysisTaskDefinitions: [{ id: 'a', label: '项目概况' }],
    bidAnalysisTasks: { a: { status: 'success', content: '{"project_name":"项目A","project_budget":0,"source_url":"https://example.org/source"}' } },
    tenderFiles: [{ fileName: 'a.txt', sourceHash: 'hash' }], tenderFile: { originalContentHash: 'hash' },
  }, '项目A');
  const buffer = (await buildStandaloneMarkdownDocxResult({ markdown })).buffer;
  const zip = new AdmZip(buffer);
  const xml = zip.getEntry('word/document.xml').getData().toString('utf8');
  const relationships = zip.getEntry('word/_rels/document.xml.rels').getData().toString('utf8');
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /项目预算/);
  assert.match(xml, />0</);
  assert.match(relationships, /https:\/\/example\.org\/source/);
});

test('纯大纲 DOCX 包含全部层级和可选说明，不含正文及假页码', async () => {
  const state = { outlineData: { outline: [{ id: '1', title: '第一章', description: '说明A', content: '不应导出的正文', children: [{ id: '1.1', title: '第二节', children: [] }] }] } };
  const buffer = await buildOutlineSnapshotDocx(state, '合成项目', true);
  const xml = new AdmZip(buffer).getEntry('word/document.xml').getData().toString('utf8');
  assert.match(xml, /第一章/);
  assert.match(xml, /第二节/);
  assert.match(xml, /说明A/);
  assert.match(xml, /Heading1/);
  assert.match(xml, /Heading2/);
  assert.doesNotMatch(xml, /不应导出的正文|PAGE/);
});
