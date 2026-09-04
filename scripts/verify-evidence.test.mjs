import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VERIFIER_VERSION,
  validateCatalog,
  verifyEvidenceCatalog,
} from "./verify-evidence.mjs";

const policyPath = path.resolve("verification/evidence-policy.json");
const approvedPolicy = JSON.parse(await readFile(policyPath, "utf8"));

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "streamfusion-evidence-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function hash(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function catalogWith(record) {
  return {
    schemaVersion: 1,
    policyVersion: 1,
    verifierVersion: VERIFIER_VERSION,
    capabilities: record ? { "home-live-discovery": [record] } : {},
  };
}

function evidenceRecord(content, overrides = {}) {
  return {
    id: "change-gate",
    sourceCommit: "a".repeat(40),
    apkDigest: null,
    verifierVersion: VERIFIER_VERSION,
    testVersion: "change-gate@1",
    environment: {
      gate: "change",
      retention: "development",
      name: "local Windows C:\\Users\\Alice",
    },
    device: { kind: "none", profile: null, apiLevel: null },
    artifacts: [
      {
        id: "test-report",
        path: "evidence/report.json",
        sha256: hash(content),
        mediaType: "application/json",
      },
    ],
    result: "pass",
    observedAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-09-13T00:00:00.000Z",
    links: ["https://ci.example.test/run/7?access_token=secret#private"],
    ...overrides,
  };
}

async function fixtureOptions(root, catalog) {
  const catalogPath = path.join(root, "catalog.json");
  const statePath = path.join(root, "state.json");
  const outputPath = path.join(root, "verified.json");
  const publicOutputPath = path.join(root, "public.json");
  await writeFile(catalogPath, JSON.stringify(catalog));
  return {
    catalogPath,
    policyPath,
    statePath,
    outputPath,
    publicOutputPath,
    repositoryRoot: root,
  };
}

test("accepts the checked-in evidence catalog", async () => {
  const catalog = JSON.parse(
    await readFile("verification/catalog.json", "utf8"),
  );
  assert.deepEqual(validateCatalog(catalog, approvedPolicy).catalog, catalog);
});

test("runs the same verifier command with explicit CI artifact paths", async () => {
  await withFixture(async (root) => {
    const catalog = JSON.parse(
      await readFile("verification/catalog.json", "utf8"),
    );
    const recordCount = Object.values(catalog.capabilities).reduce(
      (total, records) => total + records.length,
      0,
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/verify-evidence.mjs",
        "--state",
        path.join(root, "state.json"),
        "--output",
        path.join(root, "verified.json"),
        "--public-output",
        path.join(root, "public.json"),
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(`${recordCount} verified, 0 resumed, ${recordCount} total`),
    );
    assert.equal(
      JSON.parse(await readFile(path.join(root, "public.json"), "utf8"))
        .schemaVersion,
      1,
    );
  });
});

test("rejects unknown fields and invalid capability IDs", () => {
  const catalog = catalogWith();
  catalog.capabilities["Home Discovery"] = [];
  assert.throws(
    () => validateCatalog(catalog, approvedPolicy),
    /invalid format/,
  );

  delete catalog.capabilities["Home Discovery"];
  catalog.unversioned = true;
  assert.throws(
    () => validateCatalog(catalog, approvedPolicy),
    /must contain exactly/,
  );

  const absolutePathRecord = evidenceRecord("report");
  absolutePathRecord.artifacts[0].path = "C:\\Users\\Alice\\report.json";
  assert.throws(
    () => validateCatalog(catalogWith(absolutePathRecord), approvedPolicy),
    /must be repository-relative/,
  );
});

test("verifies artifact hashes and resumes unchanged records", async () => {
  await withFixture(async (root) => {
    const content = JSON.stringify({ result: "pass" });
    const artifactPath = path.join(root, "evidence", "report.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, content);
    const options = await fixtureOptions(
      root,
      catalogWith(evidenceRecord(content)),
    );

    assert.deepEqual(await verifyEvidenceCatalog(options), {
      records: 1,
      verified: 1,
      resumed: 0,
      failed: 0,
    });
    assert.deepEqual(
      await verifyEvidenceCatalog({ ...options, resume: true }),
      {
        records: 1,
        verified: 0,
        resumed: 1,
        failed: 0,
      },
    );
  });
});

test("fails closed when a retained artifact changes", async () => {
  await withFixture(async (root) => {
    const original = "trusted";
    const artifactPath = path.join(root, "evidence", "report.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, original);
    const options = await fixtureOptions(
      root,
      catalogWith(evidenceRecord(original)),
    );
    await verifyEvidenceCatalog(options);
    await writeFile(artifactPath, "tampered");

    await assert.rejects(
      verifyEvidenceCatalog({ ...options, resume: true }),
      /digest .* does not match/,
    );
  });
});

test("discards a corrupt resume journal and rebuilds it", async () => {
  await withFixture(async (root) => {
    const content = "trusted";
    const artifactPath = path.join(root, "evidence", "report.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, content);
    const options = await fixtureOptions(
      root,
      catalogWith(evidenceRecord(content)),
    );
    await writeFile(options.statePath, "not-json");

    assert.deepEqual(
      await verifyEvidenceCatalog({ ...options, resume: true }),
      {
        records: 1,
        verified: 1,
        resumed: 0,
        failed: 0,
      },
    );
  });
});

test("publishes hashes without local paths, identifiers, or URL secrets", async () => {
  await withFixture(async (root) => {
    const content = JSON.stringify({
      accessToken: "provider-secret",
      pushToken: "ExponentPushToken[private-token]",
      providerContent: "private chat message",
      userEmail: "alice@example.com",
    });
    const artifactPath = path.join(root, "evidence", "report.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, content);
    const record = evidenceRecord(content, {
      device: { kind: "physical", profile: "serial-ABC123", apiLevel: 35 },
    });
    const options = await fixtureOptions(root, catalogWith(record));

    await verifyEvidenceCatalog(options);
    const published = await readFile(options.publicOutputPath, "utf8");
    assert.match(published, new RegExp(record.artifacts[0].sha256));
    assert.match(published, /https:\/\/ci\.example\.test\/run\/7/);
    for (const secret of [
      "C:\\Users\\Alice",
      "serial-ABC123",
      "evidence/report.json",
      "access_token",
      "provider-secret",
      "ExponentPushToken",
      "private chat message",
      "alice@example.com",
      "#private",
    ]) {
      assert.doesNotMatch(
        published,
        new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });
});

test("enforces retention bounds and permanent release evidence", () => {
  assert.throws(
    () =>
      validateCatalog(
        catalogWith(
          evidenceRecord("report", { expiresAt: "2026-09-14T00:00:00.000Z" }),
        ),
        approvedPolicy,
      ),
    /no later than 14 days/,
  );

  const releaseRecord = evidenceRecord("report", {
    environment: {
      gate: "public-release",
      retention: "release",
      name: "release",
    },
    expiresAt: "2026-09-01T00:00:00.000Z",
  });
  assert.throws(
    () => validateCatalog(catalogWith(releaseRecord), approvedPolicy),
    /must be null for permanent release evidence/,
  );
});
