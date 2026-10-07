const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const { inspectPptx, replaceNativeText, replaceNativeChartData } = require('../electron/services/pptTemplateService.cjs');
const baseline = path.resolve(process.env.JATOBID_PPT_TEST_FIXTURES || path.join(__dirname, '../.tmp/ci-ppt-fixtures'));
test('美化原文只读取页内叶子文字，嵌套组不重复累计，母版不混入', () => {
  const zip = new AdmZip(path.join(baseline, 'wuhua-original.pptx'));
  const member = 'ppt/slides/slide1.xml', source = zip.readAsText(member), doc = require('cheerio').load(source, { xml: true });
  const expected = doc('a\\:t').toArray().map((node) => doc(node).text()).join('\n');
  const first = doc('p\\:sp').filter((_, node) => doc(node).find('a\\:t').length).first(); first.replaceWith(`<p:grpSp><p:grpSp>${doc.xml(first)}</p:grpSp></p:grpSp>`);
  zip.updateFile(member, Buffer.from(doc.xml()));
  assert.equal(inspectPptx(zip.toBuffer()).pages[0].sourceText, expected);
});
test('真实两个源样本逐页检查；wuhua 改中文保留非目标包成员', (t) => {
  const source = path.join(baseline, 'wuhua-original.pptx'), free = path.join(baseline, 'free-original.pptx');
  assert.ok(fs.existsSync(source) && fs.existsSync(free), '需要已经取得的固定真实样本，不能用空夹具替代');
  const a = inspectPptx(source), b = inspectPptx(free);
  assert.equal(a.routeCandidate, 'edit-native'); assert.equal(a.aspectRatio, '4:3');
  assert.equal(b.pageCount, 4); assert.ok(b.pages.every((page) => page.fullPagePicture && !page.nativeText)); assert.equal(b.routeCandidate, 'visual-reference');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-ppt-native-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, '中文替换.pptx'), element = a.pages[0].elements.find((item) => item.type === 'p:sp' && item.text);
  const next = replaceNativeText({ source, target, sourceHash: a.hash, changes: [{ page: 0, elementId: element.elementId, expectedText: element.text, text: '新项目的合成中文标题' }] });
  assert.ok(next.pages[0].elements.some((item) => item.text === '新项目的合成中文标题'));
  const old = new AdmZip(source), result = new AdmZip(target);
  for (const entry of old.getEntries()) if (entry.entryName !== a.pages[0].member) assert.deepEqual(result.getEntry(entry.entryName).getData(), entry.getData(), entry.entryName);
});
test('整页截图加页码不能认定为原生可复用', () => {
  const zip = new AdmZip(path.join(baseline, 'free-original.pptx'));
  const source = zip.readAsText('ppt/slides/slide1.xml');
  zip.updateFile('ppt/slides/slide1.xml', Buffer.from(source.replace('</p:spTree>', '<p:sp><p:nvSpPr><p:cNvPr id="42" name="页码"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>')));
  assert.equal(inspectPptx(zip.toBuffer()).routeCandidate, 'visual-reference');
});
test('普通原生图表 XML 缓存与真实 XLSX 同时替换，其他成员保持', (t) => {
  // 合成 OOXML 数据层夹具；这项不等于真实 Office 图表排版验收。
  const zip = new AdmZip(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-chart-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const add = (name, value) => zip.addFile(name, Buffer.from(value));
  add('ppt/presentation.xml', '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>');
  add('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>');
  add('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c" xmlns:r="r"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="数据图表"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="chart"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>');
  add('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="chart" Target="../charts/chart1.xml"/></Relationships>');
  add('ppt/charts/chart1.xml', '<c:chartSpace xmlns:c="c" xmlns:r="r"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!B1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>旧系列</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat/><c:val><c:numRef><c:f>Sheet1!B2</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart><c:externalData r:id="book"/></c:chartSpace>');
  add('ppt/charts/_rels/chart1.xml.rels', '<Relationships><Relationship Id="book" Target="../embeddings/data.xlsx"/></Relationships>');
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['类别','旧系列'],['旧事实',999]]), 'Sheet1');
  zip.addFile('ppt/embeddings/data.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  const source = path.join(root, 'source.pptx'), target = path.join(root, 'target.pptx'); zip.writeZip(source);
  const result = replaceNativeChartData({ source, target, sourceHash: inspectPptx(source).hash, page: 0, elementId: '2', categories: ['真实类别甲','真实类别乙'], series: [{ name: '合成新系列', values: [12,34] }] });
  const {auditContentFacts}=require('../electron/services/pptTemplateService.cjs');assert.equal(auditContentFacts(target,target).charts,1);
  const wrong=new AdmZip(target),altered=path.join(root,'只改数值.pptx');wrong.updateFile('ppt/charts/chart1.xml',Buffer.from(wrong.readAsText('ppt/charts/chart1.xml').replace('<c:v>12</c:v>','<c:v>120</c:v>')));wrong.writeZip(altered);assert.throws(()=>auditContentFacts(target,altered),/图表数值/);
  const output = new AdmZip(target), chart = output.readAsText('ppt/charts/chart1.xml');
  const parsed = require('cheerio').load(chart, { xml: true }), values = parsed('c\\:v').toArray().map((node) => parsed(node).text());
  assert.deepEqual(values, ['合成新系列', '真实类别甲', '真实类别乙', '12', '34']); assert.ok(!chart.includes('999'));
  const data = XLSX.read(output.getEntry('ppt/embeddings/data.xlsx').getData(), { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(data.Sheets.Sheet1, { header: 1 }), [['类别','合成新系列'],['真实类别甲',12],['真实类别乙',34]]);
  for (const entry of zip.getEntries()) if (!result.modifiedMembers.includes(entry.entryName)) assert.deepEqual(output.getEntry(entry.entryName).getData(), entry.getData());
  // 多页引用同一 chartPart 会影响未选页，即使未选 slide XML 字节不变。
  zip.updateFile('ppt/presentation.xml', Buffer.from(zip.readAsText('ppt/presentation.xml').replace('</p:sldIdLst>', '<p:sldId id="257" r:id="r2"/></p:sldIdLst>')));
  zip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(zip.readAsText('ppt/_rels/presentation.xml.rels').replace('</Relationships>', '<Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>')));
  zip.addFile('ppt/slides/slide2.xml', zip.getEntry('ppt/slides/slide1.xml').getData());
  zip.addFile('ppt/slides/_rels/slide2.xml.rels', zip.getEntry('ppt/slides/_rels/slide1.xml.rels').getData());
  const shared = path.join(root, 'shared.pptx'), forbidden = path.join(root, '共享误改.pptx'); zip.writeZip(shared);
  assert.throws(() => replaceNativeChartData({ source: shared, target: forbidden, sourceHash: inspectPptx(shared).hash, page: 0, elementId: '2', categories: ['甲'], series: [{ name: '乙', values: [1] }] }), /多个页面或对象共享/);
  assert(!fs.existsSync(forbidden));
});
