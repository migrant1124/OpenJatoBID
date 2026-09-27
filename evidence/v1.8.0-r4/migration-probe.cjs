const fs = require('node:fs');
const path = require('node:path');
const Database = require('../../client/node_modules/better-sqlite3');
const { createSqliteDatabase } = require('../../client/electron/services/sqliteDatabase.cjs');

const local = process.env.LOCALAPPDATA;
const backup = fs.readdirSync(local).filter((name) => name.startsWith('OpenJatoBID-R4-backup-')).sort().at(-1);
if (!backup) throw new Error('缺少迁移前在线备份。');
const source = path.join(local, backup, 'yibiao.sqlite');
const userData = path.join(local, 'OpenJatoBID-R4-migration-test');
const workspace = path.join(userData, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const target = path.join(workspace, 'yibiao.sqlite');
fs.copyFileSync(source, target);
const app = { getPath: () => userData, once: () => {} };
const counts = (db) => Object.fromEntries(['image_studio_draft', 'image_studio_tasks',
  'image_studio_works', 'image_studio_assets', 'image_studio_sources',
  'image_studio_reference_items', 'image_studio_prompt_meta', 'prompt_items']
  .map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
const beforeDb = new Database(target, { readonly: true });
const before = { version: beforeDb.pragma('user_version', { simple: true }), counts: counts(beforeDb) };
beforeDb.close();
const first = createSqliteDatabase(app);
const after = { version: first.db.pragma('user_version', { simple: true }), counts: counts(first.db),
  newTables: ['image_studio_reference_favorites', 'image_studio_cover_cache',
    'image_studio_psd_sessions', 'image_studio_psd_layers'].every((name) => first.db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(name)) };
first.close();
const second = createSqliteDatabase(app);
const repeat = { version: second.db.pragma('user_version', { simple: true }), counts: counts(second.db) };
second.close();
const report = { backupFolder: path.join(local, backup), isolatedCopy: target, before, after, repeat,
  preserved: JSON.stringify(before.counts) === JSON.stringify(after.counts) && JSON.stringify(after.counts) === JSON.stringify(repeat.counts) };
fs.writeFileSync(path.join(__dirname, 'migration-result.json'), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report));
if (!report.preserved || after.version !== 36 || repeat.version !== 36) process.exitCode = 1;
