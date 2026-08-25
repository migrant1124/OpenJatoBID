import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.resolve(import.meta.dirname, '..', 'workflows', 'release.yml');

async function readManagementJob() {
  const workflow = (await fs.readFile(workflowPath, 'utf8')).replace(/\r\n/g, '\n');
  const start = workflow.indexOf('  release-management:');
  assert.ok(start >= 0);
  return workflow.slice(start);
}

test('management release is manual, independent, draft-only and never exposed as a public Artifact', async () => {
  const workflow = await readManagementJob();
  assert.match(await fs.readFile(workflowPath, 'utf8'), /workflow_dispatch:/);
  assert.match(workflow, /MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact|retention-days:/);
  assert.match(workflow, /gh release create \$env:MANAGEMENT_TAG[\s\S]+--draft[\s\S]+--target \$env:MANAGEMENT_COMMIT_SHA/);
  assert.match(workflow, /R2_RELEASE_ACTION: publish-management/);
  assert.doesNotMatch(workflow, /gh release edit|--draft=false|Promote R2 latest\.json|R2_RELEASE_ACTION: promote/);
});

test('temporary credentials are created by a dedicated script and removed before upload', async () => {
  const workflow = await readManagementJob();
  const createIndex = workflow.indexOf('Create temporary initial administrator credential');
  const buildIndex = workflow.indexOf('Build and verify Windows management application');
  const removeIndex = workflow.indexOf('Remove temporary initial administrator credential');
  const r2Index = workflow.indexOf('Upload and verify immutable management R2 version directory');
  const draftIndex = workflow.indexOf('Create management Draft Release');
  assert.ok(createIndex < buildIndex && buildIndex < removeIndex && removeIndex < r2Index && r2Index < draftIndex);
  assert.match(workflow, /run: node scripts\/write-initial-admin-credential\.cjs/);
  assert.doesNotMatch(workflow, /node -e .*MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /RELEASE_ASSETS_DIR: management\/release-artifact/);
});

test('requested management ref must be reachable from origin main before any secret is injected', async () => {
  const workflow = await readManagementJob();
  const trustIndex = workflow.indexOf('Validate requested ref is trusted main history');
  const secretIndex = workflow.indexOf('Create temporary initial administrator credential');
  assert.ok(trustIndex >= 0 && trustIndex < secretIndex);
  assert.match(workflow, /git merge-base --is-ancestor "\$REQUESTED_SHA" "\$MAIN_SHA"/);
  assert.match(workflow, /fetch-depth: 0/);
});

test('management version accepts an optional v prefix and reuses the normalized value', async () => {
  const workflow = await readManagementJob();
  assert.ok(workflow.includes('MANAGEMENT_VERSION="${MANAGEMENT_VERSION#v}"'));
  assert.ok(workflow.includes('^\u005b0-9\u005d+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$'));
  assert.ok(workflow.includes('echo "version=$MANAGEMENT_VERSION" >> "$GITHUB_OUTPUT"'));
  assert.ok(workflow.includes('MANAGEMENT_VERSION: ${{ steps.validate-version.outputs.version }}'));
  assert.match(workflow, /management-v\$MANAGEMENT_VERSION/);
  assert.match(workflow, /Jato-AI-BID-Management-\$env:MANAGEMENT_VERSION-win-x64\.exe/);
});

test('management inputs are never interpolated directly into run scripts', async () => {
  const workflow = await readManagementJob();
  for (const step of workflow.split('\n      - name: ')) {
    const runIndex = step.indexOf('\n        run:');
    if (runIndex >= 0) assert.doesNotMatch(step.slice(runIndex), /\$\{\{\s*inputs\./);
  }
});
