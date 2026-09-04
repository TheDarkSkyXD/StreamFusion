import { spawn as spawnChild } from "node:child_process";

export const START_PROMPT = [
  "",
  "How would you like to start StreamFusion?",
  "  1) Electron",
  "  2) Browser",
  "  3) Mobile (Expo Go)",
  "  4) E2E Preview",
  "",
  "Choose a start mode [1]: ",
].join("\n");

export const START_TARGETS = Object.freeze([
  Object.freeze({ answer: "1", name: "electron", script: "desktop" }),
  Object.freeze({ answer: "2", name: "browser", script: "browser" }),
  Object.freeze({ answer: "3", name: "mobile", script: "mobile" }),
  Object.freeze({ answer: "4", name: "e2e-preview", script: "e2e:preview" }),
]);

export async function chooseStartTarget({ interactive, ask }) {
  if (!interactive) return START_TARGETS[0];

  const answer = (await ask(START_PROMPT)).trim().toLowerCase();
  return (
    START_TARGETS.find(
      (target) => target.answer === answer || target.name === answer,
    ) ?? START_TARGETS[0]
  );
}

export function launchRootScript(
  target,
  {
    spawn = spawnChild,
    cwd = process.cwd(),
    env = process.env,
    platform = process.platform,
    execPath = process.execPath,
    forwardArgs = [],
  } = {},
) {
  const npmCli = env.npm_execpath;
  const command = npmCli ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = npmCli ? [npmCli, "run", target.script] : ["run", target.script];
  if (forwardArgs.length > 0) args.push("--", ...forwardArgs);

  const child = spawn(command, args, { cwd, env, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function runStartPicker({ interactive, ask, launch }) {
  const target = await chooseStartTarget({ interactive, ask });
  return launch(target);
}
