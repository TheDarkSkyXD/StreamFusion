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
 * Launch a public npm development script without adding another shell layer.
 *
 * @param {"dev" | "dev:electron" | "dev:mcp"} mode
 * @param {{
 *   spawn?: StartSpawn;
 *   platform?: NodeJS.Platform;
 *   execPath?: string;
 *   cwd?: string;
 *   env?: NodeJS.ProcessEnv;
 * }} [options]
 * @returns {Promise<number>}
 */
function launchNpmScript(
  mode,
  {
    spawn = spawnChild,
    platform = process.platform,
    execPath = process.execPath,
    cwd = process.cwd(),
    env = process.env,
  } = {}
) {
  const npmExecPath =
    env.npm_execpath ||
    (platform === "win32"
      ? path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : null);
  const command = npmExecPath ? execPath : "npm";
  const args = npmExecPath ? [npmExecPath, "run", mode] : ["run", mode];
  const child = spawn(command, args, {
    cwd,
    env,
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
  launchNpmScript,
  runStartPicker,
};
