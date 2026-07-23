import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getClientArtifactDefinitions, prepareClientRelease } from './prepare-client-release.mjs';

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-client-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  await fs.mkdir(inputDir);
  for (const [index, artifact] of getClientArtifactDefinitions('1.3.2').entries()) {
    await fs.writeFile(path.join(inputDir, artifact.name), `artifact-${index}`);
  }
  return { inputDir, outputDir };
}

test('stages only the normalized Windows EXE and a SHA-256 manifest', async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(path.join(fixture.inputDir, 'latest.yml'), 'not published');
  const manifest = await prepareClientRelease({
    ...fixture,
    version: '1.3.2',
    tagName: 'v1.3.2',
    gitCommitSha: 'a'.repeat(40),
    generatedAt: '2026-07-15T00:00:00.000Z',
  });

  assert.deepEqual((await fs.readdir(fixture.outputDir)).sort(), [
    'Jato-AI-BID-1.3.2-win-x64.exe',
    'manifest.json',
  ]);
  assert.equal(manifest.files.length, 1);
  assert.deepEqual(manifest.files.map((file) => file.format), ['exe']);
  assert.ok(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
  assert.ok(manifest.files.every((file) => file.key.startsWith('release/1.3.2/')));
  assert.equal(manifest.gitCommitSha, 'a'.repeat(40));
});

test('rejects a missing required artifact before publishing a manifest', async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.inputDir, 'Jato-AI-BID-1.3.2-win-x64.exe'));
  await assert.rejects(
    prepareClientRelease({
      ...fixture,
      version: '1.3.2',
      tagName: 'v1.3.2',
      gitCommitSha: 'b'.repeat(40),
    }),
    /missing or empty/,
  );
});

test('rejects prerelease client versions in the stable update channel', () => {
  assert.throws(() => getClientArtifactDefinitions('1.3.2-rc.1'), /Invalid release version/);
});
