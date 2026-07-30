#!/usr/bin/env node
/**
 * Wrapper for `electron-vite dev` that unsets ELECTRON_RUN_AS_NODE before
 * spawning. When the env var is set (some IDE integrations leave it on),
 * Electron's child process boots as plain Node and `require("electron")`
 * returns the binary path string instead of the API module — main.ts then
 * crashes on `app.isPackaged`. This wrapper guarantees a clean env.
 */
"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const { createStartEnvironment } = require("./start-dev-lib");
// Resolve via package.json (which IS declared in electron-vite's `exports`
// map) and rebuild the bin path. Calling
// `require.resolve("electron-vite/bin/electron-vite.js")` directly throws
// ERR_PACKAGE_PATH_NOT_EXPORTED on Node >= 22.12 because the bin subpath
// isn't exposed in the package's exports. The bin file is still on disk
// (it's listed in package.json#bin); we just have to find it ourselves.
const electronViteBin = path.join(
  path.dirname(require.resolve("electron-vite/package.json")),
  "bin",
  "electron-vite.js"
);
void createStartEnvironment(process.env)
  .then((env) => {
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, [electronViteBin, "dev", ...process.argv.slice(2)], {
      env,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
  })
  .catch((error) => {
    console.error("Failed to prepare StreamFusion development:", error);
    process.exit(1);
  });
