const fs = require('node:fs');
const path = require('node:path');

function pageRoster(root, route) {
  const native = route === 'edit-native', directory = path.join(root, native ? 'native/authoring-svg-flat' : 'svg_output');
  if (!fs.existsSync(directory)) return [];
  const planFile = path.join(root, 'native/page_plan.json');
  if (native && fs.existsSync(planFile)) {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    if (plan.schema !== 'ppt-master.roundtrip-page-plan.v1' || !Array.isArray(plan.pages) || !plan.pages.length) throw new Error('原生页面清单不符合固定上游合同');
    return plan.pages.map((page) => {
      const fileName = page.svg || `slide_${String(page.source_slide).padStart(2, '0')}.svg`;
      if (!Number.isInteger(page.source_slide) || page.source_slide < 1 || path.basename(fileName) !== fileName || !fileName.endsWith('.svg') || !fs.existsSync(path.join(directory, fileName))) throw new Error('原生页面清单映射缺失');
      return { fileName, sourceSlide: page.source_slide };
    });
  }
  return fs.readdirSync(directory).filter((name) => name.endsWith('.svg')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((fileName, index) => ({ fileName, sourceSlide: native ? index + 1 : undefined }));
}

function pruneNativePages(root, names) {
  const directory = path.join(root, 'native/authoring-svg-flat'), manifest = JSON.parse(fs.readFileSync(path.join(directory, 'authoring_manifest.json'), 'utf8'));
  const retained = new Set([...manifest.documents.map((item) => item.authoring), ...names]);
  for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('.svg'))) if (!retained.has(name)) fs.unlinkSync(path.join(directory, name));
}

// 导出选页只改导出候选，原生交叉链接是否仍有效由上游严格检查。
function selectPages(root, project, pages) {
  const directory = path.join(root, project.route === 'edit-native' ? 'native/authoring-svg-flat' : 'svg_output');
  if (project.route === 'edit-native') {
    const roster = pageRoster(root, project.route), selected = pages.map((page) => {
      const entry = roster.find((item) => item.fileName === path.basename(page.sourcePath));
      if (!entry) throw new Error('导出页与原生清单不一致');
      return { source_slide: entry.sourceSlide, svg: entry.fileName };
    });
    fs.writeFileSync(path.join(root, 'native/page_plan.json'), JSON.stringify({ schema: 'ppt-master.roundtrip-page-plan.v1', pages: selected }, null, 2), 'utf8');
    pruneNativePages(root, selected.map((page) => page.svg));
  } else {
    const { remapLinks, updatePlanDocuments } = require('./pptPageAssociations.cjs');
    const before = pageRoster(root, project.route).map((entry) => project.pages?.find((page) => path.basename(page.sourcePath) === entry.fileName) || project.plan?.pages?.find((page) => page.fileName === entry.fileName));
    if (before.some((page) => !page)) throw new Error('导出候选缺少稳定页映射');
    for (const page of pages) { const file = path.join(root, page.sourcePath); fs.writeFileSync(file, remapLinks(fs.readFileSync(file, 'utf8'), before, pages), 'utf8'); page.hash = require('./pptTemplateService.cjs').hash(fs.readFileSync(file)); }
    updatePlanDocuments(root, project.plan?.pages || before, pages.map((page) => ({ ...(project.plan?.pages?.find((item) => item.slideId === page.slideId) || {}), ...page })));
    const selected = new Set(pages.map((page) => path.basename(page.sourcePath)));
    for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('.svg'))) if (!selected.has(name)) fs.unlinkSync(path.join(directory, name));
  }
}
module.exports = { pageRoster, selectPages, pruneNativePages };
