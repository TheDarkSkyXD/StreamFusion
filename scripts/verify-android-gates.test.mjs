import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { evidenceRecord, loadCatalog } from "./android-gates/catalog-store.mjs";
import { isFresh } from "./android-gates/freshness.mjs";
import { createOwners } from "./android-gates/owners.mjs";
import { assertRunId, validateCatalog } from "./verify-evidence.mjs";
import { parseArguments } from "./verify-android-gates.mjs";

const NOW = "2026-09-12T00:00:00.000Z";
const FUTURE = "2026-09-13T00:00:00.000Z";
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

test("GitHub Actions workflows do not enable KVM or android-emulator-runner", async () => {
  const files = (await readdir(".github/workflows")).filter((name) =>
    name.endsWith(".yml") || name.endsWith(".yaml"),
  );
  for (const name of files) {
    const source = await readFile(`.github/workflows/${name}`, "utf8");
    assert.doesNotMatch(
      source,
      /android-emulator-runner|\/dev\/kvm|Enable KVM/,
      name,
    );
    assert.doesNotMatch(source, /name:\s*.*\$\{\{\s*env\./, name);
  }
});

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

test("parseArguments rejects a run id that is not a single path-safe segment", () => {
  const commit = ["--source-commit", COMMIT];
  for (const runId of ["../escape", "foo/bar", "foo\\bar", "..", ".", "/tmp/abs"]) {
    assert.throws(
      () => parseArguments(["--gate", "change", "--run-id", runId, ...commit]),
      /--run-id/,
    );
  }
  assert.equal(
    parseArguments(["--gate", "change", "--run-id", "12345-change", ...commit]).runId,
    "12345-change",
  );
});

test("validateCatalog rejects a gateRuns key that is not a single path-safe segment", () => {
  const catalog = {
    schemaVersion: 2,
    policyVersion: 1,
    verifierVersion: "1.0.0",
    capabilities: {},
    gateRuns: { "../escape": [] },
  };
  assert.throws(() => validateCatalog(catalog, policy), /catalog\.gateRuns/);
});

test("evaluateGate rejects future-dated proof using its injected clock", () => {
  const slots = slotsFor("change");
  const records = slots.map((slot) =>
    record(slot.id, {
      environment: { gate: "change", retention: "development", name: "test" },
      observedAt: FUTURE,
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

test("isFresh returns false when observedAt is after evaluatedAt", () => {
  const exact = slotsFor("change").find((slot) => slot.id === "workspace-static");
  const signer = slotsFor("public-release").find((slot) => slot.id === "signer-recovery");
  assert.equal(isFresh(exact, { observedAt: FUTURE }, NOW, policy), false);
  assert.equal(isFresh(signer, { observedAt: FUTURE }, NOW, policy), false);
  assert.equal(isFresh(exact, { observedAt: NOW }, NOW, policy), true);
});

test("evidenceRecord uses the evaluation clock when fill.observedAt is in the future", async () => {
  await fixture(async (root) => {
    const entry = await evidenceRecord({
      repositoryRoot: root,
      run: {
        runId: "safe-run",
        definition: { id: "change", retention: "development" },
        sourceCommit: COMMIT,
        apkDigest: null,
      },
      slot: { id: "change-gate", deviceRole: "none", binding: "none" },
      fill: { kind: "pass", observedAt: FUTURE },
      now: NOW,
    });
    assert.equal(entry.observedAt, NOW);
  });
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
      hasCleanCandidatePair(
        { gateRuns: { "retried-candidate": run } },
        hash("apk"),
        NOW,
        policy,
      ),
      false,
    );
  });
});

test("two clean candidate runs satisfy the public-release predicate", () => {
  const candidate = () => [
    record("candidate-gate", { apkDigest: DIGEST }),
    record("diagnostic-retry", { apkDigest: DIGEST }),
  ];
  assert.equal(
    hasCleanCandidatePair({
      gateRuns: { "candidate-one": candidate(), "candidate-two": candidate() },
    }, DIGEST, NOW, policy),
    true,
  );
});

test("hasCleanCandidatePair rejects records without candidate provenance", () => {
  const stolen = [
    record("candidate-gate", {
      apkDigest: DIGEST,
      environment: { gate: "change", retention: "development", name: "test" },
    }),
    record("diagnostic-retry", {
      apkDigest: DIGEST,
      environment: { gate: "change", retention: "development", name: "test" },
    }),
  ];
  assert.equal(
    hasCleanCandidatePair(
      { gateRuns: { "stolen-one": stolen, "stolen-two": stolen } },
      DIGEST,
      NOW,
      policy,
    ),
    false,
  );
});

test("hasCleanCandidatePair rejects stale archived candidate runs", () => {
  const stale = [
    record("candidate-gate", { apkDigest: DIGEST, observedAt: "2026-09-01T00:00:00.000Z" }),
    record("diagnostic-retry", { apkDigest: DIGEST, observedAt: "2026-09-01T00:00:00.000Z" }),
  ];
  assert.equal(
    hasCleanCandidatePair(
      { gateRuns: { "stale-one": stale, "stale-two": stale } },
      DIGEST,
      NOW,
      policy,
    ),
    false,
  );
});

test("fillSummary recomputes after a prerequisite record changes", async () => {
  await fixture(async (root) => {
    const changeEnvironment = { gate: "change", retention: "development", name: "test" };
    await writeFile(
      path.join(root, "catalog.json"),
      JSON.stringify({
        schemaVersion: 2,
        policyVersion: 1,
        verifierVersion: "1.0.0",
        capabilities: {},
        gateRuns: {
          "stale-summary": [
            record("workspace-static", { result: "fail", environment: changeEnvironment }),
            record("change-gate", { result: "pass", environment: changeEnvironment }),
          ],
        },
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
      runId: "stale-summary",
      now: NOW,
      sourceCommit: COMMIT,
    });
    const catalog = JSON.parse(await readFile(path.join(root, "output.json"), "utf8"));

    assert.equal(result.pass, false);
    assert.equal(
      catalog.gateRuns["stale-summary"].find((entry) => entry.id === "change-gate").result,
      "fail",
    );
  });
});

test("createOwners reject stale catalog evidence", async () => {
  const owners = createOwners({ repositoryRoot: process.cwd() });
  const slot = slotsFor("main").find((item) => item.id === "change-gate");
  const fill = await owners(slot, {
    catalog: {
      gateRuns: {
        other: [
          record("change-gate", {
            environment: { gate: "change", retention: "development", name: "test" },
            observedAt: "2026-09-01T00:00:00.000Z",
          }),
        ],
      },
    },
    sourceCommit: COMMIT,
    apkDigest: null,
    now: NOW,
    policy,
  });
  assert.equal(fill.kind, "fail");
});

test("createOwners reject unstructured approval evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "android-owners-"));
  const previous = process.env.ANDROID_GATE_APPROVALS_EVIDENCE;
  process.env.ANDROID_GATE_APPROVALS_EVIDENCE = "approvals.json";
  try {
    await writeFile(path.join(root, "approvals.json"), "");
    const owners = createOwners({ repositoryRoot: root });
    const slot = slotsFor("public-release").find((item) => item.id === "approvals");
    const fill = await owners(slot, {
      sourceCommit: COMMIT,
      apkDigest: DIGEST,
      now: NOW,
      policy,
      repositoryRoot: root,
    });
    assert.equal(fill.kind, "fail");
  } finally {
    if (previous === undefined) delete process.env.ANDROID_GATE_APPROVALS_EVIDENCE;
    else process.env.ANDROID_GATE_APPROVALS_EVIDENCE = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("createOwners accept structured approval evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "android-owners-"));
  const previous = process.env.ANDROID_GATE_APPROVALS_EVIDENCE;
  process.env.ANDROID_GATE_APPROVALS_EVIDENCE = "approvals.json";
  try {
    await writeFile(
      path.join(root, "approvals.json"),
      JSON.stringify({
        result: "pass",
        observedAt: NOW,
        sourceCommit: COMMIT,
        apkDigest: DIGEST,
      }),
    );
    const owners = createOwners({ repositoryRoot: root });
    const slot = slotsFor("public-release").find((item) => item.id === "approvals");
    const fill = await owners(slot, {
      sourceCommit: COMMIT,
      apkDigest: DIGEST,
      now: NOW,
      policy,
      repositoryRoot: root,
    });
    assert.equal(fill.kind, "pass");
    assert.equal(fill.artifacts[0].id, "source-evidence");
  } finally {
    if (previous === undefined) delete process.env.ANDROID_GATE_APPROVALS_EVIDENCE;
    else process.env.ANDROID_GATE_APPROVALS_EVIDENCE = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("evidenceRecord expires from accepted observedAt", async () => {
  await fixture(async (root) => {
    const entry = await evidenceRecord({
      repositoryRoot: root,
      run: {
        runId: "expiry-run",
        definition: { id: "change", retention: "development" },
        sourceCommit: COMMIT,
        apkDigest: null,
      },
      slot: { id: "change-gate", deviceRole: "none", binding: "none" },
      fill: { kind: "pass", observedAt: "2026-09-11T00:00:00.000Z" },
      now: NOW,
    });
    assert.equal(entry.observedAt, "2026-09-11T00:00:00.000Z");
    assert.equal(entry.expiresAt, "2026-09-25T00:00:00.000Z");
  });
});

test("evidenceRecord appends validated source artifacts", async () => {
  await fixture(async (root) => {
    const entry = await evidenceRecord({
      repositoryRoot: root,
      run: {
        runId: "artifact-run",
        definition: { id: "change", retention: "development" },
        sourceCommit: COMMIT,
        apkDigest: null,
      },
      slot: { id: "change-gate", deviceRole: "none", binding: "none" },
      fill: {
        kind: "pass",
        observedAt: NOW,
        artifacts: [
          {
            id: "source-evidence",
            path: "approvals.json",
            sha256: hash("approvals"),
            mediaType: "application/json",
          },
        ],
      },
      now: NOW,
    });
    assert.equal(entry.artifacts.some((item) => item.id === "source-evidence"), true);
    assert.equal(entry.artifacts.some((item) => item.id === "gate-report"), true);
  });
});

test("parseArguments mint unique local run ids", () => {
  const previous = process.env.GITHUB_RUN_ID;
  delete process.env.GITHUB_RUN_ID;
  try {
    const first = parseArguments(["--gate", "change", "--source-commit", COMMIT]);
    const second = parseArguments(["--gate", "change", "--source-commit", COMMIT]);
    assert.match(first.runId, /^local-change-/);
    assert.notEqual(first.runId, second.runId);
    assert.doesNotThrow(() => assertRunId(first.runId, "--run-id"));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previous;
  }
});

test("android smoke journey reinstalls the APK", async () => {
  const script = await readFile(".github/scripts/android-smoke-journey.sh", "utf8");
  assert.match(script, /adb install --no-streaming -r "\$APK_PATH"/);
});

test("change gate uploads evidence after a failed verdict", async () => {
  const workflow = await readFile(".github/workflows/build.yml", "utf8");
  assert.match(
    workflow,
    /name: Upload Change Gate evidence\n\s+if: \$\{\{\s*always\(\)\s*\}\}/,
  );
});

test("incoming fragments collapse duplicates and reject conflicts", async () => {
  await fixture(async (root) => {
    const incoming = path.join(root, "incoming");
    const fragment = (entry) => ({
      schemaVersion: 2,
      policyVersion: 1,
      verifierVersion: "1.0.0",
      capabilities: {},
      gateRuns: { merged: [entry] },
    });
    await mkdir(path.join(incoming, "one"), { recursive: true });
    await mkdir(path.join(incoming, "two"), { recursive: true });
    await writeFile(path.join(incoming, "one/catalog.json"), JSON.stringify(fragment(record("change-gate"))));
    await writeFile(path.join(incoming, "two/catalog.json"), JSON.stringify(fragment(record("change-gate"))));
    const options = {
      catalogPath: path.join(root, "catalog.json"),
      outputPath: path.join(root, "output.json"),
      incomingPath: incoming,
      policy,
    };

    assert.equal((await loadCatalog(options)).gateRuns.merged.length, 1);
    await writeFile(
      path.join(incoming, "two/catalog.json"),
      JSON.stringify(fragment(record("change-gate", { result: "fail" }))),
    );
    await assert.rejects(loadCatalog(options), /conflicting incoming evidence/);
  });
});
