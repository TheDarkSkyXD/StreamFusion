import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGateRunner } from "./android-gates/create-gate-runner.mjs";
import {
  GATE_DEFINITIONS,
  slotsFor,
} from "./android-gates/registry.mjs";
import {
  evaluateGate,
  hasCleanCandidatePair,
} from "./android-gates/gate-run.mjs";

const NOW = "2026-09-12T00:00:00.000Z";
const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const policy = JSON.parse(
  await readFile("verification/evidence-policy.json", "utf8"),
);

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function record(id, overrides = {}) {
  return {
    id,
    sourceCommit: COMMIT,
    apkDigest: null,
    verifierVersion: "1.0.0",
    testVersion: "android-gates@1;retry=unused",
    environment: { gate: "candidate", retention: "main", name: "test" },
    device: { kind: "none", profile: null, apiLevel: null },
    artifacts: [
      {
        id: "report",
        path: `evidence/${id}.json`,
        sha256: hash(id),
        mediaType: "application/json",
      },
    ],
    result: "pass",
    observedAt: NOW,
    expiresAt: "2026-09-19T00:00:00.000Z",
    links: [],
    ...overrides,
  };
}

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "android-gates-"));
  try {
    await mkdir(path.join(root, "verification"));
    await writeFile(
      path.join(root, "verification/evidence-policy.json"),
      JSON.stringify(policy),
    );
    await writeFile(
      path.join(root, "catalog.json"),
      JSON.stringify({
        schemaVersion: 2,
        policyVersion: 1,
        verifierVersion: "1.0.0",
        capabilities: {},
        gateRuns: {},
      }),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function passingFill() {
  return { kind: "pass", observedAt: NOW, artifacts: [], apkDigest: null };
}

test("evaluateGate rejects a missing required slot", () => {
  const verdict = evaluateGate({
    definition: GATE_DEFINITIONS.change,
    records: [],
    sourceCommit: COMMIT,
    apkDigest: null,
    now: NOW,
    policy,
  });

  assert.equal(verdict.pass, false);
  assert.equal(verdict.reason, "missing-slot");
});

test("evaluateGate rejects stale proof using its injected clock", () => {
  const slots = slotsFor("change");
  const records = slots.map((slot) =>
    record(slot.id, {
      environment: { gate: "change", retention: "development", name: "test" },
      observedAt: "2026-09-01T00:00:00.000Z",
    }),
  );
  const verdict = evaluateGate({
    definition: GATE_DEFINITIONS.change,
    records,
    sourceCommit: COMMIT,
    apkDigest: null,
    now: NOW,
    policy,
  });

  assert.equal(verdict.pass, false);
  assert.equal(verdict.reason, "stale");
});

test("public release records an absent signed APK instead of rejecting input", async () => {
  await fixture(async (root) => {
    const runner = createGateRunner({
      repositoryRoot: root,
      catalogPath: path.join(root, "catalog.json"),
      outputPath: path.join(root, "output.json"),
      owner: async () => passingFill(),
    });
    const result = await runner.run({
      gate: "public-release",
      runId: "public-without-apk",
      now: NOW,
      sourceCommit: COMMIT,
    });
    const catalog = JSON.parse(
      await readFile(path.join(root, "output.json"), "utf8"),
    );

    assert.equal(result.pass, false);
    assert.equal(
      catalog.gateRuns["public-without-apk"].find(
        (entry) => entry.id === "signed-apk",
      ).result,
      "fail",
    );
  });
});

test("candidate records absent physical-device proof", async () => {
  await fixture(async (root) => {
    const apkPath = path.join(root, "app.apk");
    await writeFile(apkPath, "apk");
    const runner = createGateRunner({
      repositoryRoot: root,
      catalogPath: path.join(root, "catalog.json"),
      outputPath: path.join(root, "output.json"),
      owner: async (slot) =>
        slot.owner === "physical-journey"
          ? undefined
          : { ...passingFill(), apkDigest: DIGEST },
    });
    await runner.run({
      gate: "candidate",
      runId: "candidate-without-device",
      apkPath,
      apkDigest: hash("apk"),
      now: NOW,
      sourceCommit: COMMIT,
    });
    const catalog = JSON.parse(
      await readFile(path.join(root, "output.json"), "utf8"),
    );

    assert.equal(
      catalog.gateRuns["candidate-without-device"].find(
        (entry) => entry.id === "physical-mainstream-phone",
      ).result,
      "fail",
    );
  });
});

test("quarantine-block fails a gate with quarantined evidence", async () => {
  await fixture(async (root) => {
    const quarantined = record("workspace-static", {
      environment: { gate: "change", retention: "development", name: "test" },
      result: "quarantined",
    });
    await writeFile(
      path.join(root, "catalog.json"),
      JSON.stringify({
        schemaVersion: 2,
        policyVersion: 1,
        verifierVersion: "1.0.0",
        capabilities: {},
        gateRuns: { quarantined: [quarantined] },
      }),
    );
    const runner = createGateRunner({
      repositoryRoot: root,
      catalogPath: path.join(root, "catalog.json"),
      outputPath: path.join(root, "output.json"),
      owner: async () => passingFill(),
    });
    const result = await runner.run({
      gate: "change",
      runId: "quarantined",
      now: NOW,
      sourceCommit: COMMIT,
    });

    assert.equal(result.pass, false);
    assert.equal(result.reason, "quarantined");
  });
});

test("diagnostic retry retains its original proof and taints candidates", async () => {
  await fixture(async (root) => {
    const apkPath = path.join(root, "app.apk");
    await writeFile(apkPath, "apk");
    let attempts = 0;
    const runner = createGateRunner({
      repositoryRoot: root,
      catalogPath: path.join(root, "catalog.json"),
      outputPath: path.join(root, "output.json"),
      owner: async (slot) => {
        if (slot.id === "tablet-emulator-smoke" && attempts++ === 0) {
          return { kind: "infrastructure-failure", observedAt: NOW, artifacts: [], detail: "network" };
        }
        return { ...passingFill(), apkDigest: hash("apk") };
      },
    });
    await runner.run({
      gate: "candidate",
      runId: "retried-candidate",
      apkPath,
      apkDigest: hash("apk"),
      now: NOW,
      sourceCommit: COMMIT,
    });
    const catalog = JSON.parse(
      await readFile(path.join(root, "output.json"), "utf8"),
    );
    const run = catalog.gateRuns["retried-candidate"];

    assert.ok(run.some((entry) => entry.id === "tablet-emulator-smoke-original"));
    assert.equal(
      hasCleanCandidatePair({ gateRuns: { "retried-candidate": run } }, hash("apk")),
      false,
    );
  });
});

test("two clean candidate runs satisfy the public-release predicate", () => {
  const candidate = (runId) => [
    record("candidate-gate", { apkDigest: DIGEST }),
    record("diagnostic-retry", { apkDigest: DIGEST }),
  ];
  assert.equal(
    hasCleanCandidatePair({
      gateRuns: { "candidate-one": candidate("candidate-one"), "candidate-two": candidate("candidate-two") },
    }, DIGEST),
    true,
  );
});
