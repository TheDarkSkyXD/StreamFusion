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
const reportPath = path.join(
  repositoryRoot,
  "docs/research/streamfusion-mobile/coverage-matrix.md",
);

test("coverage matrix reconciles prototype, contract, and shell routes", () => {
  const ledgerBefore = readFileSync(ledgerPath);
  const reportBefore = readFileSync(reportPath);
  const result = spawnSync(process.execPath, [checker], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Mobile coverage matrix:/);
  assert.ok(
    ledgerBefore.equals(readFileSync(ledgerPath)),
    "coverage-matrix-ledger.json changed; committed artifact is stale",
  );
  assert.ok(
    reportBefore.equals(readFileSync(reportPath)),
    "coverage-matrix.md changed; committed artifact is stale",
  );

  const ledger = JSON.parse(ledgerBefore.toString("utf8"));
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.issue, 195);
  assert.equal(ledger.totals.discovered, 185);
  assert.equal(ledger.totals.implemented, 117);
  assert.equal(ledger.totals.partial, 11);
  assert.equal(ledger.totals.placeholder, 4);
  assert.equal(ledger.totals.missing, 53);
  assert.equal(ledger.gaps.length, 5);
  assert.ok(ledger.gaps.some((gap) => gap.id === "GAP-195-01"));
  assert.ok(
    ledger.entries.some(
      (entry) => entry.id === "shell-route:activity" && entry.status === "implemented",
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) =>
        entry.id === "shell-route:more/category-detail" &&
        entry.status === "implemented",
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) => entry.id === "panel:proxy" && entry.status === "implemented",
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) => entry.id === "panel:adblock" && entry.status === "implemented",
    ),
  );
  for (const id of [
    "panel:chat",
    "panel:predictions",
    "panel:integrations",
    "panel:api-tokens",
    "screen:settings-chat",
    "screen:settings-predictions",
    "screen:settings-integrations",
    "screen:settings-api-tokens",
  ]) {
    assert.ok(
      ledger.entries.some(
        (entry) => entry.id === id && entry.status === "implemented",
      ),
      `${id} must stay implemented`,
    );
  }
  assert.ok(
    ledger.entries.some(
      (entry) =>
        entry.id === "screen:settings-adblock" && entry.status === "implemented",
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) =>
        entry.id === "shell-route:activity/job-preview" &&
        entry.status === "implemented" &&
        entry.owners.includes(163),
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) =>
        entry.id === "shell-route:more/settings" &&
        entry.status === "implemented" &&
        entry.owners.includes(167),
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) =>
        entry.id === "action:channel-follow" && entry.status === "implemented",
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) => entry.id === "screen:watch" && entry.status === "implemented",
    ),
  );
  assert.ok(
    ledger.entries.some(
      (entry) =>
        entry.id === "shell-route:watch/session-preview" &&
        entry.status === "implemented",
    ),
  );
  for (const id of [
    "tab:search:all",
    "tab:category-detail:clips",
    "tab:channel:home",
    "tab:following:live",
    "action:player-play-pause",
    "action:player-pip",
    "action:player-seek-back",
    "action:player-seek-forward",
    "action:mini-player-pause",
    "action:dismiss-player",
    "screen:video",
    "tab:watch:info",
    "tab:watch:related",
    "screen:history",
    "shell-route:more/history",
    "action:history-clear",
    "action:history-remove",
    "screen:multi",
    "shell-route:more/multistream",
    "action:multistream-add",
    "action:multistream-edit",
    "action:audio-owner",
    "action:restore-slot",
    "action:cool-device",
  ]) {
    assert.ok(
      ledger.entries.some(
        (entry) => entry.id === id && entry.status === "implemented",
      ),
      `${id} must stay implemented`,
    );
  }
});
