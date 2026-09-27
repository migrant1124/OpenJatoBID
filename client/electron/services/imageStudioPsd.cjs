const fs = require('node:fs');
const crypto = require('node:crypto');
const sharp = require('sharp');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
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

function segmentForeground(filePath, box) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'imageStudioSegmentWorker.cjs'), { workerData: { filePath, box } });
    worker.once('message', (result) => result.error ? reject(new Error(result.error)) : resolve(result));
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code) reject(new Error(`分割工作线程异常退出（${code}）。`)); });
  });
}

async function createPixelLayers(filePath, box, subjectName, directory, maskOverride) {
  const { data, info } = await sharp(filePath).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let fullMask;
  if (maskOverride) {
    const image = await sharp(maskOverride).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (image.info.width !== info.width || image.info.height !== info.height) throw new Error('细修遮罩尺寸与原图不一致。');
    fullMask = Buffer.alloc(info.width * info.height);
    for (let i = 0; i < fullMask.length; i += 1) fullMask[i] = image.data[i * 4 + 3];
  } else {
    const { mask, width, height } = await segmentForeground(filePath, box);
    fullMask = Buffer.alloc(info.width * info.height);
    for (let y = 0; y < info.height; y += 1) {
      const sourceY = Math.min(height - 1, Math.floor(y * height / info.height));
      for (let x = 0; x < info.width; x += 1) {
        fullMask[y * info.width + x] = mask[sourceY * width + Math.min(width - 1, Math.floor(x * width / info.width))];
      }
    }
  }
  if (fullMask.length !== info.width * info.height) throw new Error('分割遮罩与原图尺寸不一致。');
  fs.mkdirSync(directory, { recursive: true });
  const outputs = [];
  for (const [index, name] of ['背景', subjectName].entries()) {
    const pixels = Buffer.from(data);
    for (let i = 0; i < fullMask.length; i += 1) {
      if (Boolean(fullMask[i] >= 128) !== Boolean(index)) pixels[i * 4 + 3] = 0;
    }
    const file = path.join(directory, `${index}-${crypto.randomUUID()}.png`);
    fs.writeFileSync(file, await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
    outputs.push({ name, filePath: file, width: info.width, height: info.height });
  }
  return outputs;
}

module.exports = { writeLayeredPsd, segmentForeground, createPixelLayers };
