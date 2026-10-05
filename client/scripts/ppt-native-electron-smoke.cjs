// 两个真实原包、真实 Electron/SQLite、固定上游工具和 AppContainer；无模型调用。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { inspectPptx, hash } = require('../electron/services/pptTemplateService.cjs');
const evidenceRoot = path.resolve(__dirname, '../.tmp/ppt184-resource-center/native-business');
fs.mkdirSync(evidenceRoot, { recursive: true });
const root = fs.mkdtempSync(path.join(evidenceRoot, '真实业务-'));
app.setPath('userData', path.join(root, '隔离数据')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const results = [], deadline = setTimeout(() => app.exit(1), 600000);
let service, sqlite, format = 'pptx';
async function check(name, callback) { try { await callback(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); throw error; } finally { fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(results, null, 2), 'utf8'); } }
async function main() {
  await app.whenReady();
  sqlite = require('../electron/services/sqliteDatabase.cjs').createSqliteDatabase(app);
  const store = require('../electron/services/pptProjectStore.cjs').createPptProjectStore({ db: sqlite.db });
  const runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({ app });
  const exporter = require('../electron/services/pptExportService.cjs').createPptExportService({ runtime, BrowserWindow });
  service = require('../electron/services/pptService.cjs').createPptService({ app, store, runtime, exporter, resources: {
    getItem: async (id) => ({ resourceId: id, kind: 'layout', title: '真实wuhua单页', assets: [{ role: 'original', assetId: id, hash: inspectPptx(path.join(evidenceRoot, '../baseline/wuhua-original.pptx')).hash }] }),
    loadAsset: async ({ resourceId }) => ({ filePath: resourceId === 'wuhua-multi' ? path.join(root, '三页原生夹具.pptx') : path.join(evidenceRoot, '../baseline', `${resourceId}-original.pptx`) })
  }, skills: {}, agentService: {}, configStore: { load: () => ({}) }, shell: { trashItem: async () => { throw new Error('本夹具不操作系统回收站'); } },
  dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, `成品.${format}`) }), showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) } });
  let project = service.create({ parent: root, title: '真实原生中文替换', requirements: { aspectRatio: '4:3', mediaEnabled: true, secondsPerPage: 2 } });
  async function waitJob(result) { result = await result; for (let index = 0; index < 3000; index++) { const job = store.jobs(project.projectId).find((item) => item.jobId === result.jobId); if (job && job.status !== 'running') { assert.equal(job.status, 'completed', job.error); project = service.get(project.projectId); return; } await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('后台任务未结算'); }
  await check('真实 wuhua 全包经沙箱导入，原生路线及4:3完整预览', async () => { await waitJob(service.prepareTemplate({ projectId: project.projectId, revision: project.revision, resourceId: 'wuhua', ratioDecision: 'keep' })); assert.equal(project.route, 'edit-native'); assert.equal(project.pages.length, 1); assert.equal(project.requirements.aspectRatio, '4:3'); });
  await check('原生对象精准替换中文，不以封面截图叠字', async () => {
    const before = service.nativeObjects({ projectId: project.projectId });
    const shape = before.pages[0].elements.find((item) => item.type === 'p:sp' && item.text);
    await waitJob(service.nativeReplace({ projectId: project.projectId, revision: project.revision, changes: [{ page: 0, elementId: shape.elementId, text: '真实中文业务替换', expectedText: shape.text }] }));
    assert(service.nativeObjects({ projectId: project.projectId }).pages[0].elements.some((item) => item.text === '真实中文业务替换'));
  });
  await check('PPTX 经新检查报告及上游 roundtrip 实际导出，中文是原生对象', async () => {
    await waitJob(await service.exportProject({ projectId: project.projectId, revision: project.revision, format: 'pptx' }));
    const output = inspectPptx(path.join(root, '成品.pptx')); assert.equal(output.pageCount, 1); assert(output.pages[0].elements.some((item) => item.text === '真实中文业务替换'));
  });
  await check('真实 Electron PDF 与选页图片导出，实际文件非空', async () => {
    format = 'pdf'; await waitJob(await service.exportProject({ projectId: project.projectId, revision: project.revision, format, slideIds: [project.pages[0].slideId] }));
    assert(fs.readFileSync(path.join(root, '成品.pdf')).subarray(0, 5).equals(Buffer.from('%PDF-')));
    await waitJob(await service.exportProject({ projectId: project.projectId, revision: project.revision, format: 'images', slideIds: [project.pages[0].slideId] }));
    const output = fs.readdirSync(root).find((name) => name.startsWith('Jato-PPT-') && fs.existsSync(path.join(root, name, `${project.pages[0].slideId}.png`))); assert(output);
  });
  await check('个人模板是真实重新检查导出副本，原项目文件保持', async () => {
    const before = hash(fs.readFileSync(path.join(project.root, project.pages[0].sourcePath)));
    await waitJob(service.savePersonalTemplate({ projectId: project.projectId, revision: project.revision, title: '个人中文模板', parent: root, confirmed: true }));
    assert.equal(service.personalTemplates().length, 1); assert.equal(hash(fs.readFileSync(path.join(project.root, project.pages[0].sourcePath))), before);
  });
  await check('固定FFmpeg在真实AppContainer导出视频与读取流，无系统PATH', async () => {
    format = 'mp4'; await waitJob(await service.exportProject({ projectId: project.projectId, revision: project.revision, format }));
    assert(fs.statSync(path.join(root, '成品.mp4')).size > 1000);
  });
  await check('三页模板排序/删页/新增后改字，稳定ID与非目标作者页保持，新增页不误改原页', async () => {
    const AdmZip = require('adm-zip'), zip = new AdmZip(path.join(evidenceRoot, '../baseline/wuhua-original.pptx'));
    const originalSlide = zip.getEntry('ppt/slides/slide1.xml').getData(), originalRels = zip.getEntry('ppt/slides/_rels/slide1.xml.rels')?.getData();
    const { load } = require('cheerio'), presentation = load(zip.readAsText('ppt/presentation.xml'), { xml: true }), relationships = load(zip.readAsText('ppt/_rels/presentation.xml.rels'), { xml: true });
    const firstId = presentation('p\\:sldId').first(), firstRelation = relationships('Relationship').toArray().find((node) => relationships(node).attr('Id') === firstId.attr('r:id'));
    for (let index = 2; index <= 3; index++) {
      presentation('p\\:sldIdLst').append(`<p:sldId id="${300 + index}" r:id="jato${index}"/>`);
      relationships('Relationships').append(`<Relationship Id="jato${index}" Type="${relationships(firstRelation).attr('Type')}" Target="slides/slide${index}.xml"/>`);
      zip.addFile(`ppt/slides/slide${index}.xml`, originalSlide);
      if (originalRels) zip.addFile(`ppt/slides/_rels/slide${index}.xml.rels`, originalRels);
      const types = zip.readAsText('[Content_Types].xml').replace('</Types>', `<Override PartName="/ppt/slides/slide${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`); zip.updateFile('[Content_Types].xml', Buffer.from(types));
    }
    zip.updateFile('ppt/presentation.xml', Buffer.from(presentation.xml())); zip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(relationships.xml())); zip.writeZip(path.join(root, '三页原生夹具.pptx'));
    await waitJob(service.prepareTemplate({ projectId: project.projectId, revision: project.revision, resourceId: 'wuhua-multi', ratioDecision: 'keep' }));
    const [first, second, removed] = project.pages, added = { slideId: require('node:crypto').randomUUID(), title: '新增空白页', content: '' };
    await waitJob(service.edit({ projectId: project.projectId, revision: project.revision, slideId: first.slideId, elementId: 'shape-2', attributes: { fill: '#123456' } }));
    const keepHash = project.pages.find((page) => page.slideId === first.slideId).hash;
    project = await service.setPlan({ projectId: project.projectId, revision: project.revision, plan: { pages: [project.plan.pages.find((page) => page.slideId === second.slideId), project.plan.pages.find((page) => page.slideId === first.slideId), added] } });
    assert.deepEqual(project.pages.map((page) => page.slideId), [second.slideId, first.slideId, added.slideId]); assert(!project.pages.some((page) => page.slideId === removed.slideId));
    const blankHash = project.pages[2].hash, objects = service.nativeObjects({ projectId: project.projectId }), blank = objects.pages.find((page) => page.slideId === added.slideId);
    assert.equal(blank.elements.length, 0);
    const shape = objects.pages.find((page) => page.slideId === second.slideId).elements.find((item) => item.type === 'p:sp' && item.text);
    await waitJob(service.nativeReplace({ projectId: project.projectId, revision: project.revision, changes: [{ page: 1, slideId: second.slideId, elementId: shape.elementId, expectedText: shape.text, text: '编排后仅修改第二原生页' }] }));
    assert.deepEqual(project.pages.map((page) => page.slideId), [second.slideId, first.slideId, added.slideId]); assert.equal(project.pages[1].hash, keepHash); assert.equal(project.pages[2].hash, blankHash);
    assert(service.nativeObjects({ projectId: project.projectId }).pages.find((page) => page.slideId === second.slideId).elements.some((item) => item.text === '编排后仅修改第二原生页'));
    const attempt = await service.nativeReplace({ projectId: project.projectId, revision: project.revision, changes: [{ page: 0, slideId: added.slideId, elementId: shape.elementId, text: '不应写入原页' }] });
    for (let index = 0; index < 100; index++) { if (store.jobs(project.projectId).find((item) => item.jobId === attempt.jobId).status !== 'running') break; await new Promise((resolve) => setTimeout(resolve, 30)); }
    const failed = store.jobs(project.projectId).find((item) => item.jobId === attempt.jobId); assert.equal(failed.status, 'failed'); assert.match(failed.error, /没有独立原生对象映射/);
    format = 'pptx'; await waitJob(service.exportProject({ projectId: project.projectId, revision: project.revision, format })); const exported = inspectPptx(path.join(root, '成品.pptx')); assert.equal(exported.pageCount, 3); assert(exported.pages[0].elements.some((item) => item.text === '编排后仅修改第二原生页'));
  });
  await check('真实单页插入仅新增视觉参考待制作页，原生页稳定ID/hash保持，不错绑旧对象', async () => {
    const before = project.pages.map((page) => ({ ...page })); await waitJob(service.insertLayout({ projectId: project.projectId, revision: project.revision, resourceId: 'wuhua' }));
    assert.deepEqual(project.pages.slice(0, before.length).map((page) => [page.slideId,page.hash]), before.map((page) => [page.slideId,page.hash]));
    const added = project.pages.at(-1); assert.equal(project.plan.pages.at(-1).slideId, added.slideId); assert.equal(service.nativeObjects({ projectId: project.projectId }).pages.at(-1).elements.length, 0); assert.equal(project.confirmedRevision, null);
    assert(fs.existsSync(path.join(project.root, `${project.plan.pages.at(-1).sourceRefs}.pptx`)));
    format = 'pptx'; await waitJob(service.exportProject({ projectId: project.projectId, revision: project.revision, format, slideIds: [added.slideId] })); assert.equal(inspectPptx(path.join(root, '成品.pptx')).pageCount, 1);
  });
  await check('free真实四页只进入视觉参考，不能宣称原生套用', async () => {
    await waitJob(service.prepareTemplate({ projectId: project.projectId, revision: project.revision, resourceId: 'free', ratioDecision: 'reflow' }));
    assert.equal(project.route, 'generate'); assert.equal(project.pages.length, 0); assert.equal(project.resource.capability, 'unverified');
  });
  await check('生成路线插入真实单页参考；原页文件hash保持，引用和计划稳定ID一致', async () => {
    await waitJob(service.insertLayout({ projectId: project.projectId, revision: project.revision, resourceId: 'wuhua' })); const first = project.pages[0];
    await waitJob(service.insertLayout({ projectId: project.projectId, revision: project.revision, resourceId: 'wuhua' })); assert.equal(project.pages[0].slideId, first.slideId); assert.equal(project.pages[0].hash, first.hash);
    for(let count=2;count<8;count++)await waitJob(service.insertLayout({projectId:project.projectId,revision:project.revision,resourceId:'wuhua'})); assert.equal(project.pages.length,8); assert(project.pages.every(page=>path.basename(page.sourcePath).length<64)); assert.equal(project.pages[0].hash,first.hash);
    assert.deepEqual(project.pages.map((page) => page.slideId), project.plan.pages.map((page) => page.slideId)); assert.equal(project.confirmedRevision, null); assert(project.plan.pages.every((page) => fs.existsSync(path.join(project.root, `${page.sourceRefs}.pptx`))));
  });
}
main().catch((error) => { console.error(error.stack); if (!results.some((item) => item.status === 'FAIL')) results.push({ status: 'FAIL', error: error.stack }); }).finally(async () => {
  clearTimeout(deadline); await service?.close(); sqlite?.close(); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(JSON.stringify({ root, results })); app.exit(results.some((item) => item.status === 'FAIL') ? 1 : 0);
});
