const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const sharp = require('sharp');
const { createConfigStore } = require('../electron/services/configStore.cjs');
const { createAiService } = require('../electron/services/aiService.cjs');

app.whenReady().then(async () => {
  const mode = process.argv[2];
  const evidenceDir = process.argv[3];
  if (!['image', 'image-normal', 'vision'].includes(mode) || !evidenceDir) throw new Error('用法：electron script.cjs image|image-normal|vision evidenceDir');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-live-'));
  const configPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'jatoaibid');
  const config = createConfigStore({ getPath: () => configPath }).load();
  const requestConfig = mode === 'image-normal' ? { ...config,
    image_model: { ...config.image_model, request_mode: 'normal' } } : config;
  const aiService = createAiService({
    app: { getPath: () => temp, getVersion: () => app.getVersion() },
    configStore: { load: () => requestConfig },
  });
  const report = { mode, model: mode.startsWith('image') ? requestConfig.image_model?.model_name : requestConfig.model_name,
    requestMode: mode.startsWith('image') ? requestConfig.image_model?.request_mode : requestConfig.request_mode,
    requestSent: false, success: false, at: new Date().toISOString() };
  try {
    if (mode.startsWith('image')) {
      const result = await aiService.generateImage({
        prompt: '一只白色陶瓷马克杯置于浅灰背景，柔和自然光，简洁产品摄影，不要文字或标志。',
        title: 'R3单图合同验证', preservePrompt: true, noRetry: true, configSnapshot: requestConfig,
        size: requestConfig.image_model?.image_size,
        onSent() { report.requestSent = true; },
        onResponseHeaders({ contentType, status }) { report.responseContentType = contentType; report.responseStatus = status; },
      });
      const bytes = fs.readFileSync(result.file_path);
      const metadata = await sharp(bytes).metadata();
      fs.copyFileSync(result.file_path, path.join(evidenceDir, `live-${mode}-current-model${path.extname(result.file_path)}`));
      Object.assign(report, { success: true, mimeType: result.mime_type, width: metadata.width,
        height: metadata.height, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    } else {
      const image = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#d92332' } }).jpeg().toBuffer();
      report.requestSent = true;
      const response = await aiService.chat({
        configSnapshot: config, noRetry: true, sensitiveImage: true, logTitle: 'R3视觉输入合同验证',
        messages: [
          { role: 'system', content: '只用中文回答用户问题，不要猜模型参数。' },
          { role: 'user', content: [
            { type: 'text', text: '这张图片的主要颜色是什么？一句话回答。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
          ] },
        ],
      });
      Object.assign(report, { success: true, response: String(response).slice(0, 300),
        imageBytesSent: image.length });
    }
  } catch (error) {
    report.error = String(error?.message || error);
    report.statusCode = Number(error?.statusCode || 0);
    const raw = error?.raw_response_data;
    if (raw && typeof raw === 'object') report.responseShape = {
      keys: Object.keys(raw), dataCount: Array.isArray(raw.data) ? raw.data.length : null,
      firstItemKeys: raw.data?.[0] ? Object.keys(raw.data[0]) : [],
      completedKeys: raw.completed ? Object.keys(raw.completed) : [],
      errorCodes: Array.isArray(raw.errors) ? raw.errors.map((item) => item.code || '') : [],
    };
  } finally {
    fs.writeFileSync(path.join(evidenceDir, `live-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
    fs.rmSync(temp, { recursive: true, force: true });
    console.log(JSON.stringify(report));
    app.exit(report.success ? 0 : 1);
  }
}, (error) => { console.error(error); app.exit(1); });
