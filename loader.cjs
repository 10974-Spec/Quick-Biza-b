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
const { pathToFileURL } = require('url');
const serverPath = path.join(__dirname, 'server.js');

// Dynamic import bridges CJS → ESM.
// Using pathToFileURL is REQUIRED on Windows because drive letters (C:\) 
// break dynamic imports by looking like URI protocols.
import(pathToFileURL(serverPath).href).catch((err) => {
    process.stderr.write(`[loader] Fatal: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});
