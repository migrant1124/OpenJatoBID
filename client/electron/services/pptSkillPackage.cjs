const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

// 将完整原仓库包中被Skill引用的文档带入归属副本；不联网、不执行或改动原包。
function completeSkillReferences(source, prefix, destination) {
  if (!prefix) return;
  const archive = new AdmZip(source), entries = new Map(archive.getEntries().filter((entry) => !entry.isDirectory).map((entry) => [entry.entryName, entry]));
  const repository = prefix.split('/')[0] + '/', visited = new Set(), records = [];
  const mapped = (name) => name.startsWith(prefix) ? name.slice(prefix.length) : `references/repository/${name.slice(repository.length)}`;
  const queue = [...entries.keys()].filter((name) => name.startsWith(prefix) && /\.md$/i.test(name));
  while (queue.length) {
    const name = queue.shift(); if (visited.has(name)) continue; visited.add(name);
    const entry = entries.get(name); if (!entry) continue;
    if (/\.(exe|dll|bat|cmd|msi|ps1)$/i.test(name)) throw new Error('Skill引用含未批准的执行组件');
    const original = entry.getData(), relative = mapped(name);
    let content = original;
    if (/\.md$/i.test(name)) {
      content = Buffer.from(original.toString('utf8').replace(/\]\(([^\s)]+)(?=[\s)])/g, (full, link) => {
        const [raw, ...anchor] = link.split('#'); if (!raw || /^(?:https?:|mailto:|data:)/i.test(raw)) return full;
        let decoded; try { decoded = decodeURIComponent(raw); } catch { return full; }
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), decoded));
        const children = entries.has(target) ? [] : [...entries.keys()].filter((entry) => entry.startsWith(target.replace(/\/$/, '') + '/'));
        if (!target.startsWith(repository) || (!entries.has(target) && !children.length)) return full;
        if (!target.startsWith(prefix)) queue.push(...(entries.has(target) ? [target] : children));
        const replacement = path.posix.relative(path.posix.dirname(relative), mapped(target)).split('/').map((part) => encodeURIComponent(part)).join('/');
        return `](${replacement}${anchor.length ? '#' + anchor.join('#') : ''}`;
      }), 'utf8');
    }
    const target = path.resolve(destination, relative); if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error('Skill引用归属路径越界');
    if (!name.startsWith(prefix) || !original.equals(content)) {
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
      const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
      records.push({ source: name.slice(repository.length), path: relative, sourceHash: hash(original), normalizedHash: hash(content) });
    }
  }
  if (records.length) fs.writeFileSync(path.join(destination, 'jato-package-references.json'), JSON.stringify({ schema: 'jato.skill-reference-map.v1', files: records.sort((a, b) => a.path.localeCompare(b.path)) }, null, 2), 'utf8');
}
module.exports = { completeSkillReferences };
