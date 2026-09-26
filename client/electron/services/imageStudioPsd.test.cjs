const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { readPsd } = require('ag-psd');
const { writeLayeredPsd } = require('./imageStudioPsd.cjs');

test('两个真实差异像素层写成可解析 PSD，拒绝重复整图', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-psd-'));
  try {
    const red = path.join(directory, 'red.png');
    const green = path.join(directory, 'green.png');
    const output = path.join(directory, 'layers.psd');
    await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff000080' } }).png().toFile(red);
    await sharp({ create: { width: 8, height: 6, channels: 4, background: '#00ff0080' } }).png().toFile(green);
    const result = await writeLayeredPsd({ layers: [{ name: '红层', filePath: red }, { name: '绿层', filePath: green }], outputPath: output });
    assert.deepEqual([result.width, result.height, result.layerCount], [8, 6, 2]);
    const parsed = readPsd(fs.readFileSync(output), { useImageData: true, skipThumbnail: true });
    assert.deepEqual(parsed.children.map((layer) => layer.name), ['绿层', '红层']);
    assert.notDeepEqual(parsed.children[0].imageData.data, parsed.children[1].imageData.data);
    await assert.rejects(writeLayeredPsd({ layers: [{ name: '一', filePath: red }, { name: '二', filePath: red }], outputPath: output }), /实质差异/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
