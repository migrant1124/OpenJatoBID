const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Zip = require('adm-zip'), { completeSkillReferences } = require('../electron/services/pptSkillPackage.cjs');
test('完整仓库引用入归属副本并保留来源hash、目录及页内锚点，原ZIP不改', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-skill-references-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zip = new Zip(), prefix = 'repo/skills/test/'; zip.addFile(prefix + 'SKILL.md', Buffer.from('[文档](../../docs/a.md#定义)')); zip.addFile(prefix + 'references/a.md', Buffer.from('保留Skill资料')); zip.addFile('repo/docs/a.md', Buffer.from('[目录](../skills/test/references/)\n[循环](./a.md)'));
  const file = path.join(root, '原包.zip'), copy = path.join(root, '副本'); zip.writeZip(file); fs.mkdirSync(copy); fs.writeFileSync(path.join(copy, 'SKILL.md'), zip.getEntry(prefix + 'SKILL.md').getData()); fs.mkdirSync(path.join(copy, 'references')); fs.writeFileSync(path.join(copy, 'references/a.md'), '保留Skill资料');
  const original = fs.readFileSync(file); completeSkillReferences(file, prefix, copy); assert(fs.readFileSync(file).equals(original)); assert.match(fs.readFileSync(path.join(copy, 'SKILL.md'), 'utf8'), /references\/repository\/docs\/a.md#定义/); assert.match(fs.readFileSync(path.join(copy, 'references/repository/docs/a.md'), 'utf8'), /\]\(\.\.\/\.\.\)/); assert.equal(JSON.parse(fs.readFileSync(path.join(copy, 'jato-package-references.json'), 'utf8')).files.length, 2);
});
test('文档引用不能绕过完整包执行组件限制', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-skill-references-block-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zip = new Zip(), prefix = 'repo/skills/test/'; zip.addFile(prefix + 'SKILL.md', Buffer.from('[不允许](../../bin/helper.exe)')); zip.addFile('repo/bin/helper.exe', Buffer.from('不会执行'));
  const file = path.join(root, '原包.zip'); zip.writeZip(file); assert.throws(() => completeSkillReferences(file, prefix, path.join(root, '副本')), /未批准的执行组件/);
});
