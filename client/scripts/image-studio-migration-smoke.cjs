const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const sharp = require('sharp');
const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');

app.whenReady().then(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-migration-'));
  const fakeApp = { getPath: () => directory, once: () => {} };
  try {
    const first = createSqliteDatabase(fakeApp);
    assert.equal(first.schemaVersion, 34);
    assert.equal(first.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'image_studio_%' AND type = 'table'").get().count, 10);
    const oldPromptCount = first.db.prepare('SELECT COUNT(*) AS count FROM prompt_items').get().count;
    first.db.pragma('foreign_keys = OFF');
    first.db.exec(`DROP TABLE image_studio_layers;
      DROP TABLE image_studio_layer_sets;
      DROP TABLE image_studio_reference_items;
      DROP TABLE image_studio_sources;
      DROP TABLE image_studio_styles;
      DROP TABLE image_studio_prompt_meta;
      DROP TABLE image_studio_assets;
      DROP TABLE image_studio_works;
      DROP TABLE image_studio_tasks;
      DROP TABLE image_studio_draft;`);
    first.db.pragma('foreign_keys = ON');
    first.db.pragma('user_version = 32');
    first.close();
    const reopened = createSqliteDatabase(fakeApp);
    assert.equal(reopened.db.pragma('user_version', { simple: true }), 34);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM prompt_items').get().count, oldPromptCount);
    reopened.db.prepare("INSERT INTO image_studio_draft (id, prompt, revision, updated_at) VALUES (1, '保留草稿', 1, '2026-09-26')").run();
    reopened.db.exec('DROP TABLE image_studio_styles');
    reopened.db.pragma('user_version = 33');
    reopened.close();
    const again = createSqliteDatabase(fakeApp);
    assert.equal(again.db.pragma('user_version', { simple: true }), 34);
    assert.ok(again.db.prepare("SELECT name FROM sqlite_master WHERE name = 'image_studio_styles'").get());
    assert.equal(again.db.prepare('SELECT prompt FROM image_studio_draft WHERE id = 1').get().prompt, '保留草稿');
    again.close();
    assert.ok(fs.readdirSync(path.join(directory, 'workspace')).some((name) => name.includes('.backup-')));
    const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer();
    assert.equal(image.subarray(0, 4).toString('hex'), '89504e47');
    console.log('[image-studio] Electron SQLite v32/v33->v34 migration, backup, reopen, and sharp passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, (error) => { console.error(error); app.exit(1); });
