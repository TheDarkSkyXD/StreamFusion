import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodesFrom } from "../../scripts/drive-issue-166-captions-ui.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const adb = "C:/Users/Admin/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const serial = process.env.STREAMFUSION_PLAYBACK_ADB_SERIAL ?? "127.0.0.1:5581";
const run = (args, encoding = "utf8") => execFileSync(adb, ["-P", "5038", "-s", serial, ...args], { encoding, maxBuffer: 12 * 1024 * 1024, timeout: 60000, windowsHide: true });
const snapshot = () => {
  const dumped = run(["shell", "uiautomator", "dump", "/sdcard/playback-ui.xml"]);
  assert(dumped.includes("dumped to"), `Native UI snapshot failed: ${dumped}`);
  run(["pull", "/sdcard/playback-ui.xml", path.join(dir, "current.xml")]);
  return readFileSync(path.join(dir, "current.xml"), "utf8");
};
const [action, value, name] = process.argv.slice(2);
if (action === "press") {
  const node = nodesFrom(snapshot()).find(node => (node.res === value || node.desc === value || node.text === value) && node.enabled && node.right > node.left && node.height > 0);
  assert(node, `Missing visible control ${value}`);
  run(["shell", "input", "tap", String(Math.round(node.x)), String(Math.round(node.y))]);
} else if (action === "search") {
  const node = nodesFrom(snapshot()).find(node => node.res === "search-field");
  assert(node, "Search field missing");
  run(["shell", "input", "tap", String(Math.round(node.x)), String(Math.round(node.y))]);
  run(["shell", "input", "keyevent", "123"]);
  run(["shell", "input", "keyevent", ...Array(40).fill("67")]);
  run(["shell", "input", "text", value]);
  run(["shell", "input", "keyevent", "66"]);
} else if (action === "capture") {
  assert(/^[a-z0-9-]+$/.test(value));
  const xml = snapshot();
  writeFileSync(path.join(dir, `${value}.xml`), xml);
  run(["shell", "screencap", "-p", "/sdcard/playback-shot.png"]);
  run(["pull", "/sdcard/playback-shot.png", path.join(dir, `${value}.png`)]);
  writeFileSync(path.join(dir, `${value}.log`), run(["shell", "logcat", "-d", "-s", "ExoPlayerImplInternal:E"]));
  console.log(JSON.stringify(nodesFrom(xml).filter(node => node.text || node.res === "player-play-pause").map(node => ({text: node.text, id: node.res, desc: node.desc})).slice(0, 38)));
} else {
  console.log(JSON.stringify(nodesFrom(snapshot()).filter(node => node.text || node.clickable).map(node => ({text: node.text, id: node.res, desc: node.desc, bounds: [node.x,node.y]})).slice(0, 50)));
}
