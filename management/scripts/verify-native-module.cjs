const path = require('node:path');

const moduleRoot = path.resolve(process.argv[2]);
const Database = require(moduleRoot);
const database = new Database(':memory:');
database.close();

console.log('native-module-load: PASS');
