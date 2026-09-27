const fs = require('node:fs');
const crypto = require('node:crypto');
const sharp = require('sharp');
const path = require('node:path');
const { writePsdBuffer, readPsd, initializeCanvas } = require('ag-psd');

initializeCanvas(() => { throw new Error('不需要 Canvas 解码'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

async function writeLayeredPsd({ layers, outputPath }) {
  if (!Array.isArray(layers) || layers.length < 2) throw new Error('至少需要两个真实图层。');
  const decoded = await Promise.all(layers.map(async (layer) => {
    const { data, info } = await sharp(layer.filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { name: String(layer.name || '图层'), width: info.width, height: info.height, data };
  }));
  const { width, height } = decoded[0];
  if (decoded.some((layer) => layer.width !== width || layer.height !== height)) throw new Error('图层尺寸不一致。');
  const hashes = new Set();
  for (const layer of decoded) {
    let occupied = false;
    for (let index = 3; index < layer.data.length; index += 4) {
      if (layer.data[index] > 0) { occupied = true; break; }
    }
    if (!occupied) throw new Error('图层没有可见像素。');
    hashes.add(crypto.createHash('sha256').update(layer.data).digest('hex'));
  }
  if (hashes.size < 2) throw new Error('图层内容没有实质差异。');

  const composite = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite(decoded.filter((layer, index) => layers[index].visible !== false).map((layer) => ({ input: layer.data, raw: { width, height, channels: 4 } })))
    .raw().toBuffer();
  const imageData = (layer) => ({ width, height, data: new Uint8ClampedArray(layer.data) });
  const buffer = writePsdBuffer({
    width, height,
    imageData: { width, height, data: new Uint8ClampedArray(composite) },
    children: decoded.slice().reverse().map((layer, index) => ({ name: layer.name,
      hidden: layers[layers.length - 1 - index].visible === false, imageData: imageData(layer) })),
  });
  const parsed = readPsd(buffer, { useImageData: true, skipThumbnail: true });
  if (parsed.width !== width || parsed.height !== height || parsed.children?.length !== decoded.length) {
    throw new Error('PSD 写入后图层校验失败。');
  }
  const temporary = `${outputPath}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, buffer); fs.renameSync(temporary, outputPath); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { width, height, layerCount: decoded.length, bytes: buffer.length };
}

async function createObjectLayer(filePath, mask, directory) {
  const { data, info } = await sharp(filePath).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (mask.width !== info.width || mask.height !== info.height) throw new Error('SAM 遮罩尺寸与原图不一致。');
  const pixels = Buffer.from(data);
  let occupied = 0;
  for (let index = 0; index < mask.pixels.length; index += 1) {
    if (mask.pixels[index]) occupied += 1;
    else pixels.fill(0, index * 4, index * 4 + 4);
  }
  if (occupied < mask.pixels.length * .002 || occupied > mask.pixels.length * .95) throw new Error('候选对象遮罩无效。');
  fs.mkdirSync(directory, { recursive: true });
  const filePathOut = path.join(directory, `object-${crypto.randomUUID()}.png`);
  fs.writeFileSync(filePathOut, await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
  return { filePath: filePathOut, width: info.width, height: info.height };
}

async function createInpaintMask(masks) {
  const { width, height } = masks[0];
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (const mask of masks) {
    if (mask.width !== width || mask.height !== height) throw new Error('对象遮罩尺寸不一致。');
    for (let index = 0; index < mask.pixels.length; index += 1) {
      if (mask.pixels[index]) pixels[index * 4 + 3] = 0;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function applyInpaint(base, generated, mask) {
  const source = await sharp(base).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fill = await sharp(generated).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (source.info.width !== mask.width || source.info.height !== mask.height ||
    fill.info.width !== mask.width || fill.info.height !== mask.height) throw new Error('背景补全尺寸与原图不一致。');
  let outsideDifference = 0; let outsidePixels = 0; let insideDifference = 0; let insidePixels = 0;
  for (let index = 0; index < mask.pixels.length; index += 1) {
    if (mask.pixels[index]) {
      if (fill.data[index * 4 + 3] < 255) throw new Error('背景补全结果仍有透明空洞。');
      const offset = index * 4;
      insideDifference += (Math.abs(fill.data[offset] - source.data[offset]) +
        Math.abs(fill.data[offset + 1] - source.data[offset + 1]) +
        Math.abs(fill.data[offset + 2] - source.data[offset + 2])) / 3;
      insidePixels += 1;
      fill.data.copy(source.data, index * 4, index * 4, index * 4 + 4);
    } else {
      const offset = index * 4;
      outsideDifference += (Math.abs(fill.data[offset] - source.data[offset]) +
        Math.abs(fill.data[offset + 1] - source.data[offset + 1]) +
        Math.abs(fill.data[offset + 2] - source.data[offset + 2])) / 3;
      outsidePixels += 1;
    }
  }
  if (outsideDifference / outsidePixels > 40) throw new Error('背景补全结果明显偏离原图，未生成不可信 PSD。');
  if (insideDifference / insidePixels < 5) throw new Error('背景补全未改变对象遮挡区域，未生成不可信 PSD。');
  return sharp(source.data, { raw: { width: mask.width, height: mask.height, channels: 4 } }).png().toBuffer();
}

module.exports = { writeLayeredPsd, createObjectLayer, createInpaintMask, applyInpaint };
