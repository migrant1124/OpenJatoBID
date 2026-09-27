const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { readPsd } = require('ag-psd');
const { createObjectLayer, createInpaintMask, applyInpaint, writeLayeredPsd } = require('./imageStudioPsd.cjs');

test('两个独立遮罩生成透明对象层、补洞遮罩和三层 PSD', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-layers-'));
  try {
    const source = path.join(directory, 'source.png');
    const background = path.join(directory, 'background.png');
    const output = path.join(directory, 'result.psd');
    const width = 16; const height = 12;
    await sharp({ create: { width, height, channels: 4, background: '#ff5500' } }).png().toFile(source);
    await sharp({ create: { width, height, channels: 4, background: '#669944' } }).png().toFile(background);
    const masks = [2, 9].map((left) => ({ width, height, pixels: Uint8Array.from({ length: width * height }, (_, index) => {
      const x = index % width; const y = Math.floor(index / width);
      return x >= left && x < left + 4 && y >= 3 && y < 9 ? 255 : 0;
    }) }));
    const objects = await Promise.all(masks.map((mask) => createObjectLayer(source, mask, directory)));
    const first = await sharp(objects[0].filePath).ensureAlpha().raw().toBuffer();
    const second = await sharp(objects[1].filePath).ensureAlpha().raw().toBuffer();
    assert.equal(first[(4 * width + 3) * 4 + 3], 255);
    assert.equal(first[(4 * width + 10) * 4 + 3], 0);
    assert.equal(second[(4 * width + 10) * 4 + 3], 255);
    const inpaint = await sharp(await createInpaintMask(masks)).ensureAlpha().raw().toBuffer();
    assert.equal(inpaint[(4 * width + 3) * 4 + 3], 0);
    assert.equal(inpaint[(4 * width + 10) * 4 + 3], 0);
    assert.equal(inpaint[3], 255);
    await assert.rejects(applyInpaint(source, background, masks[0]), /偏离原图/);
    await assert.rejects(applyInpaint(source, source, masks[0]), /未改变/);
    const proposed = await sharp(source).ensureAlpha().raw().toBuffer();
    for (let index = 0; index < masks[0].pixels.length; index += 1) if (masks[0].pixels[index]) {
      proposed.set([102, 153, 68], index * 4);
    }
    await sharp(proposed, { raw: { width, height, channels: 4 } }).png().toFile(background);
    fs.writeFileSync(background, await applyInpaint(source, background, masks[0]));
    const filled = await sharp(background).ensureAlpha().raw().toBuffer();
    assert.deepEqual([...filled.subarray(0, 4)], [255, 85, 0, 255]);
    assert.deepEqual([...filled.subarray((4 * width + 3) * 4, (4 * width + 3) * 4 + 4)], [102, 153, 68, 255]);
    const result = await writeLayeredPsd({ layers: [{ name: '背景底板', filePath: background },
      ...objects.map((object, index) => ({ name: `对象 ${index + 1}`, filePath: object.filePath }))], outputPath: output });
    assert.equal(result.layerCount, 3);
    assert.equal(readPsd(fs.readFileSync(output), { useImageData: true }).children.length, 3);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
