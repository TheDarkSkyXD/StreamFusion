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
 * @typedef {{ kind: "launch"; mode: "dev:electron" | "dev" }
 *   | { kind: "unavailable"; name: "Mobile" }} StartSelection
 */

const START_PROMPT = [
  "",
  "How would you like to start StreamFusion?",
  "  1) Electron",
  "  2) Browser",
  "  3) Mobile",
  "",
  "Choose a start mode [1]: ",
].join("\n");

/**
 * Resolve the start selection made by the user.
 *
 * @param {{ interactive: boolean; ask: (prompt: string) => Promise<string> }} options
 * @returns {Promise<StartSelection>}
 */
async function chooseStartSelection({ interactive, ask }) {
  if (!interactive) return { kind: "launch", mode: "dev:electron" };

  const answer = (await ask(START_PROMPT)).trim();
  if (answer === "" || answer === "1") {
    return { kind: "launch", mode: "dev:electron" };
  }
  if (answer === "2") return { kind: "launch", mode: "dev" };
  if (answer === "3") return { kind: "unavailable", name: "Mobile" };
  return { kind: "launch", mode: "dev:electron" };
}

/**
 * Pick and launch one of the public development scripts.
 *
 * @param {{
 *   interactive: boolean;
 *   ask: (prompt: string) => Promise<string>;
 *   launch: (mode: "dev:electron" | "dev") => Promise<number>;
 *   reportUnavailable?: (message: string) => void;
 * }} options
 * @returns {Promise<number>}
 */
async function runStartPicker({ interactive, ask, launch, reportUnavailable = console.error }) {
  const selection = await chooseStartSelection({ interactive, ask });
  if (selection.kind === "unavailable") {
    reportUnavailable(`StreamFusion ${selection.name} is not implemented yet.`);
    return 1;
  }

  return launch(selection.mode);
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
  chooseStartSelection,
  launchStartMode,
  runStartPicker,
};
