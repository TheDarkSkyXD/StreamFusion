import { spawnSync } from "node:child_process";
import { npmInvocation } from "./package-command.mjs";

const { command, prefix } = npmInvocation();
const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
