/** @typedef {"change"|"main"|"candidate"|"public-release"} GateId */

export const CURRENT_ANDROID_API = 36;
export const LOW_ANDROID_API = 30;

const retentionByGate = {
  change: "development",
  main: "main",
  candidate: "main",
  "public-release": "release",
};

function slot(id, owner, freshnessClass, binding, options = {}) {
  return Object.freeze({
    id,
    owner,
    freshnessClass,
    binding,
    deviceRole: options.deviceRole ?? "none",
    requiresApk: options.requiresApk ?? binding === "apk",
    absentKind: options.absentKind ?? null,
    npmScript: options.npmScript ?? null,
  });
}

const changeSlots = [
  slot("workspace-static", "npm-script", "exact-artifact", "commit", {
    npmScript: "npm run --workspace @streamfusion/mobile lint",
  }),
  slot("workspace-unit", "npm-script", "exact-artifact", "commit", {
    npmScript: "npm run --workspace @streamfusion/mobile test",
  }),
  slot("workspace-component", "npm-script", "exact-artifact", "commit", {
    npmScript: "npm run --workspace @streamfusion/mobile test",
  }),
  slot("workspace-contract", "npm-script", "exact-artifact", "commit", {
    npmScript: "npm run --workspace @streamfusion/mobile typecheck",
  }),
  slot("android-native-config", "npm-script", "exact-artifact", "commit", {
    npmScript: "npm run --workspace @streamfusion/mobile config:android",
  }),
  slot("dependency-policy", "npm-script", "exact-artifact", "commit", {
    npmScript: "npm run lint:dependencies",
  }),
  slot("repository-secrets", "control", "exact-artifact", "commit"),
  slot("android-permissions", "control", "exact-artifact", "commit"),
  slot("diagnostic-retry", "control", "exact-artifact", "none"),
  slot("quarantine-block", "control", "exact-artifact", "none"),
  slot("change-gate", "control", "exact-artifact", "commit"),
];

const mainSlots = [
  slot("change-gate", "catalog-read", "exact-artifact", "commit"),
  slot("api30-emulator-smoke", "emulator-journey", "emulator", "apk", {
    deviceRole: "api30-emulator",
  }),
  slot(
    "current-api-emulator-smoke",
    "emulator-journey",
    "emulator",
    "apk",
    { deviceRole: "current-api-emulator" },
  ),
  slot("diagnostic-retry", "control", "exact-artifact", "none"),
  slot("quarantine-block", "control", "exact-artifact", "none"),
  slot("main-gate", "control", "exact-artifact", "apk"),
];

const candidateSlots = [
  slot("main-gate", "catalog-read", "exact-artifact", "apk"),
  slot("tablet-emulator-smoke", "emulator-journey", "emulator", "apk", {
    deviceRole: "emulator-tablet",
  }),
  slot("foldable-emulator-smoke", "emulator-journey", "emulator", "apk", {
    deviceRole: "emulator-foldable",
  }),
  slot(
    "physical-lowest-api30-phone",
    "physical-journey",
    "physical-device",
    "apk",
    { deviceRole: "physical-lowest-api30-phone", absentKind: "physical-device" },
  ),
  slot(
    "physical-constrained-phone",
    "physical-journey",
    "physical-device",
    "apk",
    { deviceRole: "physical-constrained-phone", absentKind: "physical-device" },
  ),
  slot(
    "physical-mainstream-phone",
    "physical-journey",
    "physical-device",
    "apk",
    { deviceRole: "physical-mainstream-phone", absentKind: "physical-device" },
  ),
  slot("physical-tablet", "physical-journey", "physical-device", "apk", {
    deviceRole: "physical-tablet",
    absentKind: "physical-device",
  }),
  slot("physical-foldable", "physical-journey", "physical-device", "apk", {
    deviceRole: "physical-foldable",
    absentKind: "physical-device",
  }),
  slot("accessibility", "approval-file", "accessibility", "apk", {
    absentKind: "approvals",
  }),
  slot("performance", "approval-file", "physical-device", "apk", {
    absentKind: "approvals",
  }),
  slot("security", "approval-file", "human-review", "apk", {
    absentKind: "approvals",
  }),
  slot("live-twitch", "live-provider", "live-provider", "apk", {
    absentKind: "live-credentials",
  }),
  slot("live-kick", "live-provider", "live-provider", "apk", {
    absentKind: "live-credentials",
  }),
  slot("install", "approval-file", "exact-artifact", "apk", {
    absentKind: "approvals",
  }),
  slot("upgrade", "approval-file", "exact-artifact", "apk", {
    absentKind: "approvals",
  }),
  slot("interruption", "approval-file", "physical-device", "apk", {
    absentKind: "approvals",
  }),
  slot("recovery", "approval-file", "physical-device", "apk", {
    absentKind: "approvals",
  }),
  slot("diagnostic-retry", "control", "exact-artifact", "none"),
  slot("quarantine-block", "control", "exact-artifact", "none"),
  slot("candidate-gate", "control", "exact-artifact", "apk"),
];

const publicReleaseSlots = [
  slot("change-gate", "catalog-read", "exact-artifact", "commit"),
  slot("main-gate", "catalog-read", "exact-artifact", "apk"),
  slot("clean-candidate-pair", "run-archive", "exact-artifact", "apk"),
  slot("approvals", "approval-file", "human-review", "apk", {
    absentKind: "approvals",
  }),
  slot("signer-recovery", "signer-recovery", "signer-recovery", "apk", {
    absentKind: "approvals",
  }),
  slot("signed-apk", "signed-apk", "exact-artifact", "apk", {
    absentKind: "signed-apk",
  }),
  slot("release-set", "release-set", "exact-artifact", "apk", {
    absentKind: "approvals",
  }),
  slot("quarantine-block", "control", "exact-artifact", "none"),
  slot("public-release-gate", "control", "exact-artifact", "apk"),
];

function definition(id, slots) {
  return Object.freeze({ id, retention: retentionByGate[id], slots });
}

export const GATE_DEFINITIONS = Object.freeze({
  change: definition("change", changeSlots),
  main: definition("main", mainSlots),
  candidate: definition("candidate", candidateSlots),
  "public-release": definition("public-release", publicReleaseSlots),
});

export function slotsFor(gate) {
  const definitionForGate = GATE_DEFINITIONS[gate];
  if (!definitionForGate) throw new Error(`unsupported gate: ${gate}`);
  return definitionForGate.slots;
}

export function gateRecordId(gate) {
  return gate === "public-release" ? "public-release-gate" : `${gate}-gate`;
}
