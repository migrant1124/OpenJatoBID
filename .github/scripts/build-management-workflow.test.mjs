import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.resolve(import.meta.dirname, '..', 'workflows', 'build-management.yml');

test('management build is manual, independent, internal and retained for thirty days', async () => {
  const workflow = await fs.readFile(workflowPath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /push:|pull_request:/);
  assert.match(workflow, /MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /gh release|publish-r2|R2_ACCESS_KEY_ID/);
});

test('temporary credentials are removed before the exact Artifact is uploaded', async () => {
  const workflow = await fs.readFile(workflowPath, 'utf8');
  const createIndex = workflow.indexOf('Create temporary initial administrator credential');
  const buildIndex = workflow.indexOf('Build and verify Windows management application');
  const removeIndex = workflow.indexOf('Remove temporary initial administrator credential');
  const uploadIndex = workflow.indexOf('Upload management Artifact for internal distribution');
  assert.ok(createIndex < buildIndex && buildIndex < removeIndex && removeIndex < uploadIndex);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /management\/release-artifact\/\*/);
});

test('requested management ref must be reachable from origin main before any secret is injected', async () => {
  const workflow = await fs.readFile(workflowPath, 'utf8');
  const trustIndex = workflow.indexOf('Validate requested ref is trusted main history');
  const secretIndex = workflow.indexOf('Create temporary initial administrator credential');
  assert.ok(trustIndex >= 0 && trustIndex < secretIndex);
  assert.match(workflow, /git merge-base --is-ancestor "\$REQUESTED_SHA" "\$MAIN_SHA"/);
  assert.match(workflow, /fetch-depth: 0/);
});

test('management version accepts an optional v prefix and reuses the normalized value', async () => {
  const workflow = await fs.readFile(workflowPath, 'utf8');
  assert.ok(workflow.includes('MANAGEMENT_VERSION="${MANAGEMENT_VERSION#v}"'));
  assert.ok(workflow.includes('^\u005b0-9\u005d+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$'));
  assert.ok(workflow.includes('echo "version=$MANAGEMENT_VERSION" >> "$GITHUB_OUTPUT"'));
  assert.ok(workflow.includes('MANAGEMENT_VERSION: ${{ steps.validate-version.outputs.version }}'));
  assert.match(workflow, /name: Jato-AI-BID-Management-\$\{\{ steps\.validate-version\.outputs\.version \}\}-win-x64/);
});
