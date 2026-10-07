const fs = require('node:fs');
const path = require('node:path');

function lockFields(text) {
  const sections = {}; let section = '';
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(\S+)\s*$/.exec(line), field = /^-\s+([^:]+):\s*(.*?)\s*$/.exec(line);
    if (heading) { section = heading[1]; sections[section] = {}; }
    else if (field && sections[section]) sections[section][field[1].trim()] = field[2];
  }
  return sections;
}
function auditDesign({ root, direction, requirements, plan, actualPages, scope = [], directionScope = [], oldPlan }) {
  const fields = lockFields(fs.readFileSync(path.join(root, 'spec_lock.md'), 'utf8'));
  const spec = fs.readFileSync(path.join(root, 'design_spec.md'), 'utf8');
  const same = (actual, expected, label) => { if (String(actual || '').trim().toLowerCase() !== String(expected).trim().toLowerCase()) throw new Error(`产物与所选方案的${label}不同，请重新确认受影响方案`); };
  for (const [role, keys] of Object.entries({ background:['bg'], text:['text'], primary:['primary'], secondary:['secondary','secondary_text'], accent:['accent'], muted:['muted','divider'] })) same(keys.map(key => fields.colors?.[key]).find(Boolean), direction.colors[role], `颜色（${role}）`);
  same(fields.typography?.title_family || fields.typography?.font_family, direction.fonts.title, '标题字体');
  same(fields.typography?.body_family || fields.typography?.font_family, direction.fonts.body, '正文字体');
  same(fields.typography?.body, direction.bodySize, '正文字号');
  same(fields.visual_style?.visual_style, direction.style, '视觉风格');
  same(fields.communication?.primary_language, requirements.language, '语言');
  const box = (fields.canvas?.viewBox || '').split(/\s+/).map(Number), ratio = requirements.aspectRatio.split(':').map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || Math.abs(box[2] / box[3] - ratio[0] / ratio[1]) > .001) throw new Error('产物画幅与已确认画幅不同');
  const notes = /\|\s*Speaker Notes\s*\|\s*(enabled|disabled)\s*\|/i.exec(spec)?.[1]?.toLowerCase();
  same(notes, direction.notes ? 'enabled' : 'disabled', '讲稿设置');
  const approvedPages = plan?.pages?.filter(page=>!directionScope.length || directionScope.includes(page.slideId));
  if (!approvedPages || approvedPages.length !== direction.pages.length || approvedPages.some((page,index) => page.title !== direction.pages[index].title)) throw new Error('内部计划的页数、顺序或标题与所选方案不同');
  if (!actualPages || actualPages.length !== plan.pages.length || actualPages.some((page,index)=>page.slideId!==plan.pages[index].slideId || path.basename(page.sourcePath)!==plan.pages[index].fileName)) throw new Error('实际页面清单、顺序或标识与已确认计划不同');
  if (scope.length && oldPlan?.pages) for (const page of oldPlan.pages.filter(item => !scope.includes(item.slideId))) {
    if (JSON.stringify(plan.pages.find(item => item.slideId === page.slideId)) !== JSON.stringify(page)) throw new Error('局部任务改动了未选页内部规划');
  }
}
function auditTemplate(root, kind) {
  const folder = path.join(root, 'templates');
  const files = fs.readdirSync(folder).filter(name => /^design_spec(?:\.[^.]+\.[^.]+)?\.md$/.test(name));
  if (files.length !== 1) throw new Error('创建模板须提供唯一完整规格，不能混入其他模板');
  const text = fs.readFileSync(path.join(folder,files[0]),'utf8');
  const actual = /^\s*kind:\s*["']?(brand|style|layout|deck)["']?\s*$/m.exec(text)?.[1];
  const id = new RegExp(`^\\s*${kind}_id:\\s*["']?([^\\s"']+)["']?\\s*$`,'m').exec(text)?.[1];
  if (actual !== kind || !id || /TODO/i.test(id) || /<!--\s*TODO|\bTODO\b/.test(text)) throw new Error('模板类型、标识或未完成章节与获准模板合同不符');
  if (files[0] !== 'design_spec.md' && files[0] !== `design_spec.${kind}.${id}.md`) throw new Error('模板规格文件名与标识不符');
  const pages = fs.readdirSync(folder).filter(name => name.endsWith('.svg'));
  if (['brand','style'].includes(kind) ? pages.length > 0 : pages.length === 0) throw new Error('Brand/Style只含规格；Layout/Deck必须包含完整原型');
  return { kind, id, pages };
}
module.exports = { auditDesign, auditTemplate };
