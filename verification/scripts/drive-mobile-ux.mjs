import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  nodesFrom,
  run,
  screenshot,
  sleep,
  tap,
  useEvidenceDir,
} from "./drive-issue-166-captions-ui.mjs";

assert(
  process.env.ANDROID_SERIAL,
  "Set ANDROID_SERIAL to the reviewed emulator.",
);
const [action, target, captureName] = process.argv.slice(2);
const evidenceDir = path.resolve("verification/evidence/mobile-twitch-ux");
useEvidenceDir(evidenceDir);

function dumpUi() {
  run(["shell", "rm", "-f", "/sdcard/mobile-ux.xml"]);
  const result = run(["shell", "uiautomator", "dump", "/sdcard/mobile-ux.xml"]);
  assert(
    result.includes("dumped to"),
    "Android could not capture the current UI.",
  );
  const local = path.join(evidenceDir, "current.xml");
  run(["pull", "/sdcard/mobile-ux.xml", local]);
  const xml = readFileSync(local, "utf8");
  assert(xml.includes("<hierarchy"), "Android did not return a UI hierarchy.");
  return xml;
}

function press(target) {
  const nodes = nodesFrom(dumpUi());
  const matches = nodes.filter(
    (node) =>
      node.enabled &&
      node.height > 0 &&
      (node.res === target || node.desc === target || node.text === target),
  );
  const control = matches.find((node) => node.clickable) ?? matches[0];
  assert(control, `Visible control missing: ${target}`);
  tap(control);
  sleep(2000);
}

function capture(name) {
  assert(
    name && /^[a-z0-9-]+$/u.test(name),
    "Supply a lowercase capture name.",
  );
  const xml = dumpUi();
  writeFileSync(path.join(evidenceDir, `${name}.xml`), xml);
  const nodes = nodesFrom(xml).filter(
    (node) => node.height > 0 && (node.text || node.desc || node.res),
  );
  writeFileSync(
    path.join(evidenceDir, `${name}.json`),
    JSON.stringify(nodes, null, 2),
  );
  const shot = screenshot(name);
  console.log(
    JSON.stringify({
      capture: shot,
      controls: nodes
        .filter((node) => node.clickable)
        .map(({ text, desc, res, x, y, enabled }) => [
          res || desc || text,
          x,
          y,
          enabled,
        ]),
      text: [
        ...new Set(nodes.filter((node) => node.text).map((node) => node.text)),
      ],
    }),
  );
}

if (action === "tour-more") {
  for (const route of [
    "history",
    "downloads",
    "moderation",
    "multistream",
    "accounts",
    "diagnostics",
  ]) {
    press("nav-more");
    press("nav-more");
    press(`open-more-${route}`);
    capture(`tour-${route}`);
  }
} else if (action === "tour-settings") {
  press("shell-settings");
  for (const panel of [
    "appearance",
    "playback",
    "player-controls",
    "buffer",
    "notifications",
    "chat",
    "predictions",
    "adblock",
    "proxy",
    "integrations",
    "api-tokens",
    "updates",
    "diagnostics",
    "logs",
    "report-bug",
    "about",
  ]) {
    const id = `settings-category-${panel}`;
    let found = false;
    for (let scroll = 0; scroll < 7; scroll += 1) {
      if (
        nodesFrom(dumpUi()).some((node) => node.res === id && node.height >= 48)
      ) {
        found = true;
        break;
      }
      run(["shell", "input", "swipe", "540", "1800", "540", "650", "450"]);
      sleep(1000);
    }
    assert(found, `Settings category missing: ${panel}`);
    press(id);
    capture(`tour-settings-${panel}`);
    press("settings-category-back");
  }
} else {
  if (action === "tap") {
    press(target);
  } else if (action === "back") {
    run(["shell", "input", "keyevent", "4"]);
    sleep(2000);
  } else if (action === "scroll") {
    run(["shell", "input", "swipe", "540", "1800", "540", "650", "450"]);
    sleep(1000);
  } else {
    assert.equal(action, "snapshot", "Use snapshot, tap, back, or scroll.");
  }

  const name = action === "tap" ? captureName : target;
  capture(name);
}
