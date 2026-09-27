const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { createPixelLayers, writeLayeredPsd } = require('./imageStudioPsd.cjs');

test('真实产品照沿主体轮廓分层，合成逐像素等于原图并导出 PSD', async () => {
  const input = path.join(__dirname, '../../../evidence/v1.8.0-r3/live-image-normal-current-model.png');
  const output = process.env.R4_SAMPLE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-segment-'));
  fs.mkdirSync(output, { recursive: true });
  try {
    const layers = await createPixelLayers(input, [.1, .1, .8, .8], '白色陶瓷杯', output);
    const subject = await sharp(layers[1].filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const extents = new Set();
    for (let y = 0; y < subject.info.height; y += 24) {
      let count = 0;
      for (let x = 0; x < subject.info.width; x += 1) if (subject.data[(y * subject.info.width + x) * 4 + 3]) count += 1;
      if (count) extents.add(count);
    }
    assert.ok(extents.size > 10, '主体应有随行变化的轮廓，不是矩形切片');
    const original = await sharp(input).rotate().ensureAlpha().raw().toBuffer();
    const background = await sharp(layers[0].filePath).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < original.length; i += 4) {
      const source = subject.data[i + 3] ? subject.data : background;
      assert.deepEqual(source.subarray(i, i + 4), original.subarray(i, i + 4));
    }
    const psd = await writeLayeredPsd({ layers, outputPath: path.join(output, 'product-cup-layered.psd') });
    assert.equal(psd.layerCount, 2);
    assert.ok(psd.bytes > 100_000);
  } finally { if (!process.env.R4_SAMPLE_OUTPUT) fs.rmSync(output, { recursive: true, force: true }); }
});
