const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrateDatabase } = require('./migrations.cjs');

function createDatabaseService({ databasePath }) {
  if (!databasePath) throw new Error('databasePath is required');
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  if (databasePath !== ':memory:') database.pragma('journal_mode = WAL');

  const migrate = () => migrateDatabase(database);
  migrate();

  return {
    database,
    migrate,
    close: () => database.close(),
  };
}

module.exports = { createDatabaseService };
