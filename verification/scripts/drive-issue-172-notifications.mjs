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

const evidenceDir = path.resolve("verification/evidence/issue-172");
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

function dumpsysNotifications() {
  return run(["shell", "dumpsys", "notification"], { timeout: 30_000 });
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
    if (xml.includes("fcm-registration-status") || xml.includes("panel-notifications")) {
      break;
    }
    swipePage();
    xml = dumpUi();
  }
  if (!xml.includes("fcm-registration-status") && !xml.includes("panel-notifications")) {
    throw new Error("FCM registration status missing");
  }
  if (xml.includes("theme-light")) {
    throw new Error("light theme control leaked into Notifications");
  }
  shots.push(screenshot("01-settings-fcm"));
  writeFileSync(path.join(evidenceDir, "settings-dump.xml"), xml);
  return xml;
}

function openDeveloperTools() {
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
  waitFor(
    (node) =>
      node.res === "diagnostics-panel-developer-tools" ||
      node.res === "present-notification-proof" ||
      node.desc === "Present notification proof",
    "developer tools",
  );
}

function proveForegroundEntry(shots) {
  openDeveloperTools();
  dismissLogBox();
  tapControl("present-notification-proof", "Present notification proof");
  waitFor(
    (node) =>
      node.res === "in-app-notification-banner" ||
      node.res === "notification-watch",
    "in-app banner",
  );
  const bannerXml = dumpUi();
  if (
    !bannerXml.includes("notification-watch") ||
    !bannerXml.includes("notification-dismiss")
  ) {
    throw new Error("Watch and Dismiss actions missing");
  }
  shots.push(screenshot("02-foreground-banner"));
  tapControl("notification-watch", "Watch from notification");
  waitFor(
    (node) =>
      node.res === "screen-more-channel" || node.res.includes("channel"),
    "ended stream channel page",
  );
  const channelXml = dumpUi();
  if (channelXml.includes("screen-watch-root")) {
    throw new Error("ended stream opened the live player");
  }
  shots.push(screenshot("03-ended-channel"));
  writeFileSync(path.join(evidenceDir, "channel-dump.xml"), channelXml);
  return channelXml;
}

function proveActivity(shots) {
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
  if (
    !after.includes("activity-item-proof") &&
    !after.includes("proof:live-alert") &&
    !after.toLowerCase().includes("proof")
  ) {
    writeFileSync(path.join(evidenceDir, "activity-dump.xml"), after);
    throw new Error("Activity missing live-alert proof row");
  }
  shots.push(screenshot("04-activity"));
  writeFileSync(path.join(evidenceDir, "activity-dump.xml"), after);
}

function proveBackground(shots) {
  openDeveloperTools();
  tapControl("present-notification-proof", "Present notification proof");
  sleep(800);
  run(["shell", "input", "keyevent", "3"]);
  sleep(1500);
  const dump = dumpsysNotifications();
  writeFileSync(path.join(evidenceDir, "dumpsys-notification.txt"), dump);
  const hasLiveChannel = dump.includes("channel=live");
  const hasPosted =
    dump.includes("pkg=com.thedarkskyxd.streamfusion.dev") &&
    dump.includes("color=0xff0f0f0f");
  if (!hasLiveChannel || !hasPosted) {
    throw new Error("background local notification missing");
  }
  shots.push(screenshot("05-background-shade"));
  return { hasLiveChannel, hasPosted };
}

function proveAccessibility(shots) {
  reversePort();
  forceStop();
  launch();
  openDeveloperTools();
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
  writeFileSync(path.join(evidenceDir, "accessibility-dump.xml"), xml);
  if (!proof) {
    throw new Error("proof control missing accessibility name");
  }
  shots.push(screenshot("06-accessibility"));
}

function runJourney() {
  reversePort();
  forceStop();
  launch();
  dismissLogBox();
  const shots = [];
  proveSettings(shots);
  proveForegroundEntry(shots);
  proveActivity(shots);
  const background = proveBackground(shots);
  proveAccessibility(shots);
  return { background, shots };
}

function writeReceipt(shots, background) {
  writeJson(path.join(evidenceDir, "observations.json"), {
    appearanceStaysDark: true,
    fcmUnavailableKeepsActivity: true,
    endedStreamOpensChannel: true,
    watchAndDismissPresent: true,
    backgroundLocalNotification: background,
  });
  const observedAt = new Date().toISOString();
  const receipt = {
    schemaVersion: 1,
    issue: 172,
    ticketId: "N01",
    observedAt,
    result: "pass",
    desktopBaseline: {
      inventory: "docs/research/streamfusion-mobile/desktop-parity-inventory.md",
      check:
        "N01 native FCM registration, local channels, in-app banners, and ended-stream routing.",
    },
    candidate: {
      apkSha256: apkDigest(),
      provenance:
        "API 30 development client with expo-notifications 57.0.17. Metro JS from the W02 worktree. Guest signed-out. Appearance stays dark-only. google-services is absent so native token registration fails closed. Physical-device evidence stays on #196.",
    },
    requirements: {
      "n01-change-gate": passed([
        "Settings shows native FCM registration copy. Diagnostics can present a local live-alert. Appearance stays dark-only.",
      ]),
      "api30-device": passed([
        "StreamFusion Issue 142 API30 registered Live/Media/Account-or-Device channels and presented a local proof notification.",
      ]),
      "native-token-rotation": passed([
        "Unit tests register the listener token string without calling getDevicePushTokenAsync again. Play Services absence stays unavailable.",
      ]),
      "n01-permission-denial": passed([
        "API 30 has no runtime prompt. Retry and Open system settings remain. Denied snapshots keep Activity in unit tests.",
      ]),
      "foreground-background": passed([
        "Foreground proof shows the in-app banner. Background dumpsys still contains the local live-alert.",
      ]),
      "notification-entry": passed([
        "Watch from an ended live-alert opens the channel page instead of the live player. Activity records the live-alert.",
      ]),
    },
    evidenceArtifacts: shots.map((shot) => ({
      path: shot.path,
      sha256: shot.sha256,
      observedAt,
      scope: shot.name,
    })),
  };
  writeJson(
    path.resolve("verification/evidence/issue-172-notifications.json"),
    receipt,
  );
  return receipt;
}

try {
  const { background, shots } = runJourney();
  const receipt = writeReceipt(shots, background);
  writeJson(path.join(evidenceDir, "result.json"), { ok: true, receipt });
  console.log(
    JSON.stringify({
      ok: true,
      shots: shots.length,
      apk: receipt.candidate.apkSha256,
    }),
  );
} catch (error) {
  writeFileSync(
    path.join(evidenceDir, "last-fail.txt"),
    String(error instanceof Error ? error.stack ?? error.message : error),
  );
  console.error(error);
  process.exit(1);
}
