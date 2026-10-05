const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');

// 页码只用于输出；关联始终按旧页面稳定 ID 映射到当前清单。
function remapLinks(svg, before, after) {
  const doc = load(svg, { xml: true });
  for (const node of doc('a,[data-pptx-shape-hyperlink]').toArray()) {
    const anchor = doc(node), attribute = anchor.attr('data-pptx-shape-hyperlink') !== undefined ? 'data-pptx-shape-hyperlink' : anchor.attr('href') !== undefined ? 'href' : 'xlink:href';
    const match = /^#slide-([1-9]\d*)$/.exec(anchor.attr(attribute) || '');
    if (!match) continue;
    const target = before[Number(match[1]) - 1]?.slideId, position = after.findIndex((page) => page.slideId === target);
    if (position < 0) { anchor.removeAttr(attribute); anchor.removeAttr('data-jato-slide-id'); }
    else { anchor.attr(attribute, `#slide-${position + 1}`); anchor.attr('data-jato-slide-id', target); }
    for (const label of anchor.find('[data-jato-page-number]').toArray()) doc(label).text(position < 0 ? '' : String(position + 1));
  }
  return doc.xml();
}
function updatePlanDocuments(root, before, after) {
  const spec = path.join(root, 'design_spec.md');
  if (fs.existsSync(spec)) {
    let text = fs.readFileSync(spec, 'utf8');
    const section = /^## IX\. Content Outline[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/m.exec(text);
    if (section) {
      const blocks = [...section[0].matchAll(/^#{3,6} Slide (\d+)[^\n]*\n([\s\S]*?)(?=^#{3,6} Slide |$(?![\s\S]))/gm)];
      const outline = after.map((page, index) => {
        const oldIndex = before.findIndex((item) => item.slideId === page.slideId);
        let body = blocks.find((block) => Number(block[1]) === oldIndex + 1)?.[2] || '- **Audience move**: 由已确认计划补充。\n- **Relationships**: none\n';
        body = body.replace(/^- \*\*(Title|Content)\*\*:.*(?:\n|$)/gm, '').replace(/#slide-(\d+)/g, (_, number) => { const target = before[Number(number) - 1]?.slideId, position = after.findIndex((item) => item.slideId === target); return position < 0 ? 'none' : `#slide-${position + 1}`; });
        return `#### Slide ${String(index + 1).padStart(2, '0')} - ${page.title}\n${body.trim()}\n- **Title**: ${page.title}\n- **Content**: ${page.content || page.task || ''}\n`;
      }).join('\n');
      text = text.replace(section[0], `## IX. Content Outline\n${outline}\n`);
      text = text.replace(/(\| Page Count \|\s*)[^|]+(\|)/, `$1${after.length} $2`);
      fs.writeFileSync(spec, text, 'utf8');
    }
  }
  const lock = path.join(root, 'spec_lock.md');
  if (fs.existsSync(lock)) {
    let text = fs.readFileSync(lock, 'utf8'); const section = /^## page_rhythm[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/m.exec(text);
    if (section) { const rhythms = [...section[0].matchAll(/^- P(\d+):\s*(.*)$/gm)]; text = text.replace(section[0], '## page_rhythm\n' + after.map((page, index) => { const oldIndex = before.findIndex((item) => item.slideId === page.slideId); return `- P${String(index + 1).padStart(2, '0')}: ${rhythms.find((row) => Number(row[1]) === oldIndex + 1)?.[2] || 'anchor'}`; }).join('\n') + '\n'); fs.writeFileSync(lock, text, 'utf8'); }
  }
}
module.exports = { remapLinks, updatePlanDocuments };
