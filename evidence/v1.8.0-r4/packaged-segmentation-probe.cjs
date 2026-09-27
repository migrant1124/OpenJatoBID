const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.join(__dirname, '..', '..');
  const packaged = require(path.join(root, 'client/release/win-unpacked/resources/app.asar/electron/services/imageStudioPsd.cjs'));
  const input = path.join(__dirname, '../v1.8.0-r3/live-image-normal-current-model.png');
  const output = path.join(__dirname, 'packaged-psd-sample');
  fs.mkdirSync(output, { recursive: true });
  const layers = await packaged.createPixelLayers(input, [.1, .1, .8, .8], '白色陶瓷杯', output);
  const psd = path.join(output, 'packaged-cup-layered.psd');
  const result = await packaged.writeLayeredPsd({ layers, outputPath: psd });
  const report = { runtime: process.versions.electron, success: true, psd, layers: layers.map((layer) => layer.filePath), result };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exitCode = 1; });
