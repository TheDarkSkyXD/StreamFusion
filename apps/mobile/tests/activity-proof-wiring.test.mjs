import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(
  new URL("../src/features/shell/components/app-shell.tsx", import.meta.url),
  "utf8",
);
const proofControl = await readFile(
  new URL(
    "../src/features/activity/components/development-activity-proof-control.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Diagnostics queues an Activity read failure only through the selected proof control", () => {
  assert.match(shell, /<DevelopmentActivityProofControl/);
  assert.match(shell, /onQueueReadFailure=\{onQueueActivityReadFailure\}/);
  assert.doesNotMatch(shell, /DevelopmentActivityReadFailureProofControl/);
  assert.doesNotMatch(shell, /run-development-activity-read-failure-proof/);
  assert.match(
    proofControl,
    /\{proofSelected \? \([\s\S]*?label="Queue Activity read failure"/,
  );
});
