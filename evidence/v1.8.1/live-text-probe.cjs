const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../client/node_modules/sharp');
const { createAiService } = require('../../client/electron/services/aiService.cjs');

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'jatoaibid/user_config.json'), 'utf8'));
  const aiService = createAiService({ app: { getPath: () => path.join(__dirname, '../../.tmp/v181-live-text-probe') },
    configStore: { load: () => config } });
  const image = await sharp(path.join(__dirname, 'segmentation-source.png'))
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
  const started = Date.now();
  const result = { model: config.model_name, imageBytes: image.length };
  try {
    const response = await aiService.chat({ configSnapshot: config, noRetry: true,
      sensitiveImage: true, logTitle: '生图模式-PSD候选诊断', messages: [
        { role: 'system', content: '只返回 JSON：{"objects":[{"name":"简短中文名称","box":[x,y,w,h]}]}。box 为原图归一化坐标。' },
        { role: 'user', content: [{ type: 'text', text: '列出图中至少两个不同物体。' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }] },
      ] });
    result.status = 'completed'; result.hasObjects = Array.isArray(JSON.parse(String(response)).objects);
  } catch (error) {
    result.status = 'failed'; result.message = String(error.message);
    result.code = String(error.cause?.code || '');
    result.cause = String(error.cause?.message || '');
  }
  result.elapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(__dirname, 'live-text-probe-result.json'), JSON.stringify(result, null, 2));
  console.log(result);
}

main().catch((error) => { console.error(String(error.stack || error)); process.exitCode = 1; });
