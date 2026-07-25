import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseForbiddenTerms, validateReleaseNotesCompliance } from './create-release-notes.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');

async function readWorkflow() {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  return workflow.replace(/\r\n/g, '\n');
}

test('client release is one manual self-hosted Windows job', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(workflow, /tag_name:/);
  assert.match(workflow, /confirm_release:/);
  assert.match(workflow, /^  release-client:/m);
  assert.equal([...workflow.matchAll(/^  [a-z0-9-]+:\n\s+name:/gm)].length, 1);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, X64, jatobid-release\]/);
  assert.match(workflow, /timeout-minutes: 180/);
  assert.match(workflow, /shell: pwsh/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /group: openjatobid-client-release/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('client release rejects hosted runners, Actions artifacts, and npm cache', async () => {
  const workflow = await readWorkflow();
  assert.doesNotMatch(workflow, /windows-latest|ubuntu-latest/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact|actions\/download-artifact/);
  assert.doesNotMatch(workflow, /cache:\s*npm|cache-dependency-path/);
  assert.doesNotMatch(workflow, /\bneeds:/);
  assert.doesNotMatch(workflow, /\bsudo\b|\bapt\b|awscli-exe-linux|unzip -q|shell: bash/);
});

test('client release validates stable tag, exact confirmation, and tag commit before uploads', async () => {
  const workflow = await readWorkflow();
  const validateIndex = workflow.indexOf('Validate release tag, confirmation, and checkout commit');
  const draftIndex = workflow.indexOf('Create or refresh Draft Release with exact assets');
  const r2Index = workflow.indexOf('Upload and verify R2 version directory');
  assert.ok(validateIndex >= 0 && validateIndex < draftIndex && validateIndex < r2Index);
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /PUBLISH \$env:TAG_NAME/);
  assert.match(workflow, /git rev-list -n 1 \$env:TAG_NAME/);
});

test('manual release attestation and manifest use the validated tag commit SHA', async () => {
  const workflow = await readWorkflow();
  const script = await fs.readFile(path.join(root, 'client/scripts/generate-build-attestation.cjs'), 'utf8');
  assert.match(workflow, /Generate signed build attestation[\s\S]+GIT_COMMIT_SHA: \$\{\{ steps\.release\.outputs\.commit_sha \}\}/);
  assert.match(workflow, /build-attestation\.json[\s\S]+gitCommitSha[\s\S]+GIT_COMMIT_SHA/);
  assert.match(script, /process\.env\.GIT_COMMIT_SHA/);
});

test('client release publishes only the normalized EXE and manifest whitelist', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /Jato-AI-BID-\$env:RELEASE_VERSION-win-x64\.exe/);
  assert.match(workflow, /client\/release-publish\/manifest\.json/);
  assert.doesNotMatch(workflow, /Jato-AI-BID-[^\n]+\.msi|Jato-AI-BID-[^\n]+\.zip/);
  assert.doesNotMatch(workflow, /electron-builder --win msi|electron-builder --win nsis zip/);
  assert.doesNotMatch(workflow, /latest\*?\.yml|\.blockmap/);
});

test('R2 and Worker release gates keep the required order and rollback behavior', async () => {
  const workflow = await readWorkflow();
  const draftIndex = workflow.indexOf('Create or refresh Draft Release with exact assets');
  const r2PublishIndex = workflow.indexOf('Upload and verify R2 version directory');
  const promoteIndex = workflow.indexOf('Promote R2 latest.json');
  const workerIndex = workflow.indexOf('Verify Worker latest and full EXE download');
  const publishIndex = workflow.indexOf('Publish the verified GitHub Release');
  const rollbackIndex = workflow.indexOf('Roll back latest.json after verification or finalization failure');
  const cleanupIndex = workflow.indexOf('Remove R2 versions outside the current and previous stable pair');
  const transientCleanupIndex = workflow.indexOf('Clean transient release files');
  assert.ok(
    draftIndex < r2PublishIndex
    && r2PublishIndex < promoteIndex
    && promoteIndex < workerIndex
    && workerIndex < publishIndex
    && publishIndex < rollbackIndex
    && rollbackIndex < cleanupIndex
    && cleanupIndex < transientCleanupIndex,
  );
  assert.match(workflow, /if: \$\{\{ failure\(\) && hashFiles\('\.release-state\/previous-latest\.json'\) != '' \}\}/);
  assert.match(workflow, /Remove R2 versions outside the current and previous stable pair[\s\S]+if: \$\{\{ success\(\) \}\}/);
  assert.match(workflow, /Clean transient release files[\s\S]+if: \$\{\{ always\(\) \}\}/);
});

test('R2 publication uses private jatoaibid bucket and configured variables', async () => {
  const workflow = await readWorkflow();
  const publishScript = await fs.readFile(path.join(root, '.github/scripts/publish-r2-release.mjs'), 'utf8');
  const combined = `${workflow}\n${publishScript}`;
  assert.match(workflow, /R2_ACCOUNT_ID: \$\{\{ vars\.R2_ACCOUNT_ID \}\}/);
  assert.match(workflow, /UPDATE_WORKER_BASE_URL: \$\{\{ vars\.UPDATE_WORKER_BASE_URL \}\}/);
  assert.match(publishScript, /const R2_BUCKET = 'jatoaibid'/);
  assert.doesNotMatch(combined, /CLOUDFLARE_API_TOKEN|JATOBID_BUILD_CLOUDFLARE_API_TOKEN|R2_PUBLIC_BASE_URL|openbidkit|@aws-sdk/);
});

test('obsolete Gitee, public R2, Pages, Containers, and backend deployment paths are absent', async () => {
  const scripts = await fs.readdir(path.join(root, '.github/scripts'));
  assert.equal(scripts.includes('sync-gitee-release.mjs'), false);
  const workflow = await readWorkflow();
  assert.doesNotMatch(workflow, /GITEE|R2_PUBLIC_BASE_URL|Cloudflare Pages|Cloudflare Containers|wrangler deploy|pages deploy|containers/);
});

test('release notes compliance requires secret terms and hides forbidden values', () => {
  assert.deepEqual(parseForbiddenTerms('["alpha","beta"]'), ['alpha', 'beta']);
  assert.deepEqual(parseForbiddenTerms('alpha,beta\n gamma'), ['alpha', 'beta', 'gamma']);
  assert.throws(
    () => validateReleaseNotesCompliance('## 更新内容\n- alpha change', 'alpha,beta'),
    /forbidden term list item 1/,
  );
  assert.doesNotThrow(() => validateReleaseNotesCompliance('## 更新内容\n- normal change', 'alpha,beta'));
  assert.throws(
    () => validateReleaseNotesCompliance('## 更新内容\n- normal change', ''),
    /JATOBID_RELEASE_FORBIDDEN_TERMS is required/,
  );
  assert.throws(
    () => validateReleaseNotesCompliance('## 更新内容\n- token Bearer abcdefghijklmnop', 'alpha'),
    /Bearer token/,
  );
  assert.throws(
    () => validateReleaseNotesCompliance('## 更新内容\n- debug 127.0.0.1:5173', 'alpha'),
    /debug address/,
  );
});
