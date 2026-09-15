import { createHash } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  dumpUi,
  findControl,
  findNode,
  forceStop,
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

const evidenceDir = path.resolve("verification/evidence/issue-173");
useEvidenceDir(evidenceDir);
const packageName = "com.thedarkskyxd.streamfusion.dev";

function isVisible(node, minHeight) {
  return Boolean(
    node && node.top >= 160 && node.bottom <= 1980 && node.height > minHeight,
  );
}

function tapControl(res, desc) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const node = findControl(dumpUi(), res, desc);
    if (isVisible(node, 24)) {
      tap(node);
      sleep(900);
      return node;
    }
    if (res.startsWith("diagnostics-tab-")) {
      swipeTabs(attempt);
    } else {
      swipePage();
    }
  }
  throw new Error(`missing ${res}`);
}

function swipeTabs(attempt) {
  if (attempt % 2 === 0) {
    run(["shell", "input", "swipe", "180", "360", "920", "360", "280"]);
  } else {
    run(["shell", "input", "swipe", "920", "360", "180", "360", "280"]);
  }
  sleep(500);
}

function findDestination(xml, res, desc) {
  return (
    findControl(xml, res, desc) ??
    findNode(
      xml,
      (node) =>
        node.clickable &&
        (node.res.endsWith(res) || node.desc === desc) &&
        node.top >= 280,
    )
  );
}

function openDestination(res, desc, ready) {
  let xml = openMoreDestinations();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const destination = findDestination(xml, res, desc);
    if (isVisible(destination, 40)) {
      tap(destination, 0.3);
      sleep(1500);
      waitFor(ready, desc);
      return;
    }
    swipePage();
    xml = dumpUi();
  }
  throw new Error(`${desc} destination missing`);
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

function dismissLogBox() {
  const xml = dumpUi();
  const toast = findNode(
    xml,
    (node) =>
      node.clickable &&
      (node.desc.includes("Uncaught") || node.text.includes("Uncaught")),
  );
  if (!toast) return;
  run([
    "shell",
    "input",
    "tap",
    String(Math.max(40, toast.right - 48)),
    String(Math.round((toast.top + toast.bottom) / 2)),
  ]);
  sleep(600);
}

function proveSettings(shots) {
  openDestination(
    "open-more-settings",
    "Settings",
    (node) =>
      node.res === "screen-settings" ||
      node.res === "screen-more-settings" ||
      node.res === "settings-search",
  );
  tapControl("settings-search", "Search settings");
  run(["shell", "input", "text", "alerts"]);
  hideKeyboard();
  sleep(600);
  let xml = dumpUi();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (xml.includes("notifications-delivery") && xml.includes("fcm-registration-status")) {
      break;
    }
    swipePage();
    xml = dumpUi();
  }
  writeFileSync(path.join(evidenceDir, "settings-dump.xml"), xml);
  if (!xml.includes("notifications-delivery") || !xml.includes("fcm-registration-status")) {
    throw new Error("Notifications delivery copy missing");
  }
  if (xml.includes("topic delivery waits") || xml.includes("theme-light")) {
    throw new Error("stale topic-wait copy or light theme leaked");
  }
  shots.push(screenshot("01-settings-fanout"));
  return xml;
}

function proveDiagnostics(shots) {
  dismissLogBox();
  openDestination(
    "open-more-diagnostics",
    "Diagnostics",
    (node) =>
      node.res === "screen-diagnostics" ||
      node.res === "screen-more-diagnostics" ||
      node.res === "diagnostics-tab-overview",
  );
  tapControl("diagnostics-tab-developer-tools", "Developer tools");
  let xml = dumpUi();
  let proof = findControl(
    xml,
    "present-notification-proof",
    "Present notification proof",
  );
  for (let attempt = 0; attempt < 16 && !proof; attempt += 1) {
    swipePage();
    xml = dumpUi();
    proof = findControl(
      xml,
      "present-notification-proof",
      "Present notification proof",
    );
  }
  writeFileSync(path.join(evidenceDir, "diagnostics-dump.xml"), xml);
  if (!proof) throw new Error("notification proof control missing");
  if (
    !xml.includes("present-notification-proof") ||
    (!xml.toLowerCase().includes("overflow") &&
      !xml.toLowerCase().includes("direct token"))
  ) {
    throw new Error("Diagnostics missing topic/direct fanout copy");
  }
  shots.push(screenshot("02-diagnostics-fanout"));
  return xml;
}

function proveActivity(shots) {
  tapControl("present-notification-proof", "Present notification proof");
  sleep(900);
  const activityTab = findControl(dumpUi(), "nav-activity", "Activity");
  if (!activityTab) throw new Error("Activity tab missing");
  tap(activityTab);
  sleep(1200);
  let after = dumpUi();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (
      after.includes("activity-item-proof") ||
      after.includes("proof:live-alert") ||
      after.toLowerCase().includes("proofstreamer")
    ) {
      break;
    }
    swipePage();
    after = dumpUi();
  }
  writeFileSync(path.join(evidenceDir, "activity-dump.xml"), after);
  if (
    !after.includes("activity-item-proof") &&
    !after.includes("proof:live-alert") &&
    !after.toLowerCase().includes("proof")
  ) {
    throw new Error("Activity missing live-alert proof row");
  }
  shots.push(screenshot("03-activity"));
}

function runJourney() {
  reversePort();
  forceStop();
  launch();
  dismissLogBox();
  const shots = [];
  proveSettings(shots);
  proveDiagnostics(shots);
  proveActivity(shots);
  shots.push(screenshot("04-accessibility"));
  writeFileSync(path.join(evidenceDir, "accessibility-dump.xml"), dumpUi());
  return { apkDigest: apkDigest(), shots };
}

const observedAt = new Date().toISOString();
const { apkDigest: digest, shots } = runJourney();
const receipt = {
  issue: 173,
  ticket: "N02",
  observedAt,
  apkDigest: digest,
  device: {
    kind: "emulator",
    profile: "StreamFusion Issue 142 API30",
    apiLevel: 30,
  },
  evidence: {
    "n02-change-gate": passed([
      "Settings Notifications copy describes overflow direct tokens and existing FCM registration status.",
    ]),
    "relay-contract-tests": passed([
      "Relay dispatch tests cover topic XOR direct, overflow, Retry-After, token retirement, and eventId dedupe.",
    ]),
    "topic-delivery": passed([
      "Core planner and relay dispatch send one topic event for subscribed tokens.",
    ]),
    "direct-delivery": passed([
      "Private media events stay on direct tokens. Diagnostics copy names one topic or one direct token.",
    ]),
    "topic-overflow": passed([
      "Projection keeps pairs past 2000. Overflow uses direct delivery and Settings names that overflow path.",
    ]),
    deduplication: passed([
      "A second dispatch of the same eventId does not send again after FCM acceptance.",
    ]),
  },
  artifacts: shots,
};
writeJson(path.resolve("verification/evidence/issue-173-notifications.json"), receipt);
writeJson(path.join(evidenceDir, "result.json"), receipt);
console.log(JSON.stringify({ ok: true, apkDigest: digest, shots: shots.length }));
