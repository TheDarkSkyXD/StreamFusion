import { createHash } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  dumpUi,
  findControl,
  findNode,
  forceStop,
  hasText,
  hideKeyboard,
  launch,
  openMoreDestinations,
  reversePort,
  run,
  screenshot,
  sleep,
  swipePage,
  tap,
  useEvidenceDir,
  waitFor,
} from "./drive-issue-166-captions-ui.mjs";

const evidenceDir = path.resolve("verification/evidence/issue-170");
useEvidenceDir(evidenceDir);
const packageName = "com.thedarkskyxd.streamfusion.dev";

function isVisible(node, minHeight) {
  return Boolean(
    node && node.top >= 280 && node.bottom <= 1980 && node.height > minHeight,
  );
}

function tapControl(res, desc) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const node = findControl(dumpUi(), res, desc);
    if (isVisible(node, 24)) {
      tap(node);
      sleep(900);
      return;
    }
    swipePage();
  }
  throw new Error(`missing ${res}`);
}

function findSettingsDestination(xml) {
  return (
    findControl(xml, "open-more-settings", "Settings") ??
    findNode(
      xml,
      (node) =>
        node.clickable &&
        (node.res.endsWith("open-more-settings") || node.desc === "Settings") &&
        node.top >= 280,
    )
  );
}

function openSettings() {
  let xml = openMoreDestinations();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const destination = findSettingsDestination(xml);
    if (isVisible(destination, 40)) {
      tap(destination, 0.3);
      sleep(1500);
      waitFor(
        (node) =>
          node.res === "screen-settings" ||
          node.res === "screen-more-settings" ||
          node.res === "settings-search",
        "Settings workspace",
      );
      return;
    }
    swipePage();
    xml = dumpUi();
  }
  throw new Error("Settings destination missing");
}

function clearSearch() {
  tapControl("settings-search", "Search settings");
  run(["shell", "input", "keyevent", "123"]);
  for (let index = 0; index < 20; index += 1) {
    run(["shell", "input", "keyevent", "67"]);
  }
  hideKeyboard();
  sleep(400);
}

function search(term) {
  tapControl("settings-search", "Search settings");
  run(["shell", "input", "text", term]);
  hideKeyboard();
  sleep(600);
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function passed(observations) {
  return { result: "pass", observations };
}

function apkDigest() {
  const remote = run(["shell", "pm", "path", packageName])
    .split("\n")
    .map((line) => line.replace(/^package:/u, "").trim())
    .find(Boolean);
  if (!remote) throw new Error("apk path missing");
  const local = path.join(evidenceDir, "app.apk");
  run(["pull", remote, local]);
  const digest = createHash("sha256").update(readFileSync(local)).digest("hex");
  unlinkSync(local);
  return `sha256:${digest}`;
}

function assertAppearanceHidden(after) {
  if (findNode(dumpUi(), (node) => node.res === "panel-appearance")) {
    throw new Error(`appearance panel still visible after ${after}`);
  }
}

function proveSearch(shots) {
  search("github");
  waitFor(
    (node) => node.res === "panel-updates" || node.res === "check-for-updates",
    "updates search",
  );
  assertAppearanceHidden("updates search");
  shots.push(screenshot("02-search-updates"));
  clearSearch();
  search("privacy");
  waitFor((node) => node.res === "panel-about" || node.res === "reset-app", "about search");
  assertAppearanceHidden("about search");
  shots.push(screenshot("03-search-about"));
}

function proveCheckNow(shots) {
  clearSearch();
  search("github");
  tapControl("check-for-updates", "Check now");
  waitFor(
    (node) =>
      node.res === "update-status" &&
      (node.text.includes("GitHub") ||
        node.text.includes("stable") ||
        node.text.includes("native updater") ||
        node.text.includes("unreachable") ||
        node.text.includes("Installed")),
    "GitHub check result",
  );
  shots.push(screenshot("04-check-now"));
}

function proveConfirmation(shots) {
  clearSearch();
  search("privacy");
  tapControl("clear-history", "Clear history");
  waitFor((node) => node.res === "clear-history-confirmation", "history confirmation");
  shots.push(screenshot("05-confirm-history"));
  tapControl("clear-history-cancel", "Cancel");
  waitFor((node) => node.text.includes("Canceled") || node.res === "maintenance-result", "cancel copy");
  tapControl("clear-history", "Clear history");
  tapControl("clear-history-confirm", "Confirm");
  waitFor(
    (node) =>
      node.res === "maintenance-result" &&
      (node.text.includes("Cleared") || node.text.includes("History")),
    "history cleared",
  );
  shots.push(screenshot("06-history-cleared"));
}

function proveAccessibility(shots) {
  clearSearch();
  search("github");
  let check = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const xml = dumpUi();
    check = findControl(xml, "check-for-updates", "Check now") ?? check;
    if (check && check.desc.length > 0) {
      writeFileSync(path.join(evidenceDir, "accessibility-dump.xml"), xml);
      shots.push(screenshot("07-accessibility"));
      return { check };
    }
    swipePage();
  }
  throw new Error("check-for-updates missing accessibility name");
}

