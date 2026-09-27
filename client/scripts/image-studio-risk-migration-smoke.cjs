const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');

app.whenReady().then(() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-risk-migration-'));
  const fakeApp = { getPath: () => directory, once: () => {} };
  try {
    const previous = createSqliteDatabase(fakeApp);
    previous.db.prepare("INSERT INTO image_studio_draft (id, prompt, revision, updated_at) VALUES (1, '保留原草稿', 1, '2026-09-27')").run();
    previous.db.exec('DROP TABLE image_studio_risk_checks');
    previous.db.pragma('user_version = 37');
    previous.close();
    const upgraded = createSqliteDatabase(fakeApp);
    assert.equal(upgraded.db.pragma('user_version', { simple: true }), 38);
    assert.ok(upgraded.db.prepare("SELECT name FROM sqlite_master WHERE name = 'image_studio_risk_checks'").get());
    assert.equal(upgraded.db.prepare('SELECT prompt FROM image_studio_draft WHERE id = 1').get().prompt, '保留原草稿');
    upgraded.close();
    assert.ok(fs.readdirSync(path.join(directory, 'workspace')).some((name) => name.includes('.backup-')));
    console.log('[studio-risk] Electron SQLite v37→v38, backup, draft preservation passed');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}, (error) => { console.error(error); app.exit(1); });
