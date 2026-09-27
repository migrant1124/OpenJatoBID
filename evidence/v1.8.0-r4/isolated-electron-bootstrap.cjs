const path = require('node:path');
const { app } = require('electron');

app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'OpenJatoBID-R4-electron', 'jatoaibid'));
process.env.R4_DISABLE_SOURCE_SYNC = '1';
require('../../client/electron/bootstrap.cjs');
