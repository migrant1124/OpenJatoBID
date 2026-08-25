import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const workflowPath = path.resolve(import.meta.dirname, '..', 'workflows', 'release.yml');

async function readManagementJob() {
  const workflow = (await fs.readFile(workflowPath, 'utf8')).replace(/\r\n/g, '\n');
  const start = workflow.indexOf('  release-management:');
  assert.ok(start >= 0);
  return workflow.slice(start);
}

function extractRunScript(workflow, stepName) {
  const step = workflow.slice(workflow.indexOf(`      - name: ${stepName}`));
  const run = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length).split(/\n(?: {6}- name:| {2}[a-z0-9-]+:)/)[0];
  return run.replace(/^ {10}/gm, '');
}

test('management release is manual, resumable, draft-only and never exposed as a public Artifact', async () => {
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
  const draftIndex = workflow.indexOf('Create or repair management Draft Release');
  const r2Index = workflow.indexOf('Upload and verify immutable management R2 version directory');
  assert.ok(createIndex < buildIndex && buildIndex < removeIndex && removeIndex < draftIndex && draftIndex < r2Index);
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

test('management retries reuse complete Draft assets and rebuild only incomplete Drafts', async () => {
  const workflow = await readManagementJob();
  const stateIndex = workflow.indexOf('Inspect management Draft Release state');
  const rebuildGuardIndex = workflow.indexOf('Refuse management build after R2 upload started');
  const secretIndex = workflow.indexOf('Create temporary initial administrator credential');
  const downloadIndex = workflow.indexOf('Download existing management Draft assets');
  const draftIndex = workflow.indexOf('Create or repair management Draft Release');
  const r2Index = workflow.indexOf('Upload and verify immutable management R2 version directory');
  assert.ok(stateIndex >= 0 && stateIndex < rebuildGuardIndex && rebuildGuardIndex < secretIndex && downloadIndex < draftIndex && draftIndex < r2Index);
  assert.match(workflow, /mode=resume/);
  assert.match(workflow, /mode=rebuild/);
  assert.match(workflow, /mode=build/);
  assert.match(workflow, /gh release download \$env:MANAGEMENT_TAG --dir management\/release-artifact/);
  assert.match(workflow, /steps\.management-state\.outputs\.mode != 'resume'/);
  assert.match(workflow, /steps\.management-state\.outputs\.mode == 'resume'/);
  assert.match(workflow, /release not found/);
  assert.match(workflow, /exit 0/);
});

test('missing management Release exits zero and selects build mode', async (t) => {
  const workflow = await readManagementJob();
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-management-state-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const outputPath = path.join(outputDirectory, 'github-output.txt');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(import.meta.dirname, '..', '..'), encoding: 'utf8' });
  assert.equal(head.status, 0, head.stderr);
  const script = `function gh { $global:LASTEXITCODE = 1; 'release not found' }\n${extractRunScript(workflow, 'Inspect management Draft Release state')}`;
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      MANAGEMENT_TAG: 'management-v99.99.99',
      MANAGEMENT_VERSION: '99.99.99',
      MANAGEMENT_COMMIT_SHA: head.stdout.trim(),
      GITHUB_OUTPUT: outputPath,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await fs.readFile(outputPath, 'utf8'), /mode=build/);
});

