const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createImageStudioSchema, extendImageStudioSchema, createPromptLibrarySchema } = require('../../client/electron/services/sqliteDatabase.cjs');
const { createImageStudioService } = require('../../client/electron/services/imageStudioService.cjs');

async function main() {
  const output = path.join(__dirname, 'source-cover-sample');
  fs.mkdirSync(output, { recursive: true });
  const db = new DatabaseSync(path.join(output, 'sample.sqlite'));
  createPromptLibrarySchema(db); createImageStudioSchema(db); extendImageStudioSchema(db);
  const service = createImageStudioService({ app: { getPath: () => output }, db,
    configStore: { load: () => ({ image_model: {} }) },
    aiService: { getImageModelAvailability: () => ({ available: false }) } });
  const sourceId = 'awesome-gpt-image';
  const refresh = await service.refreshSource(sourceId);
  const page = service.listItems({ sourceId, limit: 40, offset: 0 });
  const item = page.items.find((entry) => entry.coverUrl);
  if (!item) throw new Error('来源没有真实示例图 URL。');
  const cover = await service.loadCover(item.itemId);
  const again = await service.loadCover(item.itemId);
  const report = { sourceId, refresh, total: page.total, itemId: item.itemId,
    title: item.title, coverUrl: item.coverUrl, assetUrl: cover.assetUrl, cacheHit: again.assetUrl === cover.assetUrl };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
  db.close();
}

main().catch((error) => { process.stderr.write(String(error.message || error)); process.exitCode = 1; });
