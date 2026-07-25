const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { downloadArtifact } = require('@electron/get');

const projectRoot = path.resolve(__dirname, '..');
const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
const electronPackage = require(path.join(electronRoot, 'package.json'));
const checksums = require(path.join(electronRoot, 'checksums.json'));

const platform = getArgValue('--platform') || process.platform;
const arch = getArgValue('--arch') || process.arch;
const platformPath = getPlatformPath(platform);
const distPath = path.join(electronRoot, 'dist');
const executablePath = path.join(distPath, platformPath);
const pathFile = path.join(electronRoot, 'path.txt');

async function main() {
  fs.rmSync(distPath, { recursive: true, force: true });
  fs.rmSync(pathFile, { force: true });
  fs.mkdirSync(distPath, { recursive: true });

  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: 'electron',
    force: true,
    checksums,
    platform,
    arch,
  });
  console.log(`[electron-binary] downloaded ${zipPath}`);

  childProcess.execFileSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    '& { param($zip, $dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }',
    zipPath,
    distPath,
  ], { stdio: 'inherit' });

  fs.writeFileSync(pathFile, platformPath);

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Electron executable is missing after install: ${executablePath}`);
  }

  console.log(`[electron-binary] installed ${electronPackage.version} ${platform}-${arch}`);
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return '';
  }
  return process.argv[index + 1] || '';
}

function getPlatformPath(targetPlatform) {
  switch (targetPlatform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron builds are not available on platform: ${targetPlatform}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
