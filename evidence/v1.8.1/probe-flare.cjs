const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../client/node_modules/sharp');
const { createAiService } = require('../../client/electron/services/aiService.cjs');
const { createInpaintMask } = require('../../client/electron/services/imageStudioPsd.cjs');

async function main() {
  const app = { getPath: () => path.join(__dirname, '../../.tmp/v181-flare-probe') };
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'jatoaibid', 'user_config.json'), 'utf8'));
  const configStore = { load: () => config };
  const aiService = createAiService({ app, configStore });
  const source = path.join(__dirname, 'segmentation-source.png');
  const model = process.env.V181_MODEL || 'gpt-image-2.5-flare';
  const layer = await sharp(path.join(__dirname, 'live-layer-sample/cat-layer.png')).ensureAlpha().raw().toBuffer();
  const mask = { width: 1536, height: 1024, pixels: Uint8Array.from({ length: 1536 * 1024 }, (_, index) => layer[index * 4 + 3]) };
  const result = await aiService.withQueueScope('image-studio:flare-probe').generateImage({
    prompt: '仅移除原图正中央的橘色猫，保持蓝色沙发、米色编织地毯、茶几、墙面和光线与原图一致。根据猫身体四周已有的米色编织地毯纹理，补全猫原来遮挡的那片地毯。',
    size: '1536x1024', images: [{ buffer: fs.readFileSync(source), mimeType: 'image/png' }],
    mask: await createInpaintMask([mask]), title: '生图模式-2.5Flare实测', preservePrompt: true, noRetry: true,
    configSnapshot: { ...config, image_model: { ...config.image_model, model_name: model, request_mode: 'normal' } },
  });
  const target = path.join(__dirname, `${model}-cat-test.png`);
  fs.copyFileSync(result.file_path, target);
  console.log(target);
}

main().catch((error) => { console.error(String(error?.message || error)); process.exitCode = 1; });
