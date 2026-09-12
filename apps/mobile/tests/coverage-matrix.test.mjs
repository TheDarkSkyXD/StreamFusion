import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const checker = path.join(
  repositoryRoot,
  "docs/research/streamfusion-mobile/coverage-matrix-check.mjs",
);
const ledgerPath = path.join(
  repositoryRoot,
  "docs/research/streamfusion-mobile/coverage-matrix-ledger.json",
);

test("coverage matrix reconciles prototype, contract, and shell routes", () => {
  const result = spawnSync(process.execPath, [checker], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Mobile coverage matrix:/);

  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.issue, 195);
  assert.equal(ledger.totals.discovered, 182);
  assert.equal(ledger.totals.implemented, 12);
  assert.equal(ledger.totals.partial, 13);
  assert.equal(ledger.totals.placeholder, 23);
  assert.equal(ledger.totals.missing, 134);
  assert.equal(ledger.gaps.length, 5);
  assert.ok(ledger.gaps.some((gap) => gap.id === "GAP-195-01"));
  assert.ok(
    ledger.entries.some(
      (entry) => entry.id === "shell-route:activity" && entry.status === "implemented",
    ),
  );
});
