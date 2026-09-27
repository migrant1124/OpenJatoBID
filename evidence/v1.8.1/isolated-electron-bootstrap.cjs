const path = require('node:path');
const { app } = require('electron');

app.setPath('userData', path.join(__dirname, '../../.tmp/v181-electron-userdata'));
process.env.R4_DISABLE_SOURCE_SYNC = '1';
require('../../client/electron/bootstrap.cjs');
