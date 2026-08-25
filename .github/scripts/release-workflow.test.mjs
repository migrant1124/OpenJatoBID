import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createConciseCommitSummaries,
  createRemoteNotice,
  filterReleaseLog,
  parseForbiddenTerms,
  selectPreviousStableTag,
  validateReleaseNotesCompliance,
} from './create-release-notes.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');

async function readWorkflow() {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  return workflow.replace(/\r\n/g, '\n');
}

async function readClientJob() {
  const workflow = await readWorkflow();
  return workflow.slice(workflow.indexOf('  release-client:'), workflow.indexOf('  release-management:'));
}

function extractRunScript(workflow, stepName) {
  const step = workflow.slice(workflow.indexOf(`      - name: ${stepName}`));
  const run = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length).split(/\n(?: {6}- name:| {2}[a-z0-9-]+:)/)[0];
  return run.replace(/^ {10}/gm, '');
}

async function readNoticeWorkflow() {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/release-notice.yml'), 'utf8');
  return workflow.replace(/\r\n/g, '\n');
}

test('client and management share one manual GitHub-hosted Windows workflow with recovery preflight', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(workflow, /tag_name:/);
  assert.match(workflow, /confirm_release:/);
  assert.match(workflow, /management_version:/);
  assert.match(workflow, /management_ref:/);
  assert.match(workflow, /^  release-preflight:/m);
  assert.match(workflow, /^  release-client:/m);
  assert.match(workflow, /^  release-management:/m);
  assert.equal([...workflow.matchAll(/^  [a-z0-9-]+:\n\s+name:/gm)].length, 3);
  assert.equal([...workflow.matchAll(/^    runs-on: windows-2022$/gm)].length, 3);
  assert.doesNotMatch(workflow, /self-hosted|\[self-hosted, Windows, X64, jatobid-release\]/);
  assert.match(workflow, /timeout-minutes: 180/);
  assert.match(workflow, /shell: pwsh/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /group: openjatobid-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /CSC_LINK: ''/);
  assert.match(workflow, /WIN_CSC_LINK: ''/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);
});

test('client and management wait only for preflight and avoid cross-job artifact transfer', async () => {
  const workflow = await readWorkflow();
  assert.doesNotMatch(workflow, /windows-latest|ubuntu-latest|actions\/(?:upload|download)-artifact/);
  assert.equal([...workflow.matchAll(/^    needs: release-preflight$/gm)].length, 2);
  assert.doesNotMatch(workflow, /\bsudo\b|\bapt\b|awscli-exe-linux|unzip -q/);
});

test('published stable client releases are verified and skipped before release jobs start', async () => {
  const workflow = await readWorkflow();
  const preflight = workflow.slice(workflow.indexOf('  release-preflight:'), workflow.indexOf('  release-client:'));
  const client = await readClientJob();
  assert.match(preflight, /gh release view \$env:TAG_NAME --json isDraft,isPrerelease,tagName,assets/);
  assert.match(preflight, /release not found/);
  assert.match(preflight, /client_mode=skip/);
  assert.match(preflight, /client_mode=release/);
  assert.match(preflight, /exit 0/);
  assert.match(client, /needs: release-preflight/);
  assert.match(client, /if: \$\{\{ needs\.release-preflight\.outputs\.client_mode == 'release' \}\}/);
});

