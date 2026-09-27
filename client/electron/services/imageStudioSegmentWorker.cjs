const { parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');

async function segment() {
  const cv = await require('@techstark/opencv-js');
  const { data, info } = await sharp(workerData.filePath).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const image = new cv.Mat(height, width, cv.CV_8UC4);
  const rgb = new cv.Mat();
  const mask = new cv.Mat();
  const background = new cv.Mat();
  const foreground = new cv.Mat();
  try {
    image.data.set(data);
    cv.cvtColor(image, rgb, cv.COLOR_RGBA2RGB);
    const [x, y, w, h] = workerData.box;
    const left = Math.max(1, Math.min(width - 3, Math.floor(x * width)));
    const top = Math.max(1, Math.min(height - 3, Math.floor(y * height)));
    const rect = new cv.Rect(left, top, Math.max(2, Math.min(width - left - 1, Math.ceil(w * width))),
      Math.max(2, Math.min(height - top - 1, Math.ceil(h * height))));
    cv.grabCut(rgb, mask, rect, background, foreground, 5, cv.GC_INIT_WITH_RECT);
    const output = Buffer.alloc(width * height);
    let selected = 0;
    for (let i = 0; i < output.length; i += 1) {
      const foregroundPixel = mask.data[i] === cv.GC_FGD || mask.data[i] === cv.GC_PR_FGD;
      output[i] = foregroundPixel ? 255 : 0;
      selected += Number(foregroundPixel);
    }
    if (selected < output.length * .01 || selected > output.length * .95) throw new Error('无法识别稳定的主体轮廓，请调整候选区域。');
    parentPort.postMessage({ width, height, mask: output });
  } finally {
    image.delete(); rgb.delete(); mask.delete(); background.delete(); foreground.delete();
  }
}

segment().catch((error) => parentPort.postMessage({ error: String(error?.message || error) }));
