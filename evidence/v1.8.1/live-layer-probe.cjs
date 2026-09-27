const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema, createPromptLibrarySchema } = require('../../client/electron/services/sqliteDatabase.cjs');
const { createAiService } = require('../../client/electron/services/aiService.cjs');
const { createImageStudioService } = require('../../client/electron/services/imageStudioService.cjs');
const { createPromptLibraryStore } = require('../../client/electron/services/promptLibraryStore.cjs');

async function main() {
  const output = path.join(__dirname, process.env.V181_OUTPUT || 'live-layer-sample');
  fs.mkdirSync(output, { recursive: true });
  const db = new DatabaseSync(path.join(output, 'sample.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  createPromptLibrarySchema(db); createImageStudioSchema(db); extendImageStudioSchema(db);
  const app = { getPath: () => path.join(__dirname, '../../.tmp/v181-probe'), getVersion: () => '1.8.1-probe' };
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'jatoaibid', 'user_config.json'), 'utf8'));
  const configStore = { load: () => config };
  const aiService = createAiService({ app, configStore });
  const service = createImageStudioService({ app, db, aiService, configStore,
    promptLibraryStore: createPromptLibraryStore({ db }),
    dialogApi: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(output, 'layered-sample.psd') }) } });
  const source = path.join(__dirname, 'segmentation-source.png');
  const sourceBytes = fs.readFileSync(source);
  db.prepare(`INSERT INTO image_studio_assets (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
    VALUES ('sample', ?, 'yibiao-asset://generated-images/source.png', 'image/png', 1536, 1024, ?, ?)`)
    .run(source, crypto.createHash('sha256').update(sourceBytes).digest('hex'), new Date().toISOString());
  try {
    const session = await service.createLayerSet({ assetId: 'sample' });
    const psd = await service.exportLayeredPsd({ setId: session.setId });
    const report = { success: true, model: 'gpt-image-2.5-sunburst', width: session.width,
      height: session.height, layers: session.layers.map((layer) => ({ name: layer.name, assetUrl: layer.assetUrl })),
      psd: psd.filePath, psdBytes: fs.statSync(psd.filePath).size };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { success: false, model: 'gpt-image-2.5-sunburst', error: String(error?.message || error).slice(0, 500),
      statusCode: Number(error?.statusCode || 0) };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    process.exitCode = 1;
  } finally { db.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
