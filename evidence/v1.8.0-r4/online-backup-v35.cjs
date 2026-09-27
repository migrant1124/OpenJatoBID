const fs = require('node:fs');
const path = require('node:path');
const Database = require('../../client/node_modules/better-sqlite3');

async function main() {
  const source = path.join(process.env.APPDATA, 'jatoaibid/workspace/yibiao.sqlite');
  const directory = path.join(process.env.LOCALAPPDATA,
    `OpenJatoBID-R4-backup-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'yibiao.sqlite');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const before = db.pragma('user_version', { simple: true });
    await db.backup(target);
    const copy = new Database(target, { readonly: true, fileMustExist: true });
    const after = copy.pragma('user_version', { simple: true });
    const integrity = copy.pragma('integrity_check', { simple: true });
    const report = { source, target, before, after, integrity, bytes: fs.statSync(target).size };
    copy.close();
    fs.writeFileSync(path.join(__dirname, 'online-backup-v35-result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
    if (before !== after || integrity !== 'ok') process.exitCode = 1;
  } finally { db.close(); }
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exitCode = 1; });
