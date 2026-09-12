import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { GateRun, evaluateGate } from "./gate-run.mjs";
import { GATE_DEFINITIONS, gateRecordId } from "./registry.mjs";
import {
  emptyGateFragment,
  evidenceRecord,
  loadCatalog,
  upsertRun,
  writeCatalog,
} from "./catalog-store.mjs";
import { createOwners } from "./owners.mjs";

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function absentFor(slot, now) {
  return slot.absentKind
    ? { kind: "absent", observedAt: now, artifacts: [], missing: slot.absentKind }
    : { kind: "fail", observedAt: now, artifacts: [], detail: "APK is required" };
}

async function apkIdentity(apkPath, expected) {
  if (!apkPath) return { apkDigest: null, apkPath: null, digestMismatch: false };
  try {
    const actual = digest(await readFile(apkPath));
    return {
      apkDigest: actual,
      apkPath,
      digestMismatch: Boolean(expected && expected !== actual),
    };
  } catch {
    return { apkDigest: null, apkPath, digestMismatch: false };
  }
}

function assertIdentity(run, definition, sourceCommit, apkDigest) {
  for (const record of run.records) {
    if (record.environment.gate !== definition.id || record.sourceCommit !== sourceCommit) {
      throw new Error(`run ID ${run.runId} is already bound to another request`);
    }
    if (record.apkDigest && record.apkDigest !== apkDigest) {
      throw new Error(`run ID ${run.runId} is already bound to another APK`);
    }
  }
}

async function occupy(run, slot, fill, options) {
  const record = await evidenceRecord({
    repositoryRoot: options.repositoryRoot,
    run,
    slot,
    fill,
    now: options.now,
    retryUsed: slot.id === "diagnostic-retry" && options.retryUsed,
  });
  run.occupy(record);
  return record;
}

async function fillSlot(run, slot, options) {
  if (run.record(slot.id)) return;
  if (slot.requiresApk && !options.apkDigest) {
    await occupy(run, slot, absentFor(slot, options.now), options);
    return;
  }
  const context = { ...options, run };
  const supplied = options.owner ? await options.owner(slot, context) : undefined;
  const fill = supplied ?? (await options.defaultOwner(slot, context));
  if (fill.kind !== "infrastructure-failure" || options.retryUsed.value) {
    await occupy(run, slot, fill, { ...options, retryUsed: options.retryUsed.value });
    return;
  }
  const originalSlot = { ...slot, id: `${slot.id}-original` };
  await occupy(run, originalSlot, fill, options);
  options.retryUsed.value = true;
  const retry = options.owner
    ? (await options.owner(slot, context)) ?? (await options.defaultOwner(slot, context))
    : await options.defaultOwner(slot, context);
  await occupy(run, slot, retry, { ...options, retryUsed: true });
}

async function fillSummary(run, options) {
  const summaryId = gateRecordId(run.definition.id);
  if (run.record(summaryId)) return;
  const verdict = run.prerequisiteVerdict(options.now, options.policy);
  const fill = verdict.pass && !options.digestMismatch
    ? { kind: "pass", observedAt: options.now, artifacts: [], apkDigest: options.apkDigest }
    : {
      kind: "fail",
      observedAt: options.now,
      artifacts: [],
      detail: options.digestMismatch ? "APK digest mismatch" : verdict.reason,
    };
  await occupy(
    run,
    run.definition.slots.find((slot) => slot.id === summaryId),
    fill,
    { ...options, retryUsed: options.retryUsed.value },
  );
}

function finalVerdict(run, options) {
  const verdict = evaluateGate({
    definition: run.definition,
    records: run.records,
    sourceCommit: run.sourceCommit,
    apkDigest: run.apkDigest,
    now: options.now,
    policy: options.policy,
  });
  return options.digestMismatch
    ? { ...verdict, pass: false, reason: "digest-mismatch" }
    : verdict;
}

export function createGateRunner({
  repositoryRoot,
  catalogPath = path.join(repositoryRoot, "verification/catalog.json"),
  outputPath = path.join(repositoryRoot, "artifacts/mobile-evidence/android-gates/catalog.json"),
  incomingPath = path.join(repositoryRoot, "artifacts/mobile-evidence/incoming"),
  owner,
} = {}) {
  if (!repositoryRoot) throw new Error("repositoryRoot is required");
  const defaultOwner = createOwners({ repositoryRoot });
  return {
    async run(request) {
      const definition = GATE_DEFINITIONS[request.gate];
      if (!definition) throw new Error(`unsupported gate: ${request.gate}`);
      if (!request.runId) throw new Error("--run-id is required");
      const now = request.now ?? new Date().toISOString();
      if (Number.isNaN(Date.parse(now))) throw new Error("--now must be RFC 3339");
      const policy = JSON.parse(await readFile(path.join(repositoryRoot, "verification/evidence-policy.json"), "utf8"));
      const catalog = await loadCatalog({
        catalogPath,
        outputPath,
        incomingPath: request.incomingPath ?? incomingPath,
        policy,
      });
      const apk = await apkIdentity(request.apkPath, request.apkDigest);
      const records = catalog.gateRuns[request.runId] ?? [];
      const run = new GateRun({ definition, runId: request.runId, sourceCommit: request.sourceCommit, apkDigest: apk.apkDigest, records });
      assertIdentity(run, definition, request.sourceCommit, apk.apkDigest);
      const retryUsed = { value: run.usedDiagnosticRetry() };
      const options = { apkDigest: apk.apkDigest, apkPath: apk.apkPath, catalog, defaultOwner, digestMismatch: apk.digestMismatch, now, owner, policy, repositoryRoot, retryUsed, sourceCommit: request.sourceCommit };
      const selected = request.slot ? definition.slots.find((slot) => slot.id === request.slot) : null;
      if (request.slot && !selected) throw new Error(`slot ${request.slot} is not in ${request.gate}`);
      if (selected) await fillSlot(run, selected, options);
      else {
        for (const slot of definition.slots) {
          if (slot.id !== gateRecordId(definition.id) && (!request.read || slot.owner === "catalog-read" || slot.owner === "run-archive")) {
            await fillSlot(run, slot, options);
          }
        }
        await fillSummary(run, options);
      }
      const output = selected ? emptyGateFragment(run.runId, run.records) : upsertRun(catalog, run);
      await writeCatalog(request.outputPath ?? outputPath, output);
      if (selected) {
        const record = run.record(selected.id);
        return { pass: record?.result === "pass", reason: record?.result ?? "missing-slot", failures: [] };
      }
      return finalVerdict(run, options);
    },
  };
}