test('existing management Draft selects resume only for the exact asset whitelist', async (t) => {
  const workflow = await readManagementJob();
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-management-resume-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const root = path.resolve(import.meta.dirname, '..', '..');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const runState = async (assets, expectedMode) => {
    const outputPath = path.join(outputDirectory, `${expectedMode}.txt`);
    const release = JSON.stringify({ isDraft: true, targetCommitish: head, assets }).replace(/'/g, "''");
    const script = `function gh { $global:LASTEXITCODE = 0; '${release}' }\n${extractRunScript(workflow, 'Inspect management Draft Release state')}`;
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MANAGEMENT_TAG: 'management-v99.99.98',
        MANAGEMENT_VERSION: '99.99.98',
        MANAGEMENT_COMMIT_SHA: head,
        GITHUB_OUTPUT: outputPath,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(await fs.readFile(outputPath, 'utf8'), new RegExp(`mode=${expectedMode}`));
  };
  await runState([
    { name: 'Jato-AI-BID-Management-99.99.98-win-x64.exe' },
    { name: 'Jato-AI-BID-Management-99.99.98-win-x64.zip' },
    { name: 'SHA256SUMS.txt' },
  ], 'resume');
  await runState([{ name: 'SHA256SUMS.txt' }], 'rebuild');
});

test('management Draft inspection rejects public, target, tag and GitHub query conflicts', async (t) => {
  const workflow = await readManagementJob();
  const root = path.resolve(import.meta.dirname, '..', '..');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-management-conflict-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const runRejectedState = (setup, expectedError) => {
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', `${setup}\n${extractRunScript(workflow, 'Inspect management Draft Release state')}`], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MANAGEMENT_TAG: 'management-v99.99.97',
        MANAGEMENT_VERSION: '99.99.97',
        MANAGEMENT_COMMIT_SHA: head,
        GITHUB_OUTPUT: path.join(outputDirectory, 'github-output.txt'),
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, expectedError);
  };
  const json = (value) => JSON.stringify(value).replace(/'/g, "''");
  runRejectedState(`function gh { $global:LASTEXITCODE = 0; '${json({ isDraft: false, targetCommitish: head, assets: [] })}' }`, /already public/);
  runRejectedState(`function gh { $global:LASTEXITCODE = 0; '${json({ isDraft: true, targetCommitish: 'f'.repeat(40), assets: [] })}' }`, /targets/);
  runRejectedState([
    `function gh { $global:LASTEXITCODE = 0; '${json({ isDraft: true, targetCommitish: head, assets: [] })}' }`,
    "function git { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$GitArgs); if ($GitArgs[0] -ceq 'show-ref') { $global:LASTEXITCODE = 0 } else { $global:LASTEXITCODE = 0; 'ffffffffffffffffffffffffffffffffffffffff' } }",
  ].join('\n'), /does not match/);
  runRejectedState("function gh { $global:LASTEXITCODE = 1; 'HTTP 500' }", /Unable to inspect/);
});

test('new or incomplete management Draft can build only before any same-version R2 object exists', async () => {
  const workflow = await readManagementJob();
  const root = path.resolve(import.meta.dirname, '..', '..');
  assert.match(workflow, /Refuse management build after R2 upload started[\s\S]+if: \$\{\{ steps\.management-state\.outputs\.mode != 'resume' \}\}/);
  const runGuard = (awsStub) => spawnSync('pwsh', ['-NoProfile', '-Command', `${awsStub}\n${extractRunScript(workflow, 'Refuse management build after R2 upload started')}`], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      R2_ACCOUNT_ID: 'test-account',
      MANAGEMENT_VERSION: '99.99.96',
    },
  });

  const emptyR2 = runGuard("function aws { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$AwsArgs); if ($AwsArgs[1] -ceq 'head-bucket') { $global:LASTEXITCODE = 0; return }; $global:LASTEXITCODE = 254; '404 Not Found' }");
  assert.equal(emptyR2.status, 0, emptyR2.stderr || emptyR2.stdout);

  const existingR2 = runGuard("function aws { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$AwsArgs); if ($AwsArgs[1] -ceq 'head-bucket') { $global:LASTEXITCODE = 0; return }; if (($AwsArgs -join ' ') -match 'SHA256SUMS\\.txt') { $global:LASTEXITCODE = 0; '{}' } else { $global:LASTEXITCODE = 254; '404 Not Found' } }");
  assert.notEqual(existingR2.status, 0);
  assert.match(existingR2.stderr || existingR2.stdout, /Refusing to build management release/);

  const missingBucket = runGuard("function aws { $global:LASTEXITCODE = 254; 'NoSuchBucket 404 Not Found' }");
  assert.notEqual(missingBucket.status, 0);
  assert.match(missingBucket.stderr || missingBucket.stdout, /Unable to inspect R2 bucket/);
});

test('management inputs are never interpolated directly into run scripts', async () => {
  const workflow = await readManagementJob();
  for (const step of workflow.split('\n      - name: ')) {
    const runIndex = step.indexOf('\n        run:');
    if (runIndex >= 0) assert.doesNotMatch(step.slice(runIndex), /\$\{\{\s*inputs\./);
  }
});
