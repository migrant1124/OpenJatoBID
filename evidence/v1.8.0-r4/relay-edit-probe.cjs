const fs = require('node:fs');
const path = require('node:path');
const { createAiService } = require('../../client/electron/services/aiService.cjs');

async function main() {
  const configPath = path.join(process.env.APPDATA, 'jatoaibid', 'user_config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const output = __dirname;
  const app = { getPath: () => output, getVersion: () => '1.8.0-r4-probe' };
  const service = createAiService({ app, configStore: { load: () => config } });
  const image = fs.readFileSync(path.join(__dirname, '../v1.8.0-r3/live-image-normal-current-model.png'));
  let sent = false;
  try {
    const result = await service.generateImage({ prompt: '图1是主体参考。保持白色陶瓷杯的形状和构图，将杯身改成浅蓝色。',
      size: config.image_model.image_size, images: [{ buffer: image, mimeType: 'image/png' }],
      preservePrompt: true, noRetry: true,
      configSnapshot: { ...config, image_model: { ...config.image_model, request_mode: 'normal' } },
      onSent() { sent = true; } });
    const report = { sent, success: true, model: config.image_model.model_name, size: config.image_model.image_size,
      file: result.file_path, bytes: fs.statSync(result.file_path).size };
    fs.writeFileSync(path.join(output, 'relay-edit-result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
  } catch (error) {
    const report = { sent, success: false, model: config.image_model.model_name, size: config.image_model.image_size,
      statusCode: error.statusCode || null, message: String(error.message || error).slice(0, 700) };
    fs.writeFileSync(path.join(output, 'relay-edit-result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
    process.exitCode = 1;
  }
}

main();
