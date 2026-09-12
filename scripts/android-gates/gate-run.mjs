import { gateRecordId } from "./registry.mjs";
import { isFresh, matchesBinding, retryWasUsed } from "./freshness.mjs";

function recordsById(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function recordFailure(slot, record, identity, now, policy) {
  if (!record) return "missing-slot";
  if (record.result === "quarantined") return "quarantined";
  if (record.result !== "pass") return "failed-proof";
  if (!matchesBinding(slot, record, identity)) return "binding-mismatch";
  if (!isFresh(slot, record, now, policy)) return "stale";
  return null;
}

function closedReason(failures) {
  for (const reason of [
    "missing-slot",
    "quarantined",
    "stale",
    "binding-mismatch",
    "failed-proof",
  ]) {
    if (failures.some((failure) => failure.reason === reason)) return reason;
  }
  return "all-current";
}

export function evaluateGate({
  definition,
  records,
  sourceCommit,
  apkDigest,
  now,
  policy,
}) {
  const recordById = recordsById(records);
  const identity = { sourceCommit, apkDigest };
  const failures = definition.slots.flatMap((slot) => {
    const reason = recordFailure(
      slot,
      recordById.get(slot.id),
      identity,
      now,
      policy,
    );
    return reason ? [{ id: slot.id, reason }] : [];
  });
  return {
    pass: failures.length === 0,
    reason: closedReason(failures),
    failures,
  };
}

export class GateRun {
  constructor({ definition, runId, sourceCommit, apkDigest, records = [] }) {
    this.definition = definition;
    this.runId = runId;
    this.sourceCommit = sourceCommit;
    this.apkDigest = apkDigest;
    this.records = [...records];
  }

  record(id) {
    return this.records.find((entry) => entry.id === id);
  }

  occupy(record) {
    const previous = this.record(record.id);
    if (!previous) this.records.push(record);
    else if (JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new Error(`run ${this.runId} has conflicting ${record.id} evidence`);
    }
  }

  replace(record) {
    const index = this.records.findIndex((entry) => entry.id === record.id);
    if (index < 0) this.records.push(record);
    else this.records[index] = record;
  }

  hasQuarantine() {
    return this.records.some((record) => record.result === "quarantined");
  }

  usedDiagnosticRetry() {
    return retryWasUsed(this.record("diagnostic-retry"));
  }

  prerequisiteVerdict(now, policy) {
    const gateId = gateRecordId(this.definition.id);
    return evaluateGate({
      definition: {
        ...this.definition,
        slots: this.definition.slots.filter((slot) => slot.id !== gateId),
      },
      records: this.records,
      sourceCommit: this.sourceCommit,
      apkDigest: this.apkDigest,
      now,
      policy,
    });
  }
}

function isCleanCandidate(records, digest) {
  const candidate = records.find((record) => record.id === "candidate-gate");
  const retry = records.find((record) => record.id === "diagnostic-retry");
  return (
    candidate?.result === "pass" &&
    candidate.apkDigest === digest &&
    retry?.result === "pass" &&
    !retryWasUsed(retry) &&
    !records.some((record) => record.id.endsWith("-original"))
  );
}

function candidateRunFacts(gateRuns, digest) {
  return Object.entries(gateRuns ?? {})
    .map(([runId, records]) => {
      const gate = records.find((record) => record.id === "candidate-gate");
      return { clean: isCleanCandidate(records, digest), gate, runId };
    })
    .filter(({ gate }) => gate?.apkDigest === digest)
    .toSorted((left, right) => {
      const observed = left.gate.observedAt.localeCompare(right.gate.observedAt);
      return observed || left.runId.localeCompare(right.runId);
    });
}

export function hasCleanCandidatePair(catalog, digest) {
  const candidates = candidateRunFacts(catalog.gateRuns, digest);
  return candidates.some(
    (candidate, index) => index > 0 && candidate.clean && candidates[index - 1].clean,
  );
}
