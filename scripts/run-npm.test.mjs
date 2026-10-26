import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { npmInvocation } from "./package-command.mjs";

test("nested scripts reuse the npm CLI selected by the parent", () => {
  const { command, prefix } = npmInvocation();
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "run-npm.mjs"), "--version"],
    {
      env: { ...process.env, npm_execpath: prefix[0] },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const parent = spawnSync(command, [...prefix, "--version"], {
    encoding: "utf8",
  });
  assert.equal(result.stdout, parent.stdout);
});
