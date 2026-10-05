// 只获取公开测试原包，不读取生产资料；固定内容变化时停止验收。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const fixtures = require('./ppt-test-fixtures.json');
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
async function main() {
  const root = path.resolve(process.argv[2] || process.env.JATOBID_PPT_TEST_FIXTURES || path.join(__dirname, '../.tmp/ci-ppt-fixtures'));
  fs.mkdirSync(root, { recursive: true });
  for (const fixture of fixtures) {
    const file = path.join(root, fixture.file);
    if (fs.existsSync(file) && digest(fs.readFileSync(file)) === fixture.sha256) continue;
    const response = await fetch(fixture.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`公开样本下载失败：${fixture.file} HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== fixture.sha256) throw new Error(`公开样本内容变化：${fixture.file}`);
    fs.writeFileSync(file, bytes);
  }
  fs.writeFileSync(path.join(root, 'fixtures.json'), JSON.stringify(fixtures, null, 2), 'utf8');
  console.log(`固定公开 PPT 样本已校验：${root}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
