const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function loadKnowledgeBaseModule() {
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
      return { dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } };
    }
    if (request === './fileService.cjs') {
      return { parseDocumentWithConfig: async () => ({ markdown: '' }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('./knowledgeBaseService.cjs');
  } finally {
    Module._load = originalLoad;
  }
}

const { createKnowledgeBaseService } = loadKnowledgeBaseModule();

function createDocument(id) {
  return {
    id,
    file_name: `${id}.docx`,
    folder_id: 'folder-1',
    document_dir: `folders/folder-1/documents/${id}`,
    status: 'success',
  };
}

function createFixture(tempDir, documentIds) {
  const documents = new Map(documentIds.map((id) => [id, createDocument(id)]));
  const deletedIds = [];
  const store = {
    getDocument(documentId) {
      return documents.get(documentId);
    },
    deleteDocument(documentId) {
      deletedIds.push(documentId);
      const document = documents.get(documentId);
      documents.delete(documentId);
      return document;
    },
  };
  const app = { getPath: () => tempDir };
  const service = createKnowledgeBaseService({ app, aiService: {}, configStore: {}, knowledgeBaseStore: store });
  return { service, documents, deletedIds };
}

function createDocumentArtifacts(tempDir, documentId) {
  const documentDir = path.join(tempDir, 'workspace', 'knowledge-base', 'folders', 'folder-1', 'documents', documentId);
  const debugLogPath = path.join(tempDir, 'logs', 'knowledge-base', `${documentId}.jsonl`);
  const importedImagesDir = path.join(tempDir, 'workspace', 'imported-images', `knowledge-${documentId}-batch`);
  fs.mkdirSync(documentDir, { recursive: true });
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(debugLogPath, 'debug', 'utf8');
  fs.mkdirSync(importedImagesDir, { recursive: true });
  return { documentDir, debugLogPath, importedImagesDir };
}

test('批量删除会先校验全部文档，存在无效 ID 时不删除任何已选文档', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-batch-delete-preflight-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const fixture = createFixture(tempDir, ['document-1']);
  const artifacts = createDocumentArtifacts(tempDir, 'document-1');

  assert.throws(
    () => fixture.service.deleteDocuments(['document-1', 'missing-document']),
    /知识库文档不存在/,
  );
  assert.equal(fixture.documents.has('document-1'), true);
  assert.deepEqual(fixture.deletedIds, []);
  assert.equal(fs.existsSync(artifacts.documentDir), true);
  assert.equal(fs.existsSync(artifacts.debugLogPath), true);
  assert.equal(fs.existsSync(artifacts.importedImagesDir), true);
});

test('批量删除去重后清理所选文档、调试日志和导入图片', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-kb-batch-delete-success-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const fixture = createFixture(tempDir, ['document-1', 'document-2']);
  const firstArtifacts = createDocumentArtifacts(tempDir, 'document-1');
  const secondArtifacts = createDocumentArtifacts(tempDir, 'document-2');

  const result = fixture.service.deleteDocuments(['document-1', 'document-2', 'document-1']);

  assert.deepEqual(result, { success: true, message: '已批量删除 2 个文档' });
  assert.deepEqual(fixture.deletedIds, ['document-1', 'document-2']);
  assert.equal(fixture.documents.size, 0);
  for (const artifactPath of Object.values(firstArtifacts).concat(Object.values(secondArtifacts))) {
    assert.equal(fs.existsSync(artifactPath), false, `${artifactPath} 应已删除`);
  }
});
