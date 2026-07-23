import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const R2_BUCKET = 'jatoaibid';
const RELEASE_PREFIX = 'release';
const KEEP_VERSION_COUNT = 2;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function contentTypeFromFileName(fileName) {
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8';
  if (fileName.endsWith('.zip')) return 'application/zip';
  if (fileName.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  return 'application/octet-stream';
}

function runCommand(file, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${file} ${args.join(' ')} failed with exit code ${code}: ${stderr || stdout}`));
    });
  });
}

function createAwsCliEnv({ accessKeyId, secretAccessKey }) {
  return {
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_DEFAULT_REGION: 'auto',
    AWS_EC2_METADATA_DISABLED: 'true',
  };
}

function createEndpointUrl(accountId) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function awsCommandArgs(config, command) {
  return [
    's3api',
    command,
    '--endpoint-url', createEndpointUrl(config.accountId),
    '--no-cli-pager',
  ];
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function parseVersion(value) {
  if (!VERSION_PATTERN.test(String(value || ''))) return null;
  const [major, minor, patch] = String(value).split('.').map(Number);
  return { major, minor, patch };
}

export function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) throw new Error(`Invalid semantic version comparison: ${a}, ${b}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (parsedA[key] !== parsedB[key]) return parsedA[key] - parsedB[key];
  }
  return 0;
}

function expectedArtifactNames(version) {
  return [`Jato-AI-BID-${version}-win-x64.exe`];
}