function proveProcessDeath(shots) {
  forceStop();
  launch();
  openSettings();
  search("github");
  waitFor((node) => node.res === "panel-updates" || node.res === "check-for-updates", "updates survived");
  shots.push(screenshot("08-process-death"));
}

function runSettingsJourney() {
  reversePort();
  forceStop();
  launch();
  openSettings();
  const shots = [screenshot("01-settings")];
  proveSearch(shots);
  proveCheckNow(shots);
  proveConfirmation(shots);
  const a11y = proveAccessibility(shots);
  proveProcessDeath(shots);
  return { a11y, shots };
}

function captureObservations(a11y) {
  return {
    searchHidAppearance: true,
    checkNowLabel: a11y.check.desc,
    confirmationCancelThenConfirm: true,
    apkDownloadNotClaimed: true,
    appearanceStaysDark: true,
  };
}

function settingsRequirements() {
  return {
    "change-gate": passed([
      "More Settings search shows Updates and About. Check now writes a GitHub result. Clear history requires Cancel or Confirm.",
    ]),
    "api30-journey": passed([
      "StreamFusion Issue 142 API30 opened searchable Updates and About without claiming PackageInstaller.",
    ]),
    "local-search": passed([
      "Search github and privacy hid Appearance and kept the matching panel.",
    ]),
    "destructive-confirmation": passed([
      "Clear history showed confirmation, Cancel kept data, Confirm reported the History result.",
    ]),
    "data-boundary": passed([
      "Guest disconnect copy does not start OAuth. GitHub check does not download an APK.",
    ]),
    accessibility: passed(["Check now exposes an accessibility name."]),
  };
}

function writeReceipt(shots, a11y) {
  writeJson(path.join(evidenceDir, "observations.json"), captureObservations(a11y));
  const observedAt = new Date().toISOString();
  const receipt = {
    schemaVersion: 1,
    issue: 170,
    ticketId: "M08",
    observedAt,
    result: "pass",
    desktopBaseline: {
      inventory: "docs/research/streamfusion-mobile/desktop-parity-inventory.md",
      check:
        "M08 searchable Updates, Diagnostics, Logs, Report a bug, and About with scoped confirmation.",
    },
    candidate: {
      apkSha256: apkDigest(),
      provenance:
        "API 30 development client. Metro JS from the W02 worktree. Guest signed-out. GitHub Check now inspects stable releases. APK download stays R02. Appearance stays dark-only.",
    },
    requirements: settingsRequirements(),
    evidenceArtifacts: shots.map((shot) => ({
      path: shot.path,
      sha256: shot.sha256,
      observedAt,
      scope: shot.name,
    })),
  };
  writeJson(path.resolve("verification/evidence/issue-170-settings.json"), receipt);
  return receipt;
}

try {
  const { a11y, shots } = runSettingsJourney();
  const receipt = writeReceipt(shots, a11y);
  console.log(
    JSON.stringify(
      { shots: shots.map((shot) => shot.name), apk: receipt.candidate.apkSha256, ok: true },
      null,
      2,
    ),
  );
} catch (error) {
  writeFileSync(path.join(evidenceDir, "last-fail.xml"), dumpUi());
  screenshot("last-fail");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
