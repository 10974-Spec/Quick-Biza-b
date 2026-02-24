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

const fs = require('fs');

// Dynamic import bridges CJS → ESM.
// Using pathToFileURL is REQUIRED on Windows because drive letters (C:\) 
// break dynamic imports by looking like URI protocols.
import(pathToFileURL(serverPath).href).catch((err) => {
    const logPath = process.env.USER_DATA_PATH
        ? path.join(process.env.USER_DATA_PATH, 'quickbiza-backend.log')
        : path.join(__dirname, 'error.log');

    const msg = `\n[FATAL BACKEND CRASH] ${new Date().toISOString()}:\n${err.message}\n${err.stack}\n`;
    try { fs.appendFileSync(logPath, msg); } catch (e) { }

    process.stderr.write(msg);
    // CRITICAL: DO NOT call process.exit(1) here! 
    // It will instantly close the entire Electron GUI since we are in-process.
});
