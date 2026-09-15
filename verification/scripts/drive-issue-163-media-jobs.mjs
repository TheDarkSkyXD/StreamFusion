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
const outDir = path.resolve("verification/evidence/issue-163");
const packageName = "com.thedarkskyxd.streamfusion.dev";
const launchUri =
  "exp+streamfusion-development://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081";
mkdirSync(outDir, { recursive: true });

function run(args, options = {}) {
  return execFileSync(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: options.timeout ?? 90_000,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function screenshot(name) {
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

function nodesFrom(xml) {
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

function findNode(xml, predicate) {
  return nodesFrom(xml).find(predicate) ?? null;
}

function findControl(xml, res, desc) {
  return (
    findNode(xml, (node) => node.res === res) ??
    findNode(xml, (node) => node.clickable && node.desc === desc)
  );
}

function tap(node, yBias = 0.5) {
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

function dumpUi() {
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

function hasText(xml, value) {
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

const BOTTOM_TABS = {
  Search: [112, 2032],
  Following: [326, 2032],
  Watch: [540, 2032],
  Activity: [753, 2032],
  More: [967, 2032],
};

function tapBottom(name) {
  const point = BOTTOM_TABS[name];
  if (!point) throw new Error(`${name} tab missing`);
  run(["shell", "input", "tap", String(point[0]), String(point[1])]);
  sleep(1500);
}

function waitFor(predicate, label, attempts = 24, swipe = false) {
  let xml = "";
  for (let i = 0; i < attempts; i += 1) {
    xml = dumpUi();
    const node = nodesFrom(xml).find((item) => predicate(item, xml));
    if (node) return { xml, node };
    if (swipe && i > 1) swipeUp();
    sleep(1200);
  }
  writeFileSync(path.join(outDir, "last-fail.xml"), xml);
  screenshot("last-fail");
  throw new Error(`missing ${label}`);
}

function swipeUp() {
  run(["shell", "input", "swipe", "540", "1500", "540", "520", "420"]);
  sleep(700);
}

function forceStop() {
  run(["shell", "am", "force-stop", packageName]);
  sleep(1500);
}

function launch() {
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

function tapBack(xml) {
  const back = findNode(
    xml,
    (node) => node.clickable && (node.desc === "Back" || node.text === "Back"),
  );
  if (!back) return false;
  tap(back);
  sleep(1000);
  return true;
}

function openMoreDestinations() {
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

function openDiagnostics() {
  let xml = openMoreDestinations();
  if (findNode(xml, (node) => node.res === "media-jobs-diagnostics")) return xml;
  if (findNode(xml, (node) => node.res === "screen-more-diagnostics")) {
    return waitFor(
      (node) => node.res === "media-jobs-diagnostics",
      "Media Jobs diagnostics",
      16,
      true,
    ).xml;
  }
  const destination = waitFor(
    (node) =>
      node.res === "open-more-diagnostics" &&
      node.bottom <= 1980 &&
      node.top >= 320,
    "Diagnostics destination",
    16,
    true,
  ).node;
  tap(destination, 0.35);
  sleep(1500);
  return waitFor(
    (node) => node.res === "media-jobs-diagnostics",
    "Media Jobs diagnostics",
    16,
    true,
  ).xml;
}

function visibleControl(testId, label) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const xml = dumpUi();
    const button = findControl(xml, testId, label);
    if (button && button.height >= 48 && button.bottom <= 1980) {
      return button;
    }
    swipeUp();
  }
  throw new Error(`${label} missing`);
}

function startFixture(testId, label) {
  openDiagnostics();
  tap(visibleControl(testId, label));
  sleep(800);
  waitFor(
    (node) =>
      node.res === "media-job-detail" ||
      node.res === "media-job-phase" ||
      node.text === "Download" ||
      node.text === "Recording" ||
      node.text.includes("Failed"),
    "Media Job preview",
    20,
  );
}

function leaveJobPreview() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const xml = dumpUi();
    if (!findNode(xml, (node) => node.res === "media-job-detail")) return xml;
    if (!tapBack(xml)) break;
  }
  return dumpUi();
}

function tapRecover() {
  tap(visibleControl("media-jobs-recover", "Recover Media Jobs"));
  sleep(2000);
  return true;
}

function jobCount(xml) {
  return nodesFrom(xml).filter(
    (node) =>
      node.res.startsWith("media-jobs-open-") ||
      (node.clickable && node.desc.toLowerCase().includes("open download")) ||
      (node.clickable && node.desc.toLowerCase().includes("open recording")),
  ).length;
}

function reversePort() {
  run(["reverse", "tcp:8081", "tcp:8081"]);
}

function waitForBoot() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const ready = run(["shell", "getprop", "sys.boot_completed"]).trim();
      if (ready === "1") return;
    } catch {
      // emulator is still restarting
    }
    sleep(3000);
  }
  throw new Error("emulator did not finish boot");
}

const shots = [];
reversePort();
forceStop();
launch();
openDiagnostics();
shots.push(screenshot("01-diagnostics"));
startFixture("media-jobs-start-download", "Start fixture download");
const pauseWait = waitFor(
  (node) =>
    node.res === "media-job-command-pause" ||
    node.desc === "Pause" ||
    node.text === "Pause",
  "Pause command",
  20,
  true,
);
shots.push(screenshot("02-download-running"));
tap(pauseWait.node);
sleep(1500);
waitFor(
  (node) =>
    (node.res === "media-job-phase" && node.text === "Paused") ||
    node.text === "Paused" ||
    node.res === "media-job-command-resume",
  "Paused job",
  12,
);
shots.push(screenshot("03-download-paused"));
leaveJobPreview();
tapBottom("Activity");
sleep(1200);
let activityXml = dumpUi();
const jobsFilter =
  findNode(activityXml, (node) => node.res === "activity-filter-jobs") ??
  findNode(
    activityXml,
    (node) => node.clickable && (node.desc === "Jobs Activity" || node.text === "Jobs"),
  );
if (jobsFilter) {
  tap(jobsFilter);
  sleep(1200);
  activityXml = dumpUi();
}
shots.push(screenshot("04-activity-jobs"));
if (!hasText(activityXml, "Download") && !hasText(activityXml, "Job")) {
  throw new Error("Activity Jobs did not show the download");
}
openDiagnostics();
const recover = visibleControl("media-jobs-recover", "Recover Media Jobs");
const before = jobCount(dumpUi());
tap(recover);
sleep(2000);
swipeUp();
const after = jobCount(dumpUi());
if (before > 0 && after !== before) {
  throw new Error(`Recover duplicated jobs: ${before} -> ${after}`);
}
shots.push(screenshot("05-activity-reconcile"));
startFixture(
  "media-jobs-start-storage-pressure",
  "Start storage-pressure fixture",
);
waitFor(
  (node) =>
    node.text.includes("Failed, retryable") ||
    node.text.includes("storage is full") ||
    node.text.includes("Failed"),
  "storage-pressure failure",
  24,
);
shots.push(screenshot("06-storage-pressure"));
startFixture("media-jobs-start-download", "Start fixture download");
sleep(800);
forceStop();
launch();
openDiagnostics();
tapRecover();
waitFor(
  (node) =>
    node.res.startsWith("media-jobs-open-") ||
    node.text === "Download" ||
    node.text.includes("Queued") ||
    node.text.includes("Paused") ||
    node.text.includes("Running") ||
    node.text.includes("Completed"),
  "recovered job after process death",
  16,
  true,
);
shots.push(screenshot("07-process-death"));
run(["reboot"], { timeout: 30_000 });
waitForBoot();
reversePort();
sleep(8000);
launch();
openDiagnostics();
tapRecover();
waitFor(
  (node) =>
    node.res.startsWith("media-jobs-open-") ||
    node.text === "Download" ||
    node.text.includes("Paused") ||
    node.text.includes("Completed") ||
    node.text.includes("Failed"),
  "recovered job after reboot",
  20,
  true,
);
shots.push(screenshot("08-reboot"));

writeFileSync(
  path.join(outDir, "observations.json"),
  `${JSON.stringify({ shots }, null, 2)}\n`,
);
console.log(JSON.stringify({ shots }, null, 2));
