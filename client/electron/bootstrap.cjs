'use strict';

// Patch only the directory/content task runners before the normal Electron main process loads.
require('./services/guardedTaskService.cjs');
require('./main.cjs');
