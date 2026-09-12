import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { VERIFIER_VERSION, validateCatalog } from "../verify-evidence.mjs";
import { CURRENT_ANDROID_API, LOW_ANDROID_API } from "./registry.mjs";
import { f04Result } from "./freshness.mjs";

function hash(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function jsonFiles(directory) {
  try {
    if (!(await stat(directory)).isDirectory()) return [];
  } catch {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const child = path.join(directory, entry.name);
      return entry.isDirectory()
        ? jsonFiles(child)
        : entry.name === "catalog.json"
          ? [child]
          : [];
    }),
  );
  return nested.flat();
}

function emptyCatalog() {
  return {
    schemaVersion: 2,
    policyVersion: 1,
    verifierVersion: VERIFIER_VERSION,
    capabilities: {},
    gateRuns: {},
  };
}

function mergeRun(target, runId, records) {
  const current = new Map((target.gateRuns[runId] ?? []).map((record) => [record.id, record]));
  for (const record of records) {
    const duplicate = current.get(record.id);
    if (duplicate && JSON.stringify(canonical(duplicate)) !== JSON.stringify(canonical(record))) {
      throw new Error(`conflicting incoming evidence for ${runId}/${record.id}`);
    }
    current.set(record.id, record);
  }
  target.gateRuns[runId] = [...current.values()].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function mergeFragment(target, fragment) {
  if (Object.keys(fragment.capabilities).length > 0) {
    throw new Error("incoming gate fragments cannot contain capabilities");
  }
  for (const [runId, records] of Object.entries(fragment.gateRuns)) {
    mergeRun(target, runId, records);
  }
}

export async function loadCatalog({ catalogPath, outputPath, incomingPath, policy }) {
  const sourcePath = (await fileExists(outputPath)) ? outputPath : catalogPath;
  const catalog = await readJson(sourcePath);
  validateCatalog(catalog, policy);
  for (const filePath of await jsonFiles(incomingPath)) {
    const fragment = await readJson(filePath);
    validateCatalog(fragment, policy);
    mergeFragment(catalog, fragment);
  }
  return catalog;
}

export async function writeCatalog(outputPath, catalog) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(canonical(catalog), null, 2)}\n`);
  await rename(temporary, outputPath);
}

function deviceFor(slot, absent) {
  if (absent || slot.deviceRole === "none") {
    return { kind: "none", profile: null, apiLevel: null };
  }
  const emulator = slot.deviceRole.startsWith("emulator") || slot.deviceRole.includes("api");
  const apiLevel = slot.deviceRole === "api30-emulator" ? LOW_ANDROID_API : CURRENT_ANDROID_API;
  return { kind: emulator ? "emulator" : "physical", profile: slot.deviceRole, apiLevel };
}

function expiry(definition, now) {
  if (definition.retention === "release") return null;
  const days = definition.retention === "development" ? 14 : 30;
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

function reportPath(runId, slotId) {
  return path.posix.join("artifacts", "mobile-evidence", "android-gates", runId, `${slotId}.json`);
}

function observedAtOrNow(fill, now) {
  const observedAt = Date.parse(fill.observedAt ?? now);
  const evaluatedAt = Date.parse(now);
  return Number.isFinite(observedAt) && observedAt <= evaluatedAt
    ? (fill.observedAt ?? now)
    : now;
}

export async function evidenceRecord({ repositoryRoot, run, slot, fill, now, retryUsed = false }) {
  const relativePath = reportPath(run.runId, slot.id);
  const report = {
    gate: run.definition.id,
    result: f04Result(fill),
    runId: run.runId,
    slot: slot.id,
    ...(fill.detail ? { detail: fill.detail } : {}),
    ...(fill.missing ? { missing: fill.missing } : {}),
  };
  const content = `${JSON.stringify(canonical(report), null, 2)}\n`;
  const absolutePath = path.join(repositoryRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return {
    id: slot.id,
    sourceCommit: run.sourceCommit,
    apkDigest: slot.binding === "apk" ? run.apkDigest : null,
    verifierVersion: VERIFIER_VERSION,
    testVersion: `android-gates@1;retry=${retryUsed ? "used" : "unused"}`,
    environment: { gate: run.definition.id, retention: run.definition.retention, name: "android-gates" },
    device: deviceFor(slot, fill.kind === "absent"),
    artifacts: [{ id: "gate-report", path: relativePath, sha256: hash(content), mediaType: "application/json" }],
    result: f04Result(fill),
    observedAt: observedAtOrNow(fill, now),
    expiresAt: expiry(run.definition, now),
    links: [],
  };
}

export function upsertRun(catalog, run) {
  catalog.gateRuns[run.runId] = [...run.records].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  return catalog;
}

export function emptyGateFragment(runId, records) {
  const catalog = emptyCatalog();
  catalog.gateRuns[runId] = records;
  return catalog;
}
