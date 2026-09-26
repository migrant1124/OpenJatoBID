const fs = require('node:fs');
const crypto = require('node:crypto');
const sharp = require('sharp');
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
    .composite(decoded.map((layer) => ({ input: layer.data, raw: { width, height, channels: 4 } })))
    .raw().toBuffer();
  const imageData = (layer) => ({ width, height, data: new Uint8ClampedArray(layer.data) });
  const buffer = writePsdBuffer({
    width, height,
    imageData: { width, height, data: new Uint8ClampedArray(composite) },
    children: decoded.slice().reverse().map((layer) => ({ name: layer.name, imageData: imageData(layer) })),
  });
  const parsed = readPsd(buffer, { useImageData: true, skipThumbnail: true });
  if (parsed.width !== width || parsed.height !== height || parsed.children?.length !== decoded.length) {
    throw new Error('PSD 写入后图层校验失败。');
  }
  fs.writeFileSync(outputPath, buffer);
  return { width, height, layerCount: decoded.length, bytes: buffer.length };
}

module.exports = { writeLayeredPsd };