test('published client preflight exits zero and emits skip', async (t) => {
  const workflow = await readWorkflow();
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-client-preflight-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const outputPath = path.join(outputDirectory, 'github-output.txt');
  const release = JSON.stringify({
    isDraft: false,
    isPrerelease: false,
    tagName: 'v1.7.2',
    assets: [{ name: 'Jato-AI-BID-1.7.2-win-x64.exe' }, { name: 'manifest.json' }],
  }).replace(/'/g, "''");
  const script = `function gh { $global:LASTEXITCODE = 0; '${release}' }\n${extractRunScript(workflow, 'Inspect published client Release')}`;
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TAG_NAME: 'v1.7.2',
      CONFIRM_RELEASE: 'PUBLISH v1.7.2',
      GITHUB_OUTPUT: outputPath,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(await fs.readFile(outputPath, 'utf8'), /client_mode=skip/);
});

test('client release references existing Agent tool scripts', async () => {
  const workflow = await readClientJob();
  assert.doesNotMatch(workflow, /OpenCode|opencode|OPENCODE_VERSION/);
  const scriptPaths = [...workflow.matchAll(/run: node (scripts\/[\w.-]+\.cjs)[^\n]*/g)]
    .map((match) => match[1]);
  assert.ok(scriptPaths.length > 0);
  for (const scriptPath of scriptPaths) {
    await fs.access(path.join(root, 'client', scriptPath));
  }
});

test('client release validates stable tag, exact confirmation, and tag commit before uploads', async () => {
  const workflow = await readClientJob();
  const validateIndex = workflow.indexOf('Validate release tag, confirmation, and checkout commit');
  const draftIndex = workflow.indexOf('Create or refresh Draft Release with exact assets');
  const r2Index = workflow.indexOf('Upload and verify R2 version directory');
  assert.ok(validateIndex >= 0 && validateIndex < draftIndex && validateIndex < r2Index);
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /PUBLISH \$env:TAG_NAME/);
  assert.match(workflow, /WORKFLOW_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /workflow source commit \$env:WORKFLOW_SOURCE_SHA does not match release tag commit \$tagCommitSha/);
  assert.match(workflow, /git rev-list -n 1 \$env:TAG_NAME/);
});

test('manual release attestation and manifest use the validated tag commit SHA', async () => {
  const workflow = await readClientJob();
  const script = await fs.readFile(path.join(root, 'client/scripts/generate-build-attestation.cjs'), 'utf8');
  assert.match(workflow, /Generate signed build attestation[\s\S]+GIT_COMMIT_SHA: \$\{\{ steps\.release\.outputs\.commit_sha \}\}/);
  assert.match(workflow, /build-attestation\.json[\s\S]+gitCommitSha[\s\S]+GIT_COMMIT_SHA/);
  assert.match(script, /process\.env\.GIT_COMMIT_SHA/);
});

test('client release publishes only the normalized EXE and manifest whitelist', async () => {
  const workflow = await readClientJob();
  assert.match(workflow, /Jato-AI-BID-\$env:RELEASE_VERSION-win-x64\.exe/);
  assert.match(workflow, /client\/release-publish\/manifest\.json/);
  assert.doesNotMatch(workflow, /Jato-AI-BID-[^\n]+\.msi|Jato-AI-BID-[^\n]+\.zip/);
  assert.doesNotMatch(workflow, /electron-builder --win msi|electron-builder --win nsis zip/);
  assert.doesNotMatch(workflow, /latest\*?\.yml|\.blockmap/);
});

test('Worker test license is preflighted before dependencies and release side effects', async () => {
  const workflow = await readClientJob();
  const preflightIndex = workflow.indexOf('Preflight Worker test license');
  const installIndex = workflow.indexOf('Install client dependencies');
  const draftIndex = workflow.indexOf('Create or refresh Draft Release with exact assets');
  assert.ok(preflightIndex >= 0 && preflightIndex < installIndex && preflightIndex < draftIndex);
  assert.match(workflow, /WORKER_RELEASE_VERIFY_MODE: license/);
  assert.match(workflow, /Preflight Worker test license[\s\S]+JATOBID_UPDATE_TEST_LICENSE_JSON/);
});

