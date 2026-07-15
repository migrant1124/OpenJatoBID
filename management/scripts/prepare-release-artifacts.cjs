const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function getArtifactNames(version) {
  if (!VERSION_PATTERN.test(String(version || ''))) {
    throw new Error(`Invalid management version: ${version || '(empty)'}`);
  }
  const baseName = `Jato-AI-BID-Management-${version}-win-x64`;
  return [`${baseName}.exe`, `${baseName}.zip`];
}

async function prepareManagementRelease({ inputDir, outputDir, version }) {
  const artifactNames = getArtifactNames(version);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const checksums = [];
  for (const artifactName of artifactNames) {
    const sourcePath = path.join(inputDir, artifactName);
    const destinationPath = path.join(outputDir, artifactName);
    const stat = fs.existsSync(sourcePath) ? fs.statSync(sourcePath) : null;
    if (!stat?.isFile() || stat.size <= 0) {
      throw new Error(`Required management artifact is missing or empty: ${artifactName}`);
    }
    fs.copyFileSync(sourcePath, destinationPath);
    checksums.push(`${await sha256File(destinationPath)}  ${artifactName}`);
  }
  fs.writeFileSync(path.join(outputDir, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`, 'utf8');
  return { artifactNames, checksums };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const version = String(process.env.MANAGEMENT_VERSION || '').trim();
  const outputDir = path.resolve(projectRoot, process.env.MANAGEMENT_ARTIFACT_OUTPUT_DIR || 'release-artifact');
  await prepareManagementRelease({
    inputDir: path.resolve(projectRoot, process.env.MANAGEMENT_RELEASE_INPUT_DIR || 'release'),
    outputDir,
    version,
  });
  console.log(`Prepared management release artifacts in ${outputDir}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = { getArtifactNames, prepareManagementRelease, sha256File };
