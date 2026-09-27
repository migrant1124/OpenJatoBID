const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

let runtime;

async function segmentObject(filePath, point, cacheDirectory) {
  const developmentModel = path.join(__dirname, '../../vendor/slimsam-77-uniform');
  const modelPath = fs.existsSync(path.join(developmentModel, 'config.json'))
    ? developmentModel : path.join(process.resourcesPath, 'sam-model');
  if (!fs.existsSync(path.join(modelPath, 'onnx/vision_encoder.onnx'))) throw new Error('SAM 模型资源未随客户端安装。');
  if (!runtime) runtime = import('@huggingface/transformers').then(async ({ SamModel, AutoProcessor, RawImage, env }) => {
    env.cacheDir = cacheDirectory;
    env.allowRemoteModels = false;
    return { model: await SamModel.from_pretrained(modelPath, { local_files_only: true }),
      processor: await AutoProcessor.from_pretrained(modelPath, { local_files_only: true }), RawImage };
  }).catch((error) => { runtime = null; throw error; });
  const { model, processor, RawImage } = await runtime;
  const image = await RawImage.read(path.resolve(filePath));
  const x = Math.max(0, Math.min(image.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(point.y)));
  const inputs = await processor(image, { input_points: [[[x, y]]] });
  const output = await model(inputs);
  const masks = await processor.post_process_masks(output.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const mask = masks[0];
  const [, candidates, height, width] = mask.dims;
  let best = 0;
  for (let index = 1; index < candidates; index += 1) {
    if (output.iou_scores.data[index] > output.iou_scores.data[best]) best = index;
  }
  const pixels = Uint8Array.from(mask.data.subarray(best * width * height, (best + 1) * width * height));
  const count = pixels.reduce((sum, value) => sum + Number(value > 0), 0);
  if (count < pixels.length * .002 || count > pixels.length * .95) throw new Error('SAM 未能选出稳定对象，请选择对象内部的点。');
  return { pixels, width, height, score: output.iou_scores.data[best] };
}

async function maskPng(mask, color = [237, 61, 72]) {
  const rgba = Buffer.alloc(mask.width * mask.height * 4);
  for (let index = 0; index < mask.pixels.length; index += 1) {
    const position = index * 4;
    rgba[position] = color[0]; rgba[position + 1] = color[1]; rgba[position + 2] = color[2];
    rgba[position + 3] = mask.pixels[index] ? 255 : 0;
  }
  return sharp(rgba, { raw: { width: mask.width, height: mask.height, channels: 4 } }).png().toBuffer();
}

module.exports = { segmentObject, maskPng };
