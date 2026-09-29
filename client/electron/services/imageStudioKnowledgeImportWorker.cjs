const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { parentPort, workerData } = require('node:worker_threads');
const AdmZip = require('adm-zip');

try {
  const { filePath, targetRoot, publicKeyPath, currentVersion, currentGeneratedAt, expectedCommit } = workerData;
  if (fs.statSync(filePath).size > 35_000_000) throw new Error('离线知识包超过 35 MB。');
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const allowed = new Set(['manifest.json', 'knowledge.jsonl.gz', 'LICENSE', 'signature.bin']);
  if (entries.length !== allowed.size || entries.some((entry) => !allowed.has(entry.entryName) || entry.isDirectory)
    || new Set(entries.map((entry) => entry.entryName)).size !== allowed.size) throw new Error('知识包包含不允许的文件。');
  const get = (name, max) => {
    const entry = entries.find((item) => item.entryName === name);
    if (!entry || entry.header.size > max) throw new Error(`知识包文件 ${name} 无效或过大。`);
    return entry.getData();
  };
  const manifestBytes = get('manifest.json', 50_000);
  const signature = get('signature.bin', 128);
  if (!crypto.verify(null, manifestBytes, fs.readFileSync(publicKeyPath), signature)) throw new Error('知识包签名无效。');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.sourceId !== 'youmind-image-prompts'
    || !Number.isFinite(Date.parse(manifest.generatedAt))
    || !/^youmind-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/.test(manifest.packageVersion)) throw new Error('知识包版本或格式无效。');
  if (expectedCommit && manifest.upstreamCommit !== expectedCommit) throw new Error('签名知识包与已检查的上游提交不一致。');
  if (currentVersion && (manifest.packageVersion === currentVersion
    || Date.parse(manifest.generatedAt) <= Date.parse(currentGeneratedAt))) {
    parentPort.postMessage({ unchanged: true, version: currentVersion });
  } else {
    const data = get('knowledge.jsonl.gz', 25_000_000);
    const actualHash = crypto.createHash('sha256').update(data).digest('hex');
    if (data.length !== manifest.files?.['knowledge.jsonl.gz']?.size
      || actualHash !== manifest.files?.['knowledge.jsonl.gz']?.sha256) throw new Error('知识包内容哈希或字节数无效。');
    const plain = zlib.gunzipSync(data, { maxOutputLength: 150_000_000 }).toString('utf8');
    const lines = plain.split('\n');
    if (lines.length !== manifest.deduplicatedCount || lines.length > 30_000) throw new Error('知识包条目数异常。');
    for (const line of lines) {
      const row = JSON.parse(line);
      if (!row.id || !row.prompt || !Array.isArray(row.categories)) throw new Error('知识包条目格式无效。');
    }
    if (!get('LICENSE', 10_000).toString('utf8').includes('MIT License')) throw new Error('知识包许可证无效。');
    fs.mkdirSync(targetRoot, { recursive: true });
    const staging = path.join(targetRoot, `.staging-${crypto.randomUUID()}`);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'manifest.json'), manifestBytes);
    fs.writeFileSync(path.join(staging, 'knowledge.jsonl.gz'), data);
    const versionDir = path.join(targetRoot, manifest.packageVersion);
    fs.renameSync(staging, versionDir);
    const pointer = path.join(targetRoot, 'current.json');
    const temporary = `${pointer}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: manifest.packageVersion, previous: currentVersion || null }), 'utf8');
    fs.renameSync(temporary, pointer);
    parentPort.postMessage({ version: manifest.packageVersion, count: lines.length });
  }
} catch (error) { parentPort.postMessage({ error: String(error.message || error) }); }
