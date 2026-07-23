import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function getClientArtifactDefinitions(version) {
  if (!VERSION_PATTERN.test(String(version || ''))) {
    throw new Error(`Invalid release version: ${version || '(empty)'}`);
  }
  const baseName = `Jato-AI-BID-${version}-win-x64`;
  return [
    { name: `${baseName}.exe`, type: 'installer', format: 'exe' },
  ];
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function prepareClientRelease({
  inputDir,
  outputDir,
  version,
  tagName,
  gitCommitSha,
  generatedAt = new Date().toISOString(),
}) {
  const definitions = getClientArtifactDefinitions(version);
  if (tagName !== `v${version}`) {
    throw new Error(`Tag ${tagName || '(empty)'} does not match version ${version}.`);
  }
  if (!SHA_PATTERN.test(String(gitCommitSha || ''))) {
    throw new Error('GIT_COMMIT_SHA must be the 40-character checkout commit SHA.');
  }

  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.mkdir(outputDir, { recursive: true });

  const files = [];
  for (const definition of definitions) {
    const sourcePath = path.join(inputDir, definition.name);
    const destinationPath = path.join(outputDir, definition.name);
    const stat = await fsp.stat(sourcePath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) {
      throw new Error(`Required client release artifact is missing or empty: ${definition.name}`);
    }
    await fsp.copyFile(sourcePath, destinationPath);
    files.push({
      ...definition,
      key: `release/${version}/${definition.name}`,
      platform: 'win32',
      arch: 'x64',
      size: stat.size,
      sha256: await sha256File(destinationPath),
    });
  }

  const manifest = {
    version,
    tagName,
    gitCommitSha: gitCommitSha.toLowerCase(),
    generatedAt,
    files,
  };
  await fsp.writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

async function main() {
  const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
  const version = String(process.env.RELEASE_VERSION || '').trim();
  const outputDir = path.resolve(
    repositoryRoot,
    process.env.CLIENT_RELEASE_OUTPUT_DIR || 'client/release-publish',
  );
  const manifest = await prepareClientRelease({
    inputDir: path.resolve(repositoryRoot, process.env.CLIENT_RELEASE_INPUT_DIR || 'client/release'),
    outputDir,
    version,
    tagName: String(process.env.TAG_NAME || '').trim(),
    gitCommitSha: String(process.env.GIT_COMMIT_SHA || '').trim(),
  });
  console.log(`Prepared ${manifest.files.length} client artifacts and manifest.json in ${outputDir}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
