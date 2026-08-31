import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { launchRootScript, runStartPicker } from "./start-picker-lib.mjs";

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const prompt = interactive
  ? createInterface({ input: process.stdin, output: process.stdout })
  : undefined;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

try {
  process.exitCode = await runStartPicker({
    interactive,
    ask: (question) => prompt?.question(question) ?? Promise.resolve(""),
    launch: (target) =>
      launchRootScript(target, {
        cwd: repositoryRoot,
        forwardArgs: process.argv.slice(2),
      }),
  });
} catch (error) {
  console.error("Failed to start StreamFusion:", error);
  process.exitCode = 1;
} finally {
  prompt?.close();
}
