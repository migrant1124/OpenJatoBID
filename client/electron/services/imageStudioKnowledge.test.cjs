const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');
const AdmZip = require('adm-zip');
const { createImageStudioKnowledge } = require('./imageStudioKnowledge.cjs');

const bundled = path.join(__dirname, '../resources/image-studio-knowledge');
const signedPackage = path.join(bundled, 'knowledge-package.zip');

function runImport(filePath, targetRoot, expectedCommit) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'imageStudioKnowledgeImportWorker.cjs'), { workerData: {
      filePath, targetRoot, publicKeyPath: path.join(bundled, 'trust-public.pem'), currentVersion: '', expectedCommit,
    } });
    worker.once('message', resolve); worker.once('error', reject);
  });
}

test('内置知识 FTS5 可检索，签名离线包原子导入且脚本条目被拒', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-knowledge-'));
  const knowledge = createImageStudioKnowledge({ getPath: () => temp });
  try {
    for (let i = 0; i < 30 && !knowledge.status().ready; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(knowledge.status().ready, true, knowledge.status().error);
    const result = await knowledge.search('产品摄影 留白');
    assert.equal(result.status, 'matched');
    assert.ok(result.items.length <= 3);
    assert.ok(result.items.length > 0);
    const imported = await runImport(signedPackage, path.join(temp, 'image-studio-knowledge'));
    assert.equal(imported.version, knowledge.status().version);
    const zip = new AdmZip(signedPackage);
    zip.addFile('setup.js', Buffer.from('throw Error("不可执行")'));
    const invalid = path.join(temp, 'invalid.zip');
    zip.writeZip(invalid);
    assert.match((await runImport(invalid, path.join(temp, 'invalid-target'))).error, /不允许的文件/);
    assert.equal(fs.existsSync(path.join(temp, 'invalid-target', 'current.json')), false);
    assert.match((await runImport(signedPackage, path.join(temp, 'wrong-commit'), '0'.repeat(40))).error, /上游提交不一致/);
    assert.equal(fs.existsSync(path.join(temp, 'wrong-commit', 'current.json')), false);
  } finally { await knowledge.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
