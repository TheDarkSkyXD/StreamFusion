import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  ensureCaptionControls,
  openDiagnostics,
  openHomeLive,
  tapControl,
} from "./drive-issue-166-captions-flow.mjs";
import {
  dumpUi,
  findNode,
  forceStop,
  hasText,
  launch,
  reversePort,
  screenshot,
  sleep,
  tapBottom,
  waitFor,
} from "./drive-issue-166-captions-ui.mjs";

reversePort();
forceStop();
launch();
openDiagnostics();
const shots = [];
shots.push(screenshot("01-diagnostics"));
tapControl("local-captions-install-fixture", "Install fixture English model");
waitFor(
  (node) =>
    node.text.includes("43.11 MiB") &&
    (node.text.includes("sha256 verified") ||
      node.text.includes("English model ready") ||
      node.res === "local-captions-proof"),
  "verified fixture model",
  16,
);
shots.push(screenshot("02-model-ready"));
tapControl("local-captions-start-fixture", "Start fixture caption session");
waitFor(
  (node) =>
    node.text.includes("Local captions are running") ||
    node.text.includes("Decoded program audio") ||
    node.text.includes("No microphone") ||
    node.res === "local-captions-cue",
  "caption cue",
  24,
  false,
  800,
);
shots.push(screenshot("03-fixture-session"));
tapControl("local-captions-start-second", "Start second caption session");
waitFor(
  (node) =>
    node.text.includes("One caption session is already running on the focused Stream."),
  "one session limit",
  16,
);
shots.push(screenshot("04-one-session"));
tapControl("local-captions-stop", "Stop captions");
sleep(800);
tapControl("local-captions-install-integrity-fail", "Install integrity-fail fixture");
waitFor(
  (node) => node.text.includes("failed integrity verification"),
  "integrity failure",
  16,
);
ensureCaptionControls();
shots.push(screenshot("05-integrity-fail"));
tapControl("local-captions-install-fixture", "Install fixture English model");
waitFor(
  (node) => node.text.includes("English model ready"),
  "reinstalled fixture",
  16,
);
tapControl("local-captions-queue-constraint", "Queue caption constraint");
tapControl("local-captions-start-constrained", "Start constrained captions");
waitFor(
  (node) =>
    node.text.includes("Captions paused because this device is under resource pressure."),
  "constrained captions",
  16,
);
ensureCaptionControls();
shots.push(screenshot("06-constrained"));
tapControl("local-captions-clear-constraint", "Clear caption constraint");
let watchXml;
try {
  watchXml = openHomeLive();
} catch (error) {
  tapBottom("Watch");
  sleep(1500);
  watchXml = dumpUi();
  if (!hasText(watchXml, "Captions") && !findNode(watchXml, (node) => node.res === "watch-captions")) {
    throw error;
  }
}
shots.push(screenshot("07-watch-captions"));
if (!hasText(watchXml, "No microphone") && !hasText(watchXml, "No upload")) {
  throw new Error("Watch captions privacy copy missing");
}

const receipt = {
  schemaVersion: 1,
  issue: 166,
  ticketId: "M04",
  observedAt: new Date().toISOString(),
  result: "pass",
  screenshots: shots,
};
writeFileSync(
  path.resolve("verification/evidence/issue-166-captions.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify({ shots: shots.map((shot) => shot.name), ok: true }, null, 2));
