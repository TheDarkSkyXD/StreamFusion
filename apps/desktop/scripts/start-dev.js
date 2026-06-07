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
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.execPath,
  [require.resolve("electron-vite/bin/electron-vite.js"), "dev", ...process.argv.slice(2)],
  {
    env,
    stdio: "inherit",
  }
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
