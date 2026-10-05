import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('合入main的验证只读且不发布、不注入生产凭据或上传管理端产物', () => {
  const verify = read('.github/workflows/verify.yml');
  assert.match(verify, /push:[\s\S]*branches: \[main\]/);
  assert.match(verify, /pull_request:[\s\S]*branches: \[main\]/);
  assert.match(verify, /contents: read/);
  assert.doesNotMatch(verify, /contents: write|secrets\.|upload-artifact|gh release|R2_RELEASE_ACTION|npm version|electron-builder/);
  assert.match(verify, /npm run test:ci-upgrade/); assert.match(verify, /npm test/); assert.match(verify, /smoke:pi-upgrade/);
  assert.match(verify, /prepare-ppt-test-fixtures/); assert.match(verify, /npm run build/);
});
test('两独立发布job在打包前准备与校验自己的PPT运行包，管理端resume不重建', () => {
  const workflow = read('.github/workflows/release.yml');
  const client = workflow.slice(workflow.indexOf('  release-client:'), workflow.indexOf('  release-management:'));
  const management = workflow.slice(workflow.indexOf('  release-management:'));
  assert.ok(client.indexOf('npm run prepare-ppt-runtime') < client.indexOf('electron-builder --win nsis --publish never'));
  assert.ok(client.indexOf('npm run verify-ppt-runtime') > client.indexOf('npm run prepare-ppt-runtime'));
  assert.match(client, /npm run test:ci-upgrade/); assert.match(client, /npm run smoke:pi-upgrade/);
  const preparation = management.slice(management.indexOf('安装 PPT 准备器依赖'), management.indexOf('Create temporary initial administrator credential'));
  assert.match(preparation, /working-directory: client\n\s+run: npm ci --ignore-scripts/);
  assert.match(preparation, /prepare-ppt-runtime\.cjs --management/); assert.match(preparation, /working-directory: management\n\s+run: node scripts\/verify-ppt-runtime\.cjs/);
  assert.equal([...preparation.matchAll(/mode != 'resume'/g)].length, 3);
  assert.ok(management.indexOf('prepare-ppt-runtime.cjs --management') < management.indexOf('npm run dist:win'));
  assert.ok(client.indexOf('verify-packaged-ppt-runtime.cjs') > client.indexOf('electron-builder --win nsis --publish never'));
  assert.ok(management.indexOf('verify-packaged-ppt-runtime.cjs --management') > management.indexOf('npm run dist:win'));
  assert.match(management, /git merge-base --is-ancestor/); assert.match(client, /WORKFLOW_SOURCE_SHA/);
});
test('新样本流程使用固定公开内容，验收脚本没有写死本机随机目录', () => {
  const fixtures = JSON.parse(read('client/scripts/ppt-test-fixtures.json'));
  assert.equal(fixtures.length, 2); for (const fixture of fixtures) assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
  assert.match(fixtures[0].url, /\/f0e14a5621764c605d0c5027bfab172ef1d1eb0f\//);
  assert.match(read('client/scripts/prepare-ppt-test-fixtures.cjs'), /digest\(bytes\) !== fixture.sha256/);
  assert.match(read('client/scripts/ppt-template.test.cjs'), /JATOBID_PPT_TEST_FIXTURES/);
  assert.doesNotMatch(read('client/scripts/ppt-ui-electron-smoke.cjs'), /清理复验-iKbcI9|实际提示词-sDeT4a/);
});
