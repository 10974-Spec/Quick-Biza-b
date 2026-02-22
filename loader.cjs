/**
 * backend/loader.cjs
 *
 * A CommonJS bootstrap that dynamically imports the ES-module server.
 * Electron's ELECTRON_RUN_AS_NODE mode runs CJS fine but silently fails on
 * ES-module entry points.  Dynamic import() works from CJS → ESM, so this
 * tiny wrapper is all we need.
 */
'use strict';

const path = require('path');
const serverPath = path.join(__dirname, 'server.js');

// Dynamic import bridges CJS → ESM
import(serverPath).catch((err) => {
    process.stderr.write(`[loader] Fatal: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});
