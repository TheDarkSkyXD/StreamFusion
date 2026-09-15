import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./drive-issue-161-adblock.mjs", import.meta.url))],
  {
    cwd: process.cwd(),
    env: { ...process.env, WATCH_ONLY: "1" },
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
