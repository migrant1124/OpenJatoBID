'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createPiJsonValidationTool,
  resolveWorkspaceFile,
} = require('./piJsonValidationTool.cjs');

const Type = {
  Object: () => ({}),
  String: () => ({}),
  Optional: (value) => value,
  Union: () => ({}),
  Boolean: () => ({}),
};

test('json-validation 只允许当前工作区内的相对文件', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-json-validation-'));
  try {
    assert.throws(() => resolveWorkspaceFile(workspace, '../outside.json'), /超出当前工作区/u);
    assert.throws(() => resolveWorkspaceFile(workspace, 'C:\\outside.json'), /非空相对路径/u);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('json-validation 使用预置 Schema 校验工作区输出', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-json-validation-'));
  try {
    fs.writeFileSync(path.join(workspace, 'result.json'), '{"status":"ok"}', 'utf-8');
    const tool = createPiJsonValidationTool({
      workspaceDir: workspace,
      Type,
      validationSchemas: {
        'result.json': {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: { status: { const: 'ok' } },
        },
      },
    });
    const result = await tool.execute('test', { file_path: 'result.json' });
    assert.equal(result.isError, undefined);
    assert.equal(result.details.valid, true);
    assert.equal(result.details.stage, 'success');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
