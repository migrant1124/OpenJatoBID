import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareClientRelease } from './prepare-client-release.mjs';
import {
  buildLatestJson,
  chooseVersionDirectoriesToDelete,
  compareVersions,
  putAndVerifyImmutableFile,
  readAndValidateManifest,
  readAndValidateManagementArtifacts,
} from './publish-r2-release.mjs';

async function createReleaseFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-r2-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  await fs.mkdir(inputDir);
  await fs.writeFile(path.join(inputDir, 'Jato-AI-BID-1.3.2-win-x64.exe'), 'artifact-exe');
  await prepareClientRelease({
    inputDir,
    outputDir,
    version: '1.3.2',
    tagName: 'v1.3.2',
    gitCommitSha: 'c'.repeat(40),
    generatedAt: '2026-07-15T00:00:00.000Z',
  });
  return outputDir;
}

test('compares semantic versions for latest promotion', () => {
  assert.ok(compareVersions('1.3.2', '1.3.1') > 0);
  assert.equal(compareVersions('1.3.2', '1.3.2'), 0);
  assert.throws(() => compareVersions('1.3.2-rc.1', '1.3.2'), /Invalid semantic version/);
});

test('keeps only the two newest version directories and ignores legacy flat objects', () => {
  const result = chooseVersionDirectoriesToDelete([
    'release/latest.json',
    'release/Jato.AI.BID.Setup.1.3.1.exe',
    'release/1.3.1/manifest.json',
    'release/1.3.1/Jato-AI-BID-1.3.1-win-x64.exe',
    'release/1.3.2/manifest.json',
    'release/1.3.3/manifest.json',
  ]);
  assert.deepEqual(result.keptVersions, ['1.3.3', '1.3.2']);
  assert.deepEqual(result.deletedKeys, [
    'release/1.3.1/Jato-AI-BID-1.3.1-win-x64.exe',
    'release/1.3.1/manifest.json',
  ]);
});

test('keeps the new version and previous stable latest after an emergency rollback', () => {
  const result = chooseVersionDirectoriesToDelete([
    'release/1.3.2/manifest.json',
    'release/1.3.3/manifest.json',
    'release/1.3.4/manifest.json',
  ], 2, ['1.3.4', '1.3.2']);
  assert.deepEqual(result.keptVersions, ['1.3.4', '1.3.2']);
  assert.deepEqual(result.deletedKeys, ['release/1.3.3/manifest.json']);
});

test('accepts only the exact EXE publish whitelist and matching SHA-256 values', async (t) => {
  const assetsDir = await createReleaseFixture(t);
  const manifest = await readAndValidateManifest(assetsDir, 'v1.3.2');
  const latest = buildLatestJson(manifest, {
    name: 'v1.3.2',
    body: 'release notes',
    url: 'https://github.example/releases/v1.3.2',
  });
  assert.equal(latest.files.length, 1);
  assert.ok(latest.files.every((file) => file.key.startsWith('release/1.3.2/')));
  assert.ok(latest.files.every((file) => !Object.hasOwn(file, 'url')));

  await fs.writeFile(path.join(assetsDir, 'latest.yml'), 'not allowed');
  await assert.rejects(readAndValidateManifest(assetsDir, 'v1.3.2'), /exactly/);
});

test('accepts only the exact management EXE, ZIP and checksum whitelist', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-r2-management-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exeName = 'Jato-AI-BID-Management-1.4.3-win-x64.exe';
  const zipName = 'Jato-AI-BID-Management-1.4.3-win-x64.zip';
  await fs.writeFile(path.join(root, exeName), 'management-exe');
  await fs.writeFile(path.join(root, zipName), 'management-zip');
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  await fs.writeFile(path.join(root, 'SHA256SUMS.txt'), [
    `${digest('management-exe')}  ${exeName}`,
    `${digest('management-zip')}  ${zipName}`,
    '',
  ].join('\n'));

  const release = await readAndValidateManagementArtifacts(root, '1.4.3');
  assert.deepEqual(release.files.map((file) => file.key), [
    `management/1.4.3/${exeName}`,
    `management/1.4.3/${zipName}`,
    'management/1.4.3/SHA256SUMS.txt',
  ]);

  await fs.writeFile(path.join(root, 'extra.txt'), 'not allowed');
  await assert.rejects(readAndValidateManagementArtifacts(root, '1.4.3'), /exactly/);
});

test('reuses matching immutable objects, rejects conflicts, and uploads missing objects', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-r2-immutable-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'artifact.exe');
  await fs.writeFile(sourcePath, 'immutable-artifact');
  const stat = await fs.stat(sourcePath);
  const sha256 = crypto.createHash('sha256').update('immutable-artifact').digest('hex');
  let uploaded = false;

  await putAndVerifyImmutableFile({}, 'management/1.0.0/artifact.exe', sourcePath, stat.size, sha256, {
    download: async (_config, _key, destinationPath) => {
      await fs.copyFile(sourcePath, destinationPath);
      return true;
    },
    upload: async () => { uploaded = true; },
  });
  assert.equal(uploaded, false);

  await assert.rejects(
    putAndVerifyImmutableFile({}, 'management/1.0.0/artifact.exe', sourcePath, stat.size, sha256, {
      download: async (_config, _key, destinationPath) => {
        await fs.writeFile(destinationPath, 'different-artifact');
        return true;
      },
    }),
    /different content/,
  );

  await putAndVerifyImmutableFile({}, 'management/1.0.0/artifact.exe', sourcePath, stat.size, sha256, {
    download: async () => false,
    upload: async (_config, key, filePath, digest) => {
      uploaded = true;
      assert.equal(key, 'management/1.0.0/artifact.exe');
      assert.equal(filePath, sourcePath);
      assert.equal(digest, sha256);
    },
  });
  assert.equal(uploaded, true);
});
