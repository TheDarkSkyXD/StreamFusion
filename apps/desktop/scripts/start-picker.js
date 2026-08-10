#!/usr/bin/env node
"use strict";

const path = require("node:path");
const readline = require("node:readline");

const { launchStartMode, runStartPicker } = require("./start-picker-lib");

const interactive = Boolean(process.stdin.isTTY);
let prompt;

if (interactive) {
  prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

const ask = (question) =>
  new Promise((resolve) => {
    if (!prompt) {
      resolve("");
      return;
    }
    prompt.question(question, resolve);
  });

runStartPicker({
  interactive,
  ask,
  launch: (mode) =>
    launchStartMode(mode, {
      cwd: path.resolve(__dirname, ".."),
      electronArgs: process.argv.slice(2),
    }),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("Failed to start StreamFusion:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    prompt?.close();
  });
