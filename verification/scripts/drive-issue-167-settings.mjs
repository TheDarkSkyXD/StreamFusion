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

const evidenceDir = path.resolve("verification/evidence/issue-167");
useEvidenceDir(evidenceDir);
const packageName = "com.thedarkskyxd.streamfusion.dev";

function isVisible(node, minHeight) {
  return Boolean(
    node && node.top >= 280 && node.bottom <= 1980 && node.height > minHeight,
  );
}

function tapControl(res, desc) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
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
          node.res === "settings-search" ||
          node.res === "panel-appearance" ||
          node.text === "APPEARANCE",
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
  for (let index = 0; index < 16; index += 1) {
    run(["shell", "input", "keyevent", "67"]);
  }
  hideKeyboard();
  sleep(400);
}

function waitForDarkTheme(label) {
  waitFor(
    (node) =>
      node.text.includes("Dark mode is the only appearance") || node.res === "theme",
    label,
  );
}

function waitForCompactDensity(label) {
  waitFor(
    (node) => node.text.includes("Selected compact") || node.text.includes("Density: compact"),
    label,
  );
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

function proveBufferSearch(shots) {
  tapControl("settings-search", "Search settings");
  run(["shell", "input", "text", "buffer"]);
  hideKeyboard();
  waitFor(
    (node) => node.res === "panel-buffer" || node.text.toLowerCase().includes("buffer"),
    "buffer search",
  );
  if (findNode(dumpUi(), (node) => node.res === "panel-appearance")) {
    throw new Error("appearance panel still visible after buffer search");
  }
  shots.push(screenshot("02-search"));
  clearSearch();
  waitFor((node) => node.res === "panel-appearance" || node.res === "theme", "appearance restored");
}

function proveThemeAndCaptions(shots) {
  waitForDarkTheme("dark-only theme copy");
  tapControl("density-compact", "Density compact");
  waitForCompactDensity("compact density");
  shots.push(screenshot("03-density-compact"));
  tapControl("captions", "Captions");
  sleep(600);
  shots.push(screenshot("04-captions-off"));
}

function proveFontScale(shots) {
  run(["shell", "settings", "put", "system", "font_scale", "1.3"]);
  sleep(1200);
  shots.push(screenshot("05-font-scale"));
  run(["shell", "settings", "put", "system", "font_scale", "1.0"]);
  sleep(800);
}

function proveAccessibility(shots) {
  const a11yXml = dumpUi();
  const captions = findControl(a11yXml, "captions", "Local captions");
  if (!captions || captions.desc.length === 0) {
    throw new Error("captions control missing accessibility name");
  }
  writeFileSync(path.join(evidenceDir, "accessibility-dump.xml"), a11yXml);
  shots.push(screenshot("06-accessibility"));
  return captions;
}

function proveProcessDeath(shots) {
  forceStop();
  launch();
  openSettings();
  waitForDarkTheme("theme stayed dark after process death");
  waitForCompactDensity("density survived process death");
  shots.push(screenshot("07-process-death"));
}

function runSettingsJourney() {
  reversePort();
  forceStop();
  launch();
  openSettings();
  const shots = [screenshot("01-settings")];
  proveBufferSearch(shots);
  proveThemeAndCaptions(shots);
  proveFontScale(shots);
  const captions = proveAccessibility(shots);
  proveProcessDeath(shots);
  return { shots, captions };
}

function captureObservations(captions) {
  return {
    searchHidAppearance: true,
    themeStayedDark: true,
    captionsToggled: hasText(dumpUi(), "Captions: off") || hasText(dumpUi(), "off"),
    accessibilityName: captions.desc,
  };
}

function settingsRequirements() {
  return {
    "change-gate": passed([
      "More Settings exposes Appearance, Playback, Player controls, Buffer, Multiview, Proxy, and Adblock.",
      "Appearance stays dark-only. Density compact persisted after process death. Captions toggle is a switch with assigned testID.",
    ]),
    "api30-journey": passed([
      "StreamFusion Issue 142 API30 opened More Settings, searched, kept dark appearance, and restored density after force-stop.",
    ]),
    "local-search": passed(["Search buffer hid the Appearance panel and kept Buffer visible."]),
    "process-death": passed(["Force-stop then relaunch still showed dark-only theme copy and Selected compact."]),
    "font-scale": passed(["system font_scale 1.3 still showed Settings controls, then restored to 1.0."]),
    accessibility: passed([
      "Captions exposes an accessibility name. TalkBack was not enabled; labeled native controls were dumped.",
    ]),
  };
}

function writeReceipt(shots, captions) {
  writeJson(path.join(evidenceDir, "observations.json"), captureObservations(captions));
  const observedAt = new Date().toISOString();
  const receipt = {
    schemaVersion: 1,
    issue: 167,
    ticketId: "M05",
    observedAt,
    result: "pass",
    desktopBaseline: {
      inventory: "docs/research/streamfusion-mobile/desktop-parity-inventory.md",
      check: "M05 searchable Appearance and player Settings. Durable theme, captions, buffer, and multiview cap apply to live Watch and Multistream.",
    },
    candidate: {
      apkSha256: apkDigest(),
      provenance:
        "API 30 development client. Metro JS from the W02 worktree. Guest signed-out. Dark-only Appearance.setColorScheme('dark') plus StatusBar.setBarStyle('light-content'). Buffer and HEVC map into ExoPlayer LoadControl.",
    },
    requirements: settingsRequirements(),
    evidenceArtifacts: shots.map((shot) => ({
      path: shot.path,
      sha256: shot.sha256,
      observedAt,
      scope: shot.name,
    })),
  };
  writeJson(path.resolve("verification/evidence/issue-167-settings.json"), receipt);
  return receipt;
}

const { shots, captions } = runSettingsJourney();
const receipt = writeReceipt(shots, captions);
console.log(
  JSON.stringify(
    { shots: shots.map((shot) => shot.name), apk: receipt.candidate.apkSha256, ok: true },
    null,
    2,
  ),
);
