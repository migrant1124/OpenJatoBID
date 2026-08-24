const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createConversationReadOnlyTools, ensureInsideWorkspace } = require('./piSessionFactory.cjs');

test('conversation read-only tools reject absolute and parent paths outside the workspace', () => {
  const root = path.resolve('C:\\conversation-workspace');
  assert.equal(ensureInsideWorkspace(root, path.join(root, 'attachments', 'a1', 'content.md')), path.join(root, 'attachments', 'a1', 'content.md'));
  assert.throws(() => ensureInsideWorkspace(root, path.resolve(root, '..', 'secret.txt')), /当前对话工作区/);
  assert.throws(() => ensureInsideWorkspace(root, 'D:\\secret.txt'), /当前对话工作区/);
});

test('conversation Pi tool definitions enforce the same root at execution time', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-conversation-root-'));
  const outside = path.join(path.dirname(root), 'outside-secret.txt');
  fs.writeFileSync(outside, 'secret', 'utf8');
  const fakeCodingAgent = {
    createReadToolDefinition: (_cwd, options) => ({ name: 'read', options }),
    createFindToolDefinition: (_cwd, options) => ({ name: 'find', options }),
    createLsToolDefinition: (_cwd, options) => ({ name: 'ls', options }),
  };
  const [read, find, ls] = createConversationReadOnlyTools(fakeCodingAgent, root);
  await assert.rejects(() => read.options.operations.readFile(outside), /当前对话工作区/);
  assert.equal(await find.options.operations.exists(outside), false);
  assert.equal(await ls.options.operations.exists(outside), false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
});
