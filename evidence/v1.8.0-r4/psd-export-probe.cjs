const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('../../client/node_modules/sharp');
const { createImageStudioService } = require('../../client/electron/services/imageStudioService.cjs');

async function main() {
  const output = path.join(__dirname, 'psd-vision-sample');
  const db = new DatabaseSync(path.join(output, 'sample.sqlite'));
  const set = db.prepare('SELECT set_id FROM image_studio_psd_sessions ORDER BY created_at DESC LIMIT 1').get();
  if (!set) throw new Error('尚无视觉候选拆层会话。');
  const service = createImageStudioService({ app: { getPath: () => output }, db,
    configStore: { load: () => ({ image_model: {} }) },
    aiService: { getImageModelAvailability: () => ({ available: false }) },
    dialogApi: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(output, 'vision-cup-layered.psd') }) } });
  const result = await service.exportLayeredPsd({ setId: set.set_id });
  const subject = db.prepare('SELECT file_path FROM image_studio_psd_layers WHERE set_id = ? ORDER BY sort_order DESC LIMIT 1').get(set.set_id);
  await sharp(subject.file_path).flatten({ background: '#65788d' }).png().toFile(path.join(output, 'foreground-on-dark.png'));
  fs.writeFileSync(path.join(output, 'export-result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result));
  db.close();
}

main().catch((error) => { process.stderr.write(String(error.message || error)); process.exitCode = 1; });
