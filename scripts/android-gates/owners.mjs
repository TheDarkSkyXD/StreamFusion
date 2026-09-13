import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { hasCleanCandidatePair } from "./gate-run.mjs";
import { isFresh } from "./freshness.mjs";
import { sourceEvidenceFill } from "./source-evidence.mjs";

function pass(now, apkDigest = null) {
  return { kind: "pass", observedAt: now, artifacts: [], apkDigest };
}

function fail(now, detail) {
  return { kind: "fail", observedAt: now, artifacts: [], detail };
}

function absent(now, missing) {
  return { kind: "absent", observedAt: now, artifacts: [], missing };
}

function commandFill(command, repositoryRoot, now, apkDigest) {
  const result = spawnSync(command, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: true,
  });
  if (result.error) return { kind: "infrastructure-failure", observedAt: now, artifacts: [], detail: result.error.message };
  return result.status === 0 ? pass(now, apkDigest) : fail(now, `command failed: ${command}`);
}

function repositorySecrets(repositoryRoot, now) {
  const result = spawnSync("git", ["ls-files"], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) return { kind: "infrastructure-failure", observedAt: now, artifacts: [], detail: "cannot list tracked files" };
  const sensitive = result.stdout.split(/\r?\n/u).find((file) =>
    /(^|\/)(\.env|[^/]+\.(?:pem|key|p12|jks))$/u.test(file),
  );
  return sensitive ? fail(now, `tracked secret-like file: ${sensitive}`) : pass(now);
}

async function androidPermissions(repositoryRoot, now) {
  const config = JSON.parse(await readFile(path.join(repositoryRoot, "apps/mobile/app.json"), "utf8"));
  const android = config.expo?.android;
  const permissions = android?.permissions ?? [];
  const permitted = permissions.every((permission) => permission === "android.permission.INTERNET");
  return android?.allowBackup === false && permitted
    ? pass(now)
    : fail(now, "Android configuration violates the permission or backup allowlist");
}

function requiredEnvironment(name, slot, context, missing) {
  const value = process.env[name]?.trim();
  if (!value) return absent(context.now, missing);
  return sourceEvidenceFill(value, slot, context);
}

function catalogProof(slot, context) {
  const expectedGate = slot.id === "change-gate" ? "change" : "main";
  const matched = Object.values(context.catalog.gateRuns).some((records) =>
    records.some((record) =>
      record.id === slot.id &&
      record.environment.gate === expectedGate &&
      record.result === "pass" &&
      record.sourceCommit === context.sourceCommit &&
      (slot.binding !== "apk" || record.apkDigest === context.apkDigest) &&
      isFresh(slot, record, context.now, context.policy),
    ),
  );
  return matched ? pass(context.now, context.apkDigest) : fail(context.now, `no passing ${slot.id} record is available`);
}

function emulatorProof(slot, context) {
  const report = process.env.ANDROID_GATE_JOURNEY_REPORT?.trim();
  if (!report) return fail(context.now, `missing emulator journey report for ${slot.id}`);
  return sourceEvidenceFill(report, slot, context);
}

function physicalProof(slot, context) {
  const variable = `ANDROID_GATE_${slot.id.toUpperCase().replaceAll("-", "_")}`;
  return requiredEnvironment(variable, slot, context, "physical-device");
}

function signedApk(slot, context) {
  if (!context.apkPath) return absent(context.now, "signed-apk");
  const evidence = process.env.ANDROID_GATE_SIGNED_APK_EVIDENCE?.trim();
  if (!evidence) return fail(context.now, "missing signed APK verification evidence");
  return sourceEvidenceFill(evidence, slot, context);
}

function fileProof(variable, slot, context, missing) {
  const evidence = process.env[variable]?.trim();
  if (!evidence) return absent(context.now, missing);
  return sourceEvidenceFill(evidence, slot, context);
}

export function createOwners({ repositoryRoot }) {
  return async function own(slot, context) {
    if (slot.requiresApk && !context.apkDigest) {
      return slot.absentKind
        ? absent(context.now, slot.absentKind)
        : fail(context.now, "APK is required");
    }
    if (slot.owner === "npm-script") return commandFill(slot.npmScript, repositoryRoot, context.now, context.apkDigest);
    if (slot.id === "repository-secrets") return repositorySecrets(repositoryRoot, context.now);
    if (slot.id === "android-permissions") return androidPermissions(repositoryRoot, context.now);
    if (slot.id === "diagnostic-retry") return pass(context.now);
    if (slot.id === "quarantine-block") return context.run.hasQuarantine() ? { kind: "quarantined", observedAt: context.now, artifacts: [], detail: "quarantined evidence is present" } : pass(context.now);
    if (slot.owner === "catalog-read") return catalogProof(slot, context);
    if (slot.owner === "run-archive") {
      return hasCleanCandidatePair(context.catalog, context.apkDigest, context.now, context.policy)
        ? pass(context.now, context.apkDigest)
        : fail(context.now, "two clean candidate runs are required");
    }
    if (slot.owner === "emulator-journey") return emulatorProof(slot, context);
    if (slot.owner === "physical-journey") return physicalProof(slot, context);
    if (slot.owner === "live-provider") {
      return requiredEnvironment(
        `ANDROID_GATE_${slot.id.toUpperCase().replaceAll("-", "_")}`,
        slot,
        context,
        "live-credentials",
      );
    }
    if (slot.owner === "signed-apk") return signedApk(slot, context);
    if (slot.owner === "signer-recovery") {
      return fileProof("ANDROID_GATE_SIGNER_RECOVERY_EVIDENCE", slot, context, "approvals");
    }
    if (slot.owner === "release-set") {
      return fileProof("ANDROID_GATE_RELEASE_SET_EVIDENCE", slot, context, "approvals");
    }
    return fileProof("ANDROID_GATE_APPROVALS_EVIDENCE", slot, context, slot.absentKind ?? "approvals");
  };
}
