const fs = require('node:fs');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { load } = require('cheerio');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const xml = (text) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('模板包含不允许的 XML 实体');
  return load(text, { xml: true });
};

function inspectPptx(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  if (buffer.length > 256 * 1024 ** 2 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('PPTX 文件大小或签名无效');
  const archive = new AdmZip(buffer), entries = archive.getEntries();
  const names = new Set(); let expanded = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    expanded += entry.header.size;
    if (names.has(name.toLowerCase()) || /(^\/|^[A-Za-z]:|\\|(^|\/)\.\.(\/|$))/.test(name)
      || (entry.attr >>> 16 & 0xf000) === 0xa000 || expanded > 512 * 1024 ** 2 || entries.length > 20000
      || entry.header.size > 128 * 1024 ** 2) throw new Error('PPTX 解包范围或路径异常');
    names.add(name.toLowerCase());
    if (/vbaProject|activeX|\.exe$|\.dll$/i.test(name) || /\.bin$/i.test(name) && !/^ppt\/printerSettings\/printerSettings\d+\.bin$/.test(name)) throw new Error('模板包含宏或可执行嵌入物');
    if (/\.(xml|rels)$/i.test(name)) {
      const content = entry.getData().toString('utf8'); xml(content);
      if (/TargetMode\s*=\s*["']External["']/i.test(content)) throw new Error('模板包含外部关系，请先移除外链');
    }
    if (/^ppt\/embeddings\//i.test(name)) {
      if (!/\.xlsx$/i.test(name)) throw new Error('暂不支持 OLE 或非表格嵌入物');
      const nested = new AdmZip(entry.getData());
      if (!nested.getEntry('xl/workbook.xml') || nested.getEntries().some((e) => /vbaProject|\.bin$|externalLinks/i.test(e.entryName))) throw new Error('嵌入工作簿不安全或无效');
    }
  }
  const presentation = xml(archive.readAsText('ppt/presentation.xml'));
  const relationships = xml(archive.readAsText('ppt/_rels/presentation.xml.rels'));
  const targets = new Map(relationships('Relationship').toArray().map((node) => [relationships(node).attr('Id'), relationships(node).attr('Target')]));
  const width = Number(presentation('p\\:sldSz').attr('cx')), height = Number(presentation('p\\:sldSz').attr('cy'));
  if (!(width > 0 && height > 0)) throw new Error('模板没有有效画幅');
  const pages = presentation('p\\:sldId').toArray().map((node, position) => {
    const target = targets.get(presentation(node).attr('r:id'));
    const member = require('node:path').posix.normalize(`ppt/${target}`);
    if (!member.startsWith('ppt/slides/') || !archive.getEntry(member)) throw new Error('模板页面关系缺失');
    const doc = xml(archive.readAsText(member));
    const elements = doc('p\\:sp,p\\:pic,p\\:graphicFrame,p\\:grpSp,p\\:cxnSp').toArray().map((shape) => {
      const item = doc(shape), identity = item.find('p\\:cNvPr').first();
      return { elementId: identity.attr('id'), name: identity.attr('name'), type: shape.name, chart: item.find('c\\:chart').length > 0,
        text: item.find('a\\:t').toArray().map((run) => doc(run).text()).join(''), grouped: item.parents('p\\:grpSp').length > 0,
        offset: item.find('a\\:off').first().attr(), extent: item.find('a\\:ext').first().attr(),
        paragraphs: item.find('a\\:p').length };
    });
    const meaningfulText = elements.filter((item) => item.type === 'p:sp' && item.text.trim() && !/^(?:第?\s*\d+\s*页?|\d+\s*\/\s*\d+)$/.test(item.text.trim()));
    const fullPagePicture = elements.some((item) => item.type === 'p:pic' && Number(item.extent?.cx) >= width * .9 && Number(item.extent?.cy) >= height * .9);
    return { position, member, hash: hash(archive.getEntry(member).getData()), hidden: doc('p\\:sld').attr('show') === '0', elements,
      sourceText: doc('a\\:t').toArray().map((run) => doc(run).text()).join('\n'),
      fullPagePicture, routeCandidate: meaningfulText.length && !(fullPagePicture && meaningfulText.map((item) => item.text).join('').length < 20) ? 'edit-native' : 'visual-reference',
      nativeText: elements.filter((item) => item.type === 'p:sp' && item.text.trim()).length,
      pictures: elements.filter((item) => item.type === 'p:pic').length,
      charts: doc('c\\:chart').length, tables: doc('a\\:tbl').length,
      warnings: [...(doc('a\\:graphicData[uri*="diagram"]').length ? ['SmartArt 仅保留，编辑需专项检查'] : []),
        ...(doc('p\\:timing').length ? ['存在动画，修改后需核对联动'] : [])] };
  });
  if (!pages.length) throw new Error('模板没有页面');
  const dependencies = entries.filter((entry) => /^ppt\/(slideMasters|slideLayouts|theme|notesSlides|charts|embeddings|media)\//.test(entry.entryName)).map((entry) => ({ member: entry.entryName, hash: hash(entry.getData()), bytes: entry.header.size }));
  return { hash: hash(buffer), bytes: buffer.length, width, height, pageCount: pages.length, aspectRatio: Math.abs(width / height - 4 / 3) < .02 ? '4:3' : Math.abs(width / height - 16 / 9) < .02 ? '16:9' : `${width}:${height}`,
    kind: pages.length === 1 ? 'layout' : 'deck', pages, dependencies,
    capability: 'unverified', routeCandidate: pages.every((page) => page.routeCandidate === 'edit-native') ? 'edit-native' : 'visual-reference',
    warnings: ['结构检测不等于 AI 套用、中文排版或 Office/WPS 验收通过'] };
}

// 精确替换指定原生文本框；保留未选页面及所有非目标 ZIP 成员的内容。
function replaceNativeText({ source, target, sourceHash, changes }) {
  const report = inspectPptx(source);
  if (report.hash !== sourceHash) throw new Error('模板版本已变化');
  const archive = new AdmZip(source), modified = new Map();
  for (const change of changes) {
    const page = report.pages.find((item) => item.position === change.page);
    if (!page) throw new Error('目标页面不存在');
    const doc = modified.get(page.member) || xml(archive.readAsText(page.member));
    const shape = doc('p\\:sp').toArray().find((node) => doc(node).find('p\\:cNvPr').first().attr('id') === String(change.elementId));
    if (!shape || !doc(shape).find('a\\:t').length) throw new Error('该对象不是可替换的原生文字');
    const runs = doc(shape).find('a\\:t');
    if (change.expectedText !== undefined && runs.toArray().map((run) => doc(run).text()).join('') !== change.expectedText) throw new Error('对象内容已变化');
    runs.first().text(String(change.text)); runs.slice(1).text(''); modified.set(page.member, doc);
  }
  if (!modified.size) throw new Error('未指定实际修改');
  for (const [member, doc] of modified) archive.updateFile(member, Buffer.from(doc.xml(), 'utf8'));
  archive.writeZip(target); const output = inspectPptx(target);
  return { ...output, capability: 'unverified', testedOperations: ['native_text_replaced'], modifiedPages: [...modified.keys()] };
}
// 只更新选定普通原生图表及其独占的单表工作簿；复杂/共享工作簿须单独适配。
function replaceNativeChartData({ source, target, sourceHash, page: position, elementId, categories, series }) {
  const report = inspectPptx(source), posix = require('node:path').posix;
  if (report.hash !== sourceHash) throw new Error('模板版本已变化');
  if (!categories?.length || !series?.length || series.some((item) => item.values.length !== categories.length || item.values.some((value) => !Number.isFinite(value)))) throw new Error('图表需要真实类别与对应数值');
  const page = report.pages.find((item) => item.position === position);
  if (!page) throw new Error('目标页面不存在');
  const zip = new AdmZip(source), slide = xml(zip.readAsText(page.member));
  const frame = slide('p\\:graphicFrame').toArray().find((node) => slide(node).find('p\\:cNvPr').attr('id') === String(elementId));
  const relation = frame && slide(frame).find('c\\:chart').attr('r:id');
  if (!relation) throw new Error('目标不是已支持的普通原生图表');
  const relationshipFile = (member) => posix.join(posix.dirname(member), '_rels', `${posix.basename(member)}.rels`);
  const resolveRelationship = (member, id) => {
    const rels = xml(zip.readAsText(relationshipFile(member))), rel = rels('Relationship').toArray().find((node) => rels(node).attr('Id') === id);
    if (!rel) throw new Error('图表依赖关系缺失');
    return posix.normalize(posix.join(posix.dirname(member), rels(rel).attr('Target')));
  };
  const chartPart = resolveRelationship(page.member, relation), chart = xml(zip.readAsText(chartPart));
  let chartReferences = 0;
  for (const entry of zip.getEntries().filter((item) => /^ppt\/slides\/[^/]+\.xml$/.test(item.entryName))) {
    const document = xml(entry.getData().toString('utf8'));
    for (const node of document('c\\:chart').toArray()) if (resolveRelationship(entry.entryName, document(node).attr('r:id')) === chartPart) chartReferences += 1;
  }
  if (chartReferences !== 1) throw new Error('该图表被多个页面或对象共享，需要独立图表后再修改');
  const workbookPart = resolveRelationship(chartPart, chart('c\\:externalData').attr('r:id'));
  if (!/^ppt\/embeddings\/.+\.xlsx$/.test(workbookPart)) throw new Error('该图表缺少已支持的嵌入工作簿');
  for (const entry of zip.getEntries().filter((item) => /^ppt\/charts\/_rels\/.+\.rels$/.test(item.entryName) && item.entryName !== relationshipFile(chartPart))) {
    const rels = xml(entry.getData().toString('utf8'));
    if (rels('Relationship').toArray().some((node) => posix.normalize(posix.join('ppt/charts', rels(node).attr('Target'))) === workbookPart)) throw new Error('该图表共享工作簿，需要明确联合修改范围');
  }
  const rows = chart('c\\:ser').toArray();
  if (rows.length !== series.length || rows.some((node) => !chart(node).find('c\\:numRef').length)) throw new Error('系列数量或图表类型超出当前映射范围');
  const XLSX = require('xlsx'), oldWorkbook = XLSX.read(zip.getEntry(workbookPart).getData(), { type: 'buffer' });
  if (oldWorkbook.SheetNames.length !== 1) throw new Error('多工作表图表需要单独确认数据映射');
  const sheet = oldWorkbook.SheetNames[0], quoted = `'${sheet.replace(/'/g, "''")}'`;
  const setReference = (parent, tag, values, formula, numeric) => {
    const cache = numeric ? 'numCache' : 'strCache';
    chart(parent).empty().append(`<c:${tag}><c:f></c:f><c:${cache}>${numeric ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${values.length}"/>${values.map((_value, index) => `<c:pt idx="${index}"><c:v/></c:pt>`).join('')}</c:${cache}></c:${tag}>`);
    chart(parent).find('c\\:f').text(formula);
    chart(parent).find('c\\:v').each((index, node) => chart(node).text(String(values[index])));
  };
  rows.forEach((node, index) => {
    const column = XLSX.utils.encode_col(index + 1), row = chart(node);
    setReference(row.find('c\\:tx').first(), 'strRef', [series[index].name], `${quoted}!$${column}$1`, false);
    setReference(row.find('c\\:cat').first(), 'strRef', categories, `${quoted}!$A$2:$A$${categories.length + 1}`, false);
    setReference(row.find('c\\:val').first(), 'numRef', series[index].values, `${quoted}!$${column}$2:$${column}$${categories.length + 1}`, true);
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['类别', ...series.map((item) => item.name)], ...categories.map((name, index) => [name, ...series.map((item) => item.values[index])])]), sheet);
  zip.updateFile(chartPart, Buffer.from(chart.xml(), 'utf8')); zip.updateFile(workbookPart, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  zip.writeZip(target);
  return { ...inspectPptx(target), modifiedMembers: [chartPart, workbookPart], testedOperations: ['native_chart_and_workbook_updated'], capability: 'unverified' };
}
function contentFacts(file) {
  const report=inspectPptx(file),zip=new AdmZip(file),posix=require('node:path').posix;
  return report.pages.map(page=>{
    const slide=xml(zip.readAsText(page.member)),relsName=posix.join(posix.dirname(page.member),'_rels',`${posix.basename(page.member)}.rels`),rels=xml(zip.readAsText(relsName)||'<Relationships/>');
    const part=id=>{const node=rels('Relationship').toArray().find(node=>rels(node).attr('Id')===id),target=node && rels(node).attr('Target');if(!target)throw new Error('原始对象数据关系缺失，无法核验');return posix.normalize(posix.join(posix.dirname(page.member),target));};
    const charts=slide('c\\:chart').toArray().map(node=>{
      const chart=xml(zip.readAsText(part(slide(node).attr('r:id'))));
      const points=selection=>selection.find('c\\:pt').toArray().sort((a,b)=>Number(chart(a).attr('idx'))-Number(chart(b).attr('idx'))).map(node=>chart(node).find('c\\:v').text());
      return chart('c\\:ser').toArray().map(node=>{const row=chart(node),categories=points(row.find('c\\:cat,c\\:xVal')),values=points(row.find('c\\:val,c\\:yVal'));
        if(!categories.length || !values.length || values.some(value=>!value.trim() || !Number.isFinite(Number(value)))) throw new Error('原始图表缺少可核对的类别或数值，不能将视觉相似冒充数据保真');
        return {name:row.find('c\\:tx c\\:v').first().text(),categories,values:values.map(Number),bubble:points(row.find('c\\:bubbleSize')).map(Number)};});
    });
    const tables=slide('a\\:tbl').toArray().map(node=>slide(node).find('a\\:tr').toArray().map(row=>slide(row).children('a\\:tc').toArray().map(cell=>({text:slide(cell).find('a\\:t').toArray().map(run=>slide(run).text()).join(''),gridSpan:slide(cell).attr('gridSpan')||'1',rowSpan:slide(cell).attr('rowSpan')||'1'}))));
    const diagrams=slide('dgm\\:relIds').toArray().map(node=>{const data=xml(zip.readAsText(part(slide(node).attr('r:dm')))),points=data('dgm\\:pt').toArray(),ids=points.map(point=>data(point).attr('modelId'));
      return {nodes:points.map(point=>({type:data(point).attr('type'),text:data(point).find('a\\:t').toArray().map(run=>data(run).text()).join('')})),connections:data('dgm\\:cxn').toArray().map(edge=>({type:data(edge).attr('type'),source:ids.indexOf(data(edge).attr('srcId')),target:ids.indexOf(data(edge).attr('destId'))}))};});
    return {charts,tables,diagrams};
  });
}
function auditContentFacts(source,target) {
  const before=contentFacts(source),after=contentFacts(target);
  if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('美化改变了原始图表数值、表格单元格或图形关系，候选未应用');
  return {pages:before.length,charts:before.reduce((sum,page)=>sum+page.charts.length,0),tables:before.reduce((sum,page)=>sum+page.tables.length,0),diagrams:before.reduce((sum,page)=>sum+page.diagrams.length,0)};
}
module.exports = { inspectPptx, replaceNativeText, replaceNativeChartData, hash, contentFacts, auditContentFacts };
