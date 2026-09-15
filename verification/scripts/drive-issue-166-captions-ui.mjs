import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const androidHome =
  process.env.ANDROID_HOME ?? "C:\\Users\\Admin\\AppData\\Local\\Android\\Sdk";
const adb =
  process.env.ADB ??
  path.join(
    androidHome,
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
const serial = process.env.ANDROID_SERIAL ?? "emulator-5554";
export const outDir = path.resolve("verification/evidence/issue-166");
const packageName = "com.thedarkskyxd.streamfusion.dev";
const launchUri =
  "exp+streamfusion-development://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081";
mkdirSync(outDir, { recursive: true });

const BOTTOM_TABS = {
  Search: [112, 2032],
  Following: [326, 2032],
  Watch: [540, 2032],
  Activity: [753, 2032],
  More: [967, 2032],
};

export function run(args, options = {}) {
  return execFileSync(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: options.timeout ?? 90_000,
  });
}

export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function screenshot(name) {
  const remote = `/sdcard/${name}.png`;
  const local = path.join(outDir, `${name}.png`);
  run(["shell", "screencap", "-p", remote]);
  run(["pull", remote, local]);
  const digest = createHash("sha256").update(readFileSync(local)).digest("hex");
  return {
    name,
    path: path.relative(process.cwd(), local).replaceAll("\\", "/"),
    sha256: `sha256:${digest}`,
  };
}

export function nodesFrom(xml) {
  return [...xml.matchAll(/<node [^>]+>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((item) => [
        item[1],
        item[2]
          .replaceAll("&amp;", "&")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">"),
      ]),
    );
    const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    const left = bounds ? Number(bounds[1]) : 0;
    const top = bounds ? Number(bounds[2]) : 0;
    const right = bounds ? Number(bounds[3]) : 0;
    const bottom = bounds ? Number(bounds[4]) : 0;
    return {
      text: attrs.text ?? "",
      desc: attrs["content-desc"] ?? "",
      res: attrs["resource-id"] ?? "",
      clickable: attrs.clickable === "true",
      enabled: attrs.enabled !== "false",
      left,
      top,
      right,
      bottom,
      height: bottom - top,
      x: (left + right) / 2,
      y: (top + bottom) / 2,
    };
  });
}

export function findNode(xml, predicate) {
  return nodesFrom(xml).find(predicate) ?? null;
}

export function findControl(xml, res, desc) {
  return (
    findNode(xml, (node) => node.res === res) ??
    findNode(xml, (node) => node.clickable && node.desc === desc)
  );
}

export function tap(node, yBias = 0.5) {
  if (node === null) throw new Error("tap target missing");
  const y = node.top + (node.bottom - node.top) * yBias;
  run([
    "shell",
    "input",
    "tap",
    String(Math.round(node.x)),
    String(Math.round(y)),
  ]);
}

export function dumpUi() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      run(["shell", "uiautomator", "dump", "/sdcard/uidump.xml"], {
        timeout: 90_000,
      });
      const local = path.join(outDir, "uidump.xml");
      run(["pull", "/sdcard/uidump.xml", local]);
      const xml = readFileSync(local, "utf8");
      if (dismissAnr(xml) || dismissDevMenu(xml)) continue;
      if (xml.length < 15000) {
        sleep(1500);
        continue;
      }
      return xml;
    } catch {
      sleep(2000);
    }
  }
  throw new Error("uiautomator dump failed");
}

function dismissAnr(xml) {
  const wait = findNode(xml, (node) => node.text === "Wait");
  if (wait) {
    tap(wait);
    sleep(1500);
    return true;
  }
  return false;
}

function dismissDevMenu(xml) {
  const close = findNode(
    xml,
    (node) =>
      node.clickable &&
      (node.desc === "Close" ||
        node.text === "Close" ||
        node.desc === "Dismiss" ||
        node.text === "Continue"),
  );
  if (close) {
    tap(close);
    sleep(1500);
    return true;
  }
  if (hasText(xml, "Fast Refresh") || hasText(xml, "Open React Native dev menu")) {
    run(["shell", "input", "tap", "540", "200"]);
    sleep(1500);
    return true;
  }
  return false;
}

export function hasText(xml, value) {
  return nodesFrom(xml).some(
    (node) => node.text.includes(value) || node.desc.includes(value),
  );
}

function bottomTab(name) {
  const res = `nav-${name.toLowerCase()}`;
  return (node) =>
    node.res === res ||
    (node.clickable && node.desc === name && node.y > 1800 && node.x > 10);
}

export function tapBottom(name) {
  const point = BOTTOM_TABS[name];
  if (!point) throw new Error(`${name} tab missing`);
  run(["shell", "input", "tap", String(point[0]), String(point[1])]);
  sleep(1500);
}

export function waitFor(predicate, label, attempts = 24, swipe = false, delayMs = 1200) {
  let xml = "";
  for (let i = 0; i < attempts; i += 1) {
    xml = dumpUi();
    const node = nodesFrom(xml).find((item) => predicate(item, xml));
    if (node) return { xml, node };
    if (swipe && i > 1) swipePage();
    sleep(delayMs);
  }
  writeFileSync(path.join(outDir, "last-fail.xml"), xml);
  screenshot("last-fail");
  throw new Error(`missing ${label}`);
}

export function swipePage() {
  run(["shell", "input", "swipe", "540", "1500", "540", "520", "420"]);
  sleep(700);
}

export function swipeUp() {
  run(["shell", "input", "swipe", "540", "1480", "540", "1080", "320"]);
  sleep(500);
}

export function swipeDown() {
  run(["shell", "input", "swipe", "540", "720", "540", "1220", "320"]);
  sleep(500);
}

export function forceStop() {
  run(["shell", "am", "force-stop", packageName]);
  sleep(1500);
}

export function launch() {
  run([
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    launchUri,
    packageName,
  ]);
  sleep(5000);
  waitFor(
    (node) => node.res === "nav-more" || node.res === "shell-accounts",
    "app shell",
    20,
  );
}

export function tapBack(xml) {
  const back = findNode(
    xml,
    (node) => node.clickable && (node.desc === "Back" || node.text === "Back"),
  );
  if (!back) return false;
  tap(back);
  sleep(1000);
  return true;
}

export function reversePort() {
  run(["reverse", "tcp:8081", "tcp:8081"]);
}

export function hideKeyboard() {
  const xml = dumpUi();
  if (findNode(xml, bottomTab("Search")) || findNode(xml, bottomTab("More"))) {
    return xml;
  }
  run(["shell", "input", "tap", "540", "720"]);
  sleep(700);
  return dumpUi();
}

export function openMoreDestinations() {
  let xml = dumpUi();
  if (hasText(xml, "More destinations")) return xml;
  const nested =
    findNode(xml, (node) => node.res?.startsWith("screen-more-")) ??
    findNode(xml, (node) => node.res === "screen-more-diagnostics");
  if (nested && tapBack(xml)) {
    xml = dumpUi();
    if (hasText(xml, "More destinations")) return xml;
  }
  tapBottom("More");
  xml = dumpUi();
  if (hasText(xml, "More destinations")) return xml;
  if (tapBack(xml)) xml = dumpUi();
  return xml;
}
