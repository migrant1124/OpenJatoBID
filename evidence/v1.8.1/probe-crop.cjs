const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../client/node_modules/sharp');
const { createAiService } = require('../../client/electron/services/aiService.cjs');
const { createInpaintMask } = require('../../client/electron/services/imageStudioPsd.cjs');

async function main() {
  const directory = __dirname;
  const source = path.join(directory, 'segmentation-source.png');
  const crop = { left: 0, top: 0, width: 1024, height: 1024 };
  const cropped = await sharp(source).extract(crop).png().toBuffer();
  const layer = await sharp(path.join(directory, 'live-layer-sample/cat-layer.png')).extract(crop).ensureAlpha().raw().toBuffer();
  const mask = { width: 1024, height: 1024,
    pixels: Uint8Array.from({ length: 1024 * 1024 }, (_, index) => layer[index * 4 + 3]) };
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'jatoaibid', 'user_config.json'), 'utf8'));
  const aiService = createAiService({ app: { getPath: () => path.join(directory, '../../.tmp/v181-crop-probe') },
    configStore: { load: () => config } });
  const result = await aiService.withQueueScope('image-studio:crop-probe').generateImage({
    prompt: '仅移除遮罩中的橘猫，补全橘猫身后的蓝色沙发和下方米色编织地毯。保持沙发边缘、地毯纹理、视角和光线连贯，不增删其他物体。',
    size: '1024x1024', images: [{ buffer: cropped, mimeType: 'image/png' }],
    mask: await createInpaintMask([mask]), title: '生图模式-2.5局部补洞实测', preservePrompt: true, noRetry: true,
    configSnapshot: { ...config, image_model: { ...config.image_model,
      model_name: 'gpt-image-2.5-sunburst', request_mode: 'normal' } },
  });
  const generated = path.join(directory, 'gpt-image-2.5-sunburst-crop.png');
  fs.copyFileSync(result.file_path, generated);
  const raw = await sharp(generated).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceRaw = await sharp(cropped).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let outsideDifference = 0; let outsideCount = 0;
  for (let index = 0; index < mask.pixels.length; index += 1) {
    const at = index * 4;
    if (mask.pixels[index]) sourceRaw.data.set(raw.data.subarray(at, at + 3), at);
    else { outsideDifference += (Math.abs(raw.data[at] - sourceRaw.data[at]) +
      Math.abs(raw.data[at + 1] - sourceRaw.data[at + 1]) +
      Math.abs(raw.data[at + 2] - sourceRaw.data[at + 2])) / 3; outsideCount += 1; }
  }
  const patch = await sharp(sourceRaw.data, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
  const composite = await sharp(source).composite([{ input: patch, left: 0, top: 0 }]).png().toBuffer();
  fs.writeFileSync(path.join(directory, 'gpt-image-2.5-sunburst-crop-composite.png'), composite);
  const report = { model: 'gpt-image-2.5-sunburst', crop, outsideDifference: outsideDifference / outsideCount,
    generated, composite: path.join(directory, 'gpt-image-2.5-sunburst-crop-composite.png') };
  fs.writeFileSync(path.join(directory, 'crop-probe-result.json'), JSON.stringify(report, null, 2));
  console.log(report);
}

main().catch((error) => { console.error(String(error.stack || error)); process.exitCode = 1; });