export async function readAndValidateManifest(assetsDir, tagName) {
  const entries = (await fsp.readdir(assetsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const manifest = JSON.parse(await fsp.readFile(path.join(assetsDir, 'manifest.json'), 'utf8'));
  const version = String(tagName || '').replace(/^v/, '');
  const expectedNames = expectedArtifactNames(version);
  const expectedPublishedFiles = [...expectedNames, 'manifest.json'].sort();
  if (!VERSION_PATTERN.test(version) || manifest.version !== version || manifest.tagName !== tagName) {
    throw new Error('manifest version or tag does not match the release tag.');
  }
  if (!/^[0-9a-f]{40}$/i.test(String(manifest.gitCommitSha || '')) || !Number.isFinite(Date.parse(manifest.generatedAt))) {
    throw new Error('manifest must contain a valid checkout commit SHA and generated timestamp.');
  }
  if (entries.length !== expectedPublishedFiles.length || entries.some((entry, index) => entry !== expectedPublishedFiles[index])) {
    throw new Error(`Release directory must contain exactly: ${expectedPublishedFiles.join(', ')}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1) {
    throw new Error('manifest must contain exactly one client file.');
  }

  for (const name of expectedNames) {
    const file = manifest.files.find((candidate) => candidate?.name === name);
    const format = path.extname(name).slice(1);
    if (
      !file
      || file.key !== `${RELEASE_PREFIX}/${version}/${name}`
      || file.platform !== 'win32'
      || file.arch !== 'x64'
      || file.format !== format
      || !Number.isFinite(Number(file.size))
      || Number(file.size) <= 0
      || !SHA256_PATTERN.test(String(file.sha256 || ''))
    ) {
      throw new Error(`Invalid manifest entry: ${name}`);
    }
    const filePath = path.join(assetsDir, name);
    const stat = await fsp.stat(filePath);
    if (stat.size !== Number(file.size) || await sha256File(filePath) !== file.sha256.toLowerCase()) {
      throw new Error(`Local artifact does not match manifest: ${name}`);
    }
  }
  return manifest;
}

async function putFile(config, key, filePath, sha256) {
  await runCommand('aws', [
    ...awsCommandArgs(config, 'put-object'),
    '--bucket', R2_BUCKET,
    '--key', key,
    '--body', filePath,
    '--content-type', contentTypeFromFileName(path.basename(filePath)),
    '--cache-control', key.endsWith('/latest.json') ? 'no-cache' : 'private, max-age=3600',
    '--metadata', `sha256=${sha256}`,
  ], config.awsEnv);
  console.log(`Uploaded R2 object: ${key}`);
}

async function downloadObject(config, key, destinationPath, allowMissing = false) {
  try {
    await runCommand('aws', [
      ...awsCommandArgs(config, 'get-object'),
      '--bucket', R2_BUCKET,
      '--key', key,
      destinationPath,
    ], config.awsEnv);
    return true;
  } catch (error) {
    if (allowMissing && /NoSuchKey|404|Not Found/i.test(error.message)) return false;
    throw error;
  }
}

async function verifyRemoteFile(config, key, sourcePath, expectedSize, expectedSha256) {
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'jatobid-r2-verify-'));
  const downloadedPath = path.join(temporaryDirectory, path.basename(sourcePath));
  try {
    await downloadObject(config, key, downloadedPath);
    const stat = await fsp.stat(downloadedPath);
    const digest = await sha256File(downloadedPath);
    if (stat.size !== expectedSize || digest !== expectedSha256) {
      throw new Error(`R2 verification failed for ${key}.`);
    }
    console.log(`Verified R2 object size and SHA-256: ${key}`);
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function putAndVerifyFile(config, key, filePath, expectedSha256 = '') {
  const stat = await fsp.stat(filePath);
  const sha256 = expectedSha256 || await sha256File(filePath);
  await putFile(config, key, filePath, sha256);
  await verifyRemoteFile(config, key, filePath, stat.size, sha256);
}

async function putAndVerifyJson(config, key, value) {
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'jatobid-r2-json-'));
  const filePath = path.join(temporaryDirectory, path.basename(key));
  try {
    await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await putAndVerifyFile(config, key, filePath);
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function readJsonObject(config, key, allowMissing = false) {
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'jatobid-r2-read-'));
  const filePath = path.join(temporaryDirectory, 'object.json');
  try {
    if (!await downloadObject(config, key, filePath, allowMissing)) return null;
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function publishVersion(config) {
  const manifest = await readAndValidateManifest(config.assetsDir, config.tagName);
  for (const file of manifest.files) {
    await putAndVerifyFile(config, file.key, path.join(config.assetsDir, file.name), file.sha256.toLowerCase());
  }
  await putAndVerifyFile(
    config,
    `${RELEASE_PREFIX}/${manifest.version}/manifest.json`,
    path.join(config.assetsDir, 'manifest.json'),
  );
}

export function buildLatestJson(manifest, githubRelease = {}) {
  return {
    ...manifest,
    name: githubRelease.name || manifest.tagName,
    body: githubRelease.body || '',
    githubReleaseUrl: githubRelease.url || '',
  };
}

async function promoteLatest(config) {
  const manifest = await readAndValidateManifest(config.assetsDir, config.tagName);
  const current = await readJsonObject(config, `${RELEASE_PREFIX}/latest.json`, true);
  if (current?.version && compareVersions(manifest.version, current.version) < 0) {
    throw new Error(`Refusing to replace latest ${current.version} with older version ${manifest.version}.`);
  }
  await fsp.mkdir(path.dirname(config.previousLatestPath), { recursive: true });
  await fsp.writeFile(
    config.previousLatestPath,
    `${JSON.stringify({ exists: Boolean(current), value: current }, null, 2)}\n`,
    'utf8',
  );
  const githubRelease = JSON.parse(await fsp.readFile(config.githubReleaseJson, 'utf8'));
  await putAndVerifyJson(config, `${RELEASE_PREFIX}/latest.json`, buildLatestJson(manifest, githubRelease));
  console.log(`Promoted R2 latest.json to ${manifest.version}.`);
}

async function deleteObject(config, key) {
  await runCommand('aws', [
    ...awsCommandArgs(config, 'delete-object'),
    '--bucket', R2_BUCKET,
    '--key', key,
  ], config.awsEnv);
  console.log(`Deleted R2 object: ${key}`);
}

async function rollbackLatest(config) {
  const state = JSON.parse(await fsp.readFile(config.previousLatestPath, 'utf8'));
  if (state.exists) {
    await putAndVerifyJson(config, `${RELEASE_PREFIX}/latest.json`, state.value);
    console.log(`Rolled back R2 latest.json to ${state.value.version}.`);
    return;
  }
  await deleteObject(config, `${RELEASE_PREFIX}/latest.json`);
  console.log('Removed R2 latest.json because no previous version existed.');
}

export function chooseVersionDirectoriesToDelete(keys, keepCount = KEEP_VERSION_COUNT, protectedVersions = []) {
  const versions = new Set();
  for (const key of keys) {
    const match = String(key || '').match(new RegExp(`^${RELEASE_PREFIX}/([^/]+)/`));
    if (match && VERSION_PATTERN.test(match[1])) versions.add(match[1]);
  }
  const sortedVersions = [...versions].sort(compareVersions).reverse();
  const keptVersions = new Set();
  for (const version of protectedVersions) {
    if (versions.has(version) && keptVersions.size < keepCount) keptVersions.add(version);
  }
  for (const version of sortedVersions) {
    if (keptVersions.size >= keepCount) break;
    keptVersions.add(version);
  }
  return {
    keptVersions: [...keptVersions],
    deletedKeys: keys.filter((key) => {
      const match = String(key || '').match(new RegExp(`^${RELEASE_PREFIX}/([^/]+)/`));
      return match && VERSION_PATTERN.test(match[1]) && !keptVersions.has(match[1]);
    }).sort(),
  };
}

async function cleanupVersions(config) {
  const output = await runCommand('aws', [
    ...awsCommandArgs(config, 'list-objects-v2'),
    '--bucket', R2_BUCKET,
    '--prefix', `${RELEASE_PREFIX}/`,
    '--output', 'json',
  ], config.awsEnv);
  const keys = (JSON.parse(output || '{}').Contents || []).map((object) => object.Key).filter(Boolean);
  const manifest = await readAndValidateManifest(config.assetsDir, config.tagName);
  const state = JSON.parse(await fsp.readFile(config.previousLatestPath, 'utf8'));
  const protectedVersions = [manifest.version];
  if (state.exists && VERSION_PATTERN.test(String(state.value?.version || ''))) {
    protectedVersions.push(state.value.version);
  }
  const { keptVersions, deletedKeys } = chooseVersionDirectoriesToDelete(
    keys,
    KEEP_VERSION_COUNT,
    protectedVersions,
  );
  console.log(`Keeping R2 release versions: ${keptVersions.join(', ') || '(none)'}.`);
  for (const key of deletedKeys) await deleteObject(config, key);
}

function createConfig() {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    awsEnv: createAwsCliEnv({ accessKeyId, secretAccessKey }),
    action: requireEnv('R2_RELEASE_ACTION'),
    tagName: String(process.env.TAG_NAME || '').trim(),
    assetsDir: path.resolve(process.env.RELEASE_ASSETS_DIR || 'release-assets'),
    githubReleaseJson: path.resolve(process.env.GITHUB_RELEASE_JSON || 'github-release.json'),
    previousLatestPath: path.resolve(process.env.PREVIOUS_LATEST_PATH || '.release-state/previous-latest.json'),
  };
}

async function main() {
  const config = createConfig();
  if (config.action === 'publish') return publishVersion(config);
  if (config.action === 'promote') return promoteLatest(config);
  if (config.action === 'rollback') return rollbackLatest(config);
  if (config.action === 'cleanup') return cleanupVersions(config);
  throw new Error(`Unsupported R2_RELEASE_ACTION: ${config.action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
