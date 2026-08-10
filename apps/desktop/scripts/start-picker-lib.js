"use strict";

const { spawn: spawnChild } = require("node:child_process");
const path = require("node:path");

/**
 * @typedef {{
 *   once(event: "error", listener: (error: Error) => void): unknown;
 *   once(event: "exit", listener: (code: number | null) => void): unknown;
 * }} StartChild
 * @typedef {(command: string, args: string[], options: {
 *   cwd: string;
 *   env: NodeJS.ProcessEnv;
 *   stdio: "inherit";
 * }) => StartChild} StartSpawn
 */

const START_PROMPT = [
  "",
  "How would you like to start StreamFusion?",
  "  1) Electron app only (default)",
  "  2) Electron app + browser",
  "",
  "Choose a start mode [1]: ",
].join("\n");

/**
 * Resolve the start mode selected by the user.
 *
 * @param {{ interactive: boolean; ask: (prompt: string) => Promise<string> }} options
 * @returns {Promise<"dev:electron" | "dev">}
 */
async function chooseStartMode({ interactive, ask }) {
  if (!interactive) return "dev:electron";

  const answer = (await ask(START_PROMPT)).trim();
  if (answer === "" || answer === "1") return "dev:electron";
  if (answer === "2") return "dev";
  return "dev:electron";
}

/**
 * Pick and launch one of the public development scripts.
 *
 * @param {{
 *   interactive: boolean;
 *   ask: (prompt: string) => Promise<string>;
 *   launch: (mode: "dev:electron" | "dev") => Promise<number>;
 * }} options
 * @returns {Promise<number>}
 */
async function runStartPicker({ interactive, ask, launch }) {
  const mode = await chooseStartMode({ interactive, ask });
  return launch(mode);
}

/**
 * Launch the shared development entry point without another package-manager process.
 *
 * @param {"dev" | "dev:electron"} mode
 * @param {{
 *   spawn?: StartSpawn;
 *   execPath?: string;
 *   cwd?: string;
 *   env?: NodeJS.ProcessEnv;
 *   electronArgs?: readonly string[];
 * }} [options]
 * @returns {Promise<number>}
 */
function launchStartMode(
  mode,
  {
    spawn = spawnChild,
    execPath = process.execPath,
    cwd = process.cwd(),
    env = process.env,
    electronArgs = [],
  } = {}
) {
  const launchEnv = { ...env };
  if (mode === "dev") launchEnv.STREAMFUSION_BROWSER_DEV = "1";

  const startArgs = [path.resolve(__dirname, "start-dev.js")];
  if (electronArgs.length > 0) startArgs.push("--", ...electronArgs);

  const child = spawn(execPath, startArgs, {
    cwd,
    env: launchEnv,
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

module.exports = {
  START_PROMPT,
  chooseStartMode,
  launchStartMode,
  runStartPicker,
};
