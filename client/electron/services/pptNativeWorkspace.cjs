const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('cheerio');
const { pageRoster } = require('./pptPageRoster.cjs');

const parse = (file) => load(fs.readFileSync(file, 'utf8'), { xml: true });
function sourceObjects(root, sourceSlide) {
  return pageRoster(root, 'edit-native').filter((page) => page.sourceSlide === sourceSlide).map((page) => {
    const file = path.join(root, 'native/authoring-svg-flat', page.fileName), doc = parse(file);
    return { ...page, file, doc, refs: new Set(doc('[data-pptx-source-ref]').toArray().map((node) => doc(node).attr('data-pptx-source-ref'))) };
  });
}

// 只合并被选原生对象，整份作者页面和页面清单继续作为当前制作权威。
async function updateNativeWorkspace({ candidate, source, runtime, signal, changes, pages }) {
  const affected = changes.map((change) => {
    const ref = `slide:${change.elementId}`;
    const matches = sourceObjects(candidate, change.page + 1).filter((page) => page.refs.has(ref));
    const chosen = change.slideId ? matches.find((page) => pages.find((item) => item.slideId === change.slideId && path.basename(item.sourcePath) === page.fileName)) : matches.length === 1 ? matches[0] : null;
    if (!chosen) throw new Error('目标页没有独立原生对象映射，不能修改其他页面的模板对象');
    if (matches.length !== 1) throw new Error('该模板对象被多个制作页复用，请先使用独立页面对象再进行原生替换');
    const group = chosen.doc('[data-pptx-source-ref]').toArray().find((node) => chosen.doc(node).attr('data-pptx-source-ref') === ref);
    const currentText = chosen.doc(group).find('text').toArray().map((node) => chosen.doc(node).text()).join('');
    if (change.expectedText !== undefined && currentText !== change.expectedText) throw new Error('当前作者页面的对象文字已变化');
    return { ...change, ref, fileName: chosen.fileName };
  });
  const fresh = path.join(candidate, `.native-update-${crypto.randomUUID()}`), native = path.join(candidate, 'native');
  fs.mkdirSync(fresh);
  try {
    await runtime.run({ script: 'pptx_to_svg.py', args: [source, '-o', fresh, '--roundtrip'], projectRoot: candidate, signal });
    const edits = new Map();
    for (const item of affected) {
      const currentFile = path.join(native, 'authoring-svg-flat', item.fileName), doc = edits.get(item.fileName) || parse(currentFile);
      const current = doc('[data-pptx-source-ref]').toArray().filter((node) => doc(node).attr('data-pptx-source-ref') === item.ref);
      const imported = parse(path.join(fresh, 'authoring-svg-flat', `slide_${String(item.page + 1).padStart(2, '0')}.svg`));
      const next = imported('[data-pptx-source-ref]').toArray().filter((node) => imported(node).attr('data-pptx-source-ref') === item.ref);
      if (current.length !== 1 || next.length !== 1) throw new Error('原生对象投影不是唯一映射，原版本保留');
      if (item.chart) doc(current[0]).replaceWith(imported.xml(next[0]));
      else {
        const text = doc(current[0]).find('text'), replacement = imported(next[0]).find('text');
        if (!text.length || !replacement.length) throw new Error('原生文字投影缺失，原版本保留');
        // 替换文本投影，保留该形状的几何、背景和其他页面的所有编辑。
        text.first().before(replacement.toArray().map((node) => imported.xml(node)).join('')); text.remove();
      }
      edits.set(item.fileName, doc);
    }
    for (const name of fs.readdirSync(path.join(native, 'authoring-svg-flat')).filter((name) => name.endsWith('.svg'))) fs.copyFileSync(path.join(native, 'authoring-svg-flat', name), path.join(fresh, 'authoring-svg-flat', name));
    for (const name of ['page_plan.json', 'notes', 'animations.json']) {
      const existing = path.join(native, name), target = path.join(fresh, name);
      if (!fs.existsSync(existing)) continue;
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(existing, target, { recursive: true });
    }
    for (const [name, doc] of edits) fs.writeFileSync(path.join(fresh, 'authoring-svg-flat', name), doc.xml(), 'utf8');
    if (signal?.aborted) throw new Error('原生替换已取消，原版保留');
    fs.rmSync(native, { recursive: true }); fs.renameSync(fresh, native);
  } finally { if (fs.existsSync(fresh)) fs.rmSync(fresh, { recursive: true }); }
}
module.exports = { sourceObjects, updateNativeWorkspace };
