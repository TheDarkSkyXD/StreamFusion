import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { buildInventory } from "../../scripts/desktop-parity-inventory.mjs";

type ManualLedger = NonNullable<NonNullable<Parameters<typeof buildInventory>[0]>["manualLedger"]>;

const repositoryRoot = join(__dirname, "../../../..");
const temporaryDirectories: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isCapability(value: unknown): value is ManualLedger["capabilities"][number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.area === "string" &&
    typeof value.outcome === "string" &&
    isStringArray(value.entry) &&
    isStringArray(value.renderer) &&
    isStringArray(value.electronBoundary) &&
    isStringArray(value.mainProcess) &&
    isStringArray(value.platformBranches) &&
    isStringArray(value.state) &&
    isStringArray(value.persistence) &&
    isStringArray(value.verification)
  );
}

function isIgnoredFact(value: unknown): value is ManualLedger["ignoredFacts"][number] {
  return isRecord(value) && typeof value.factId === "string" && typeof value.reason === "string";
}

function manualLedger(): ManualLedger {
  const parsed: unknown = JSON.parse(
    readFileSync(
      join(repositoryRoot, "apps/desktop/scripts/desktop-parity-capabilities.json"),
      "utf8"
    )
  );
  if (!isManualLedger(parsed)) {
    throw new Error("The Desktop parity ledger fixture is invalid");
  }
  return parsed;
}

function isManualLedger(value: unknown): value is ManualLedger {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === "number" &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every(isCapability) &&
    Array.isArray(value.ignoredFacts) &&
    value.ignoredFacts.every(isIgnoredFact)
  );
}

function capabilities(ledger: ManualLedger) {
  return ledger.capabilities;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

// Guards: a source change cannot silently alter the inventory bytes produced for the same Desktop tree.
// Guards: every discovered Desktop structural boundary remains assigned to a capability or an explicit reason.
describe("desktop parity inventory", () => {
  it("builds deterministic inventory from the real Desktop source", () => {
    const first = buildInventory({ repositoryRoot });
    const second = buildInventory({ repositoryRoot });

    expect(second).toEqual(first);
    expect(first.inventory.capabilities.length).toBeGreaterThan(1);
    expect(first.inventory.facts.length).toBeGreaterThan(50);
  });

  it("keeps capability fact IDs stable when routes and endpoints live in feature roots", () => {
    const { inventory } = buildInventory({ repositoryRoot });
    const facts = new Map(inventory.facts.map((fact) => [fact.id, fact]));

    expect(facts.get("ipc-handler:chat-handlers")?.sourcePath).toBe(
      "apps/desktop/src/backend/features/chat/routes/chat-routes.ts"
    );
    expect(facts.get("ipc-handler:timeout-moderation-handlers")?.sourcePath).toBe(
      "apps/desktop/src/backend/features/moderation/routes/timeout-routes.ts"
    );
    expect(facts.get("platform-endpoint:kick:search-endpoints")?.sourcePath).toBe(
      "apps/desktop/src/backend/features/discovery/adapters/kick/search-endpoints.ts"
    );
    expect(
      inventory.facts.some(
        (fact) => fact.sourcePath.includes("/tests/") || /\.(?:test|stories)\./.test(fact.sourcePath)
      )
    ).toBe(false);
  });

  it("rejects a discovered fact without a manual capability assignment", () => {
    const ledger = manualLedger();
    capabilities(ledger)[0].renderer = [];

    expect(() => buildInventory({ repositoryRoot, manualLedger: ledger })).toThrow(
      "Discovered facts are unmapped"
    );
  });

  it("rejects stale fact references, persistence paths, and verification patterns", () => {
    const staleFact = manualLedger();
    capabilities(staleFact)[0].renderer = ["renderer-feature:missing"];
    expect(() => buildInventory({ repositoryRoot, manualLedger: staleFact })).toThrow(
      "references missing fact"
    );

    const stalePath = manualLedger();
    capabilities(stalePath)[0].persistence = ["apps/desktop/missing-persistence.ts"];
    expect(() => buildInventory({ repositoryRoot, manualLedger: stalePath })).toThrow(
      "missing persistence path"
    );

    const staleGlob = manualLedger();
    capabilities(staleGlob)[0].verification = ["apps/desktop/tests/no-match-*.test.ts"];
    expect(() => buildInventory({ repositoryRoot, manualLedger: staleGlob })).toThrow(
      "verification pattern matches no files"
    );
  });

  it("detects report drift without rewriting the report", () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-parity-"));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, "desktop-parity-inventory.md");
    writeFileSync(reportPath, "stale report", "utf8");

    expect(() => buildInventory({ repositoryRoot, checkReportPath: reportPath })).toThrow(
      "out of date"
    );
    expect(readFileSync(reportPath, "utf8")).toBe("stale report");
  });
});