test('R2 and Worker release gates keep the required order and rollback behavior', async () => {
  const workflow = await readClientJob();
  const draftIndex = workflow.indexOf('Create or refresh Draft Release with exact assets');
  const r2PublishIndex = workflow.indexOf('Upload and verify R2 version directory');
  const promoteIndex = workflow.indexOf('Promote R2 latest.json');
  const workerIndex = workflow.indexOf('Verify Worker latest and full EXE download');
  const publishIndex = workflow.indexOf('Publish the verified GitHub Release');
  const rollbackIndex = workflow.indexOf('Roll back latest.json after verification or finalization failure');
  const cleanupIndex = workflow.indexOf('Remove R2 versions outside the current and previous stable pair');
  const noticeCheckoutIndex = workflow.indexOf('Checkout main for release notice');
  const noticePublishIndex = workflow.indexOf('Publish release notice to main');
  const transientCleanupIndex = workflow.indexOf('Clean transient release files');
  assert.ok(
    draftIndex < r2PublishIndex
    && r2PublishIndex < promoteIndex
    && promoteIndex < workerIndex
    && workerIndex < publishIndex
    && publishIndex < rollbackIndex
    && rollbackIndex < cleanupIndex
    && cleanupIndex < noticeCheckoutIndex
    && noticeCheckoutIndex < noticePublishIndex
    && noticePublishIndex < transientCleanupIndex
    && cleanupIndex < transientCleanupIndex,
  );
  assert.match(workflow, /if: \$\{\{ failure\(\) && hashFiles\('\.release-state\/previous-latest\.json'\) != '' \}\}/);
  assert.match(workflow, /Remove R2 versions outside the current and previous stable pair[\s\S]+if: \$\{\{ success\(\) \}\}/);
  assert.match(workflow, /Clean transient release files[\s\S]+if: \$\{\{ always\(\) \}\}/);
});

test('release notice uses concise commit subjects and is published to main after release success', async () => {
  const workflow = await readWorkflow();
  const summaries = createConciseCommitSummaries([
    '- feat(prompt): 新增提示词库 (abc1234)',
    '- fix: 修复公告读取 (def5678)',
    '- 功能：新增提示词库 (fedcba9)',
    '- chore: update release notice for v1.7.1 (0123456)',
  ].join('\n'));
  assert.deepEqual(summaries, ['新增提示词库', '修复公告读取']);
  assert.equal(filterReleaseLog([
    '- feat: 新增提示词库 (abc1234)',
    '- chore: update release notice for v1.7.1 (0123456)',
  ].join('\n')), '- feat: 新增提示词库 (abc1234)');
  assert.equal(selectPreviousStableTag('preview-2\nv1.7.1\nv1.7.0'), 'v1.7.1');
  assert.equal(selectPreviousStableTag('preview-2\nbuild-123'), '');

  const notice = createRemoteNotice({
    tagName: 'v1.7.2',
    logOutput: '- feat: 新增提示词库 (abc1234)',
    tagCommitTime: '2026-08-25T12:43:48+08:00',
  });
  assert.equal(notice.code, 0);
  assert.equal(notice.notice.id, 'release-v1.7.2');
  assert.equal(notice.notice.projectName, 'yibiao-client');
  assert.equal(notice.notice.content, '## 更新内容\n\n- 新增提示词库\n');
  assert.equal(notice.notice.updatedAt, '2026-08-25 12:43:48');

  assert.match(workflow, /Checkout main for release notice[\s\S]+ref: main[\s\S]+path: \.release-notice-main/);
  assert.match(workflow, /Publish release notice to main[\s\S]+git push origin HEAD:main/);
});

test('published release notices have a manual repair workflow', async () => {
  const workflow = await readNoticeWorkflow();
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /confirm_notice:/);
  assert.match(workflow, /UPDATE NOTICE \$env:TAG_NAME/);
  assert.match(workflow, /Checkout main with full history[\s\S]+ref: main/);
  assert.match(workflow, /gh release view \$env:TAG_NAME --json isDraft,isPrerelease/);
  assert.match(workflow, /Create release notice from the selected tag[\s\S]+create-release-notes\.mjs/);
  assert.match(workflow, /Publish release notice to main[\s\S]+git push origin HEAD:main/);
  assert.match(workflow, /runs-on: windows-2022/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.doesNotMatch(workflow, /gh release create|gh release edit|R2_RELEASE_ACTION/);
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
