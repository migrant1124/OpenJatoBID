import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

test('client release stays Draft until R2 and Worker verification finish', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /group: openjatobid-client-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /gh release create[^\n]+--draft/);
  assert.match(workflow, /JATOBID_UPDATE_TEST_LICENSE_JSON/);
  assert.match(workflow, /R2_RELEASE_ACTION: rollback/);

  const draftIndex = workflow.indexOf('Create or refresh Draft Release');
  const r2Index = workflow.indexOf('Upload and verify R2 version directory');
  const workerIndex = workflow.indexOf('Verify Worker latest and full EXE download');
  const publishIndex = workflow.indexOf('Publish the verified GitHub Release');
  const rollbackIndex = workflow.indexOf('Roll back latest.json after verification or finalization failure');
  const cleanupIndex = workflow.indexOf('Remove R2 versions outside the current and previous stable pair');
  assert.ok(
    draftIndex < r2Index
    && r2Index < workerIndex
    && workerIndex < publishIndex
    && publishIndex < rollbackIndex
    && rollbackIndex < cleanupIndex,
  );
  assert.match(workflow, /if: \$\{\{ failure\(\) && hashFiles\('\.release-state\/previous-latest\.json'\) != '' \}\}/);
  assert.match(workflow, /Remove R2 versions outside the current and previous stable pair[\s\S]+if: \$\{\{ success\(\) \}\}/);
});

test('manual release attestation and manifest use the validated tag commit SHA', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const script = await fs.readFile(path.join(root, 'client/scripts/generate-build-attestation.cjs'), 'utf8');
  assert.match(workflow, /Generate signed build attestation[\s\S]+GIT_COMMIT_SHA: \$\{\{ needs\.validate-release\.outputs\.commit_sha \}\}/);
  assert.match(workflow, /build-attestation\.json[\s\S]+gitCommitSha[\s\S]+GIT_COMMIT_SHA/);
  assert.match(script, /process\.env\.GIT_COMMIT_SHA/);
});

test('client release accepts stable semantic-version tags only', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.doesNotMatch(workflow, /\(-\[0-9A-Za-z\.\-\]\+\)\?/);
});

test('client release publishes only the normalized four-file whitelist', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /Jato-AI-BID-\$\{RELEASE_VERSION\}-win-x64\.exe/);
  assert.match(workflow, /Jato-AI-BID-\$\{RELEASE_VERSION\}-win-x64\.msi/);
  assert.match(workflow, /Jato-AI-BID-\$\{RELEASE_VERSION\}-win-x64\.zip/);
  assert.doesNotMatch(workflow, /latest\*?\.yml|\.blockmap/);
});

test('R2 publication is fixed to AWS CLI and the private jatoaibid bucket', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const publishScript = await fs.readFile(path.join(root, '.github/scripts/publish-r2-release.mjs'), 'utf8');
  const combined = `${workflow}\n${publishScript}`;
  assert.match(workflow, /Install AWS CLI/);
  assert.match(workflow, /awscli-exe-linux-x86_64\.zip/);
  assert.match(workflow, /grep '\^aws-cli\/2\\\.'/);
  assert.doesNotMatch(workflow, /pip install[^\n]*awscli/);
  assert.match(publishScript, /const R2_BUCKET = 'jatoaibid'/);
  assert.doesNotMatch(combined, /CLOUDFLARE_API_TOKEN|JATOBID_BUILD_CLOUDFLARE_API_TOKEN|R2_PUBLIC_BASE_URL|openbidkit|@aws-sdk/);
});

test('obsolete Gitee and public R2 release paths are absent', async () => {
  const scripts = await fs.readdir(path.join(root, '.github/scripts'));
  assert.equal(scripts.includes('sync-gitee-release.mjs'), false);
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.doesNotMatch(workflow, /GITEE|R2_PUBLIC_BASE_URL/);
});
