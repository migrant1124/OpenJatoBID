const path = require('node:path');
const fs = require('node:fs');
const report = path.join(__dirname, 'packaged-sam-result.json');
const version = require(path.join(process.resourcesPath, 'app.asar/package.json')).version;
fs.writeFileSync(report, JSON.stringify({ phase: 'boot', packagedResources: process.resourcesPath }));

async function main() {
  const { segmentObject } = require(path.join(process.resourcesPath, 'app.asar/electron/services/imageStudioSam.cjs'));
  fs.writeFileSync(report, JSON.stringify({ phase: 'loaded', packagedResources: process.resourcesPath }));
  const result = await segmentObject(path.join(__dirname, 'segmentation-source.png'), { x: 700, y: 500 },
    path.join(__dirname, '../../.tmp/v181-packaged-empty-cache'));
  fs.writeFileSync(report, JSON.stringify({ phase: 'completed', packagedResources: process.resourcesPath,
    version,
    width: result.width, height: result.height,
    selectedPixels: result.pixels.reduce((sum, value) => sum + Number(value > 0), 0) }));
}

const keepAlive = setInterval(() => {}, 1000);
main().catch((error) => { fs.writeFileSync(report, JSON.stringify({ phase: 'failed', error: String(error.stack || error) }));
  process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
