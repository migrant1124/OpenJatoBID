const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const commit = 'bd36e0bcd624a36f86fdd5d9fa1756de1bd9d2ef';
const base = `https://raw.githubusercontent.com/yukkcat/image-prompts/${commit}/dist/`;

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('需要摘要输出路径。');
  const baseline = require(path.resolve(__dirname, '../../docs/v1.8.0-source-baseline.json'));
  const manifest = await (await fetch(`${base}manifest.json`)).json();
  const sources = [];
  for (const expected of baseline.sources) {
    const entry = manifest.sources.find((item) => item.id === expected.id);
    if (!entry) throw new Error(`manifest 缺少 ${expected.id}`);
    const response = await fetch(`${base}${entry.path}`);
    if (!response.ok) throw new Error(`${entry.id} HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256) throw new Error(`${entry.id} SHA-256 不匹配`);
    const items = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(items) || items.length !== entry.count) throw new Error(`${entry.id} 数量不匹配`);
    sources.push({ id: entry.id, count: items.length, sha256,
      chineseTitle: items.filter((item) => /[\u3400-\u9fff]/.test(String(item.title || ''))).length,
      chinesePrompt: items.filter((item) => /[\u3400-\u9fff]/.test(String(item.prompt || ''))).length,
      pinnedUrl: `${base}${entry.path}`, homepage: expected.homepage,
      redistributionRights: 'unverified', bundled: false });
  }
  const report = { registryCommit: commit, manifestGeneratedAt: manifest.generatedAt,
    manifestTotal: manifest.total, verifiedTotal: sources.reduce((sum, source) => sum + source.count, 0),
    noticeUrl: 'https://github.com/yukkcat/image-prompts/blob/main/NOTICE.md',
    sources };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ registryCommit: commit, verifiedTotal: report.verifiedTotal,
    sourceCount: sources.length, chinesePrompt: sources.reduce((sum, source) => sum + source.chinesePrompt, 0) }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
