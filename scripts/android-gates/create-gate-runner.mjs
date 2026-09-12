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
import { isFresh, matchesBinding } from "./freshness.mjs";

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
  run.replace(record);
  return record;
}

function recordIsCurrent(record, slot, options) {
  return (
    record?.result === "pass" &&
    matchesBinding(slot, record, options) &&
    isFresh(slot, record, options.now, options.policy)
  );
}

async function fillSlot(run, slot, options) {
  const existing = run.record(slot.id);
  if (existing && (existing.result !== "pass" || recordIsCurrent(existing, slot, options))) return;
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

function selectSlot(definition, request) {
  const selected = request.slot
    ? definition.slots.find((slot) => slot.id === request.slot)
    : null;
  if (request.slot && !selected) {
    throw new Error(`slot ${request.slot} is not in ${request.gate}`);
  }
  return selected;
}

async function fillGate(run, selected, request, options) {
  if (selected) {
    await fillSlot(run, selected, options);
    return;
  }
  for (const slot of run.definition.slots) {
    const isSummary = slot.id === gateRecordId(run.definition.id);
    const isReadOwner = slot.owner === "catalog-read" || slot.owner === "run-archive";
    if (!isSummary && (!request.read || isReadOwner)) await fillSlot(run, slot, options);
  }
  await fillSummary(run, options);
}

function selectedVerdict(run, selected) {
  const record = run.record(selected.id);
  return {
    pass: record?.result === "pass",
    reason: record?.result ?? "missing-slot",
    failures: [],
  };
}

async function runRequest(request, configuration) {
  const definition = GATE_DEFINITIONS[request.gate];
  if (!definition) throw new Error(`unsupported gate: ${request.gate}`);
  if (!request.runId) throw new Error("--run-id is required");
  const now = request.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) throw new Error("--now must be RFC 3339");
  const policy = JSON.parse(await readFile(configuration.policyPath, "utf8"));
  const catalog = await loadCatalog({
    catalogPath: configuration.catalogPath,
    outputPath: configuration.outputPath,
    incomingPath: request.incomingPath ?? configuration.incomingPath,
    policy,
  });
  const apk = await apkIdentity(request.apkPath, request.apkDigest);
  const run = new GateRun({
    definition,
    runId: request.runId,
    sourceCommit: request.sourceCommit,
    apkDigest: apk.apkDigest,
    records: catalog.gateRuns[request.runId] ?? [],
  });
  assertIdentity(run, definition, request.sourceCommit, apk.apkDigest);
  const options = {
    ...configuration,
    ...apk,
    catalog,
    digestMismatch: apk.digestMismatch,
    now,
    policy,
    retryUsed: { value: run.usedDiagnosticRetry() },
    sourceCommit: request.sourceCommit,
  };
  const selected = selectSlot(definition, request);
  await fillGate(run, selected, request, options);
  await writeCatalog(
    request.outputPath ?? configuration.outputPath,
    selected || request.fragment
      ? emptyGateFragment(run.runId, run.records)
      : upsertRun(catalog, run),
  );
  return selected ? selectedVerdict(run, selected) : finalVerdict(run, options);
}

export function createGateRunner({
  repositoryRoot,
  catalogPath = path.join(repositoryRoot, "verification/catalog.json"),
  outputPath = path.join(repositoryRoot, "artifacts/mobile-evidence/android-gates/catalog.json"),
  incomingPath = path.join(repositoryRoot, "artifacts/mobile-evidence/incoming"),
  owner,
} = {}) {
  if (!repositoryRoot) throw new Error("repositoryRoot is required");
  return { run: (request) => runRequest(request, {
    catalogPath,
    defaultOwner: createOwners({ repositoryRoot }),
    incomingPath,
    outputPath,
    owner,
    policyPath: path.join(repositoryRoot, "verification/evidence-policy.json"),
    repositoryRoot,
  }) };
}
