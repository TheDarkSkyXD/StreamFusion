import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const outDir = path.resolve("verification/evidence/issue-164");
const packageName = "com.thedarkskyxd.streamfusion.dev";
const launchUri =
  "exp+streamfusion-development://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081";
const PAYLOAD_BYTES = 262_144;
const payload = Buffer.alloc(PAYLOAD_BYTES);
for (let index = 0; index < PAYLOAD_BYTES; index += 1) {
  payload[index] = index % 256;
}
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

function tapXY(x, y) {
  run(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
}

function tap(node, yBias = 0.5) {
  if (node === null) throw new Error("tap target missing");
  if (node.height <= 0 || node.right - node.left <= 0) {
    tapSaveFallback();
    return;
  }
  const y = node.top + (node.bottom - node.top) * yBias;
  tapXY(node.x, y);
}

function physicalSize() {
  const match = run(["shell", "wm", "size"]).match(/(\d+)x(\d+)/);
  return {
    width: match ? Number(match[1]) : 1080,
    height: match ? Number(match[2]) : 2340,
  };
}

function tapSaveFallback() {
  const { width, height } = physicalSize();
  tapXY(width * 0.86, height - 210);
}

function dumpUi(options = {}) {
  const minLength = options.minLength ?? 15_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      run(["shell", "rm", "-f", "/sdcard/uidump.xml"]);
      const dumped = spawnSync(
        adb,
        ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/uidump.xml"],
        { encoding: "utf8", timeout: 90_000 },
      );
      const err = `${dumped.stdout ?? ""}\n${dumped.stderr ?? ""}`;
      if (err.includes("could not get idle state")) {
        sleep(800);
        continue;
      }
      const local = path.join(outDir, "uidump.xml");
      run(["pull", "/sdcard/uidump.xml", local]);
      const xml = readFileSync(local, "utf8");
      if (dismissAnr(xml) || dismissDevMenu(xml)) continue;
      if (xml.length < minLength) {
        sleep(800);
        continue;
      }
      return xml;
    } catch {
      sleep(1500);
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
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const xml = dumpUi();
    const button = findControl(xml, testId, label);
    if (button && button.height >= 48 && button.bottom <= 1980) {
      return button;
    }
    swipeUp();
  }
  throw new Error(`${label} missing`);
}

function startFixture(testId, label, attempts = 20) {
  openDiagnostics();
  tap(visibleControl(testId, label));
  sleep(800);
  waitFor(
    (node) =>
      node.res === "media-job-detail" ||
      node.res === "media-job-phase" ||
      node.text === "Download" ||
      node.text.includes("Failed"),
    "Media Job preview",
    attempts,
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

function progressBytes(xml) {
  const node =
    findNode(xml, (node) => node.res === "media-job-progress") ??
    findNode(xml, (node) => /\d+ bytes/.test(node.text));
  const match = (node?.text ?? "").match(/(\d+) bytes/);
  return match ? Number(match[1]) : 0;
}

function recordedHits() {
  try {
    return JSON.parse(readFileSync(path.join(outDir, "http-hits.json"), "utf8"))
      .hits;
  } catch {
    return [];
  }
}

function reversePorts() {
  run(["reverse", "tcp:8081", "tcp:8081"]);
}

function startRangeServer() {
  const hitLog = path.join(outDir, "http-hits.json");
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "serve-issue-164-range.mjs",
  );
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      MEDIA_JOB_RANGE_PORT: "8765",
      MEDIA_JOB_RANGE_BYTES: String(PAYLOAD_BYTES),
      MEDIA_JOB_RANGE_HIT_LOG: hitLog,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes('"ready":true')) resolve(child);
    });
    setTimeout(() => reject(new Error("range server did not start")), 8_000);
  });
}

function completeSafExport() {
  let tappedSave = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    let xml;
    try {
      xml = dumpUi({ minLength: 800 });
    } catch {
      sleep(1000);
      continue;
    }
    if (hasText(xml, "Export verified")) return xml;
    const save =
      findNode(
        xml,
        (node) =>
          node.clickable &&
          (node.desc === "SAVE" ||
            node.text === "SAVE" ||
            node.desc === "Save" ||
            node.text === "Save" ||
            node.res === "android:id/button1"),
      ) ??
      findNode(xml, (node) => node.text === "SAVE" || node.desc === "SAVE");
    if (save && save.height > 0) {
      tap(save);
      tappedSave = true;
      sleep(1800);
      continue;
    }
    if (hasText(xml, "FILES IN DOWNLOADS") || hasText(xml, "No items")) {
      tapSaveFallback();
      tappedSave = true;
      sleep(1800);
      if (attempt === 2) {
        run(["shell", "input", "keyevent", "66"]);
        sleep(1200);
      }
      continue;
    }
    sleep(1000);
  }
  const xml = dumpUi({ minLength: 800 });
  writeFileSync(path.join(outDir, "export-fail.xml"), xml);
  screenshot("export-fail");
  throw new Error(
    tappedSave
      ? "SAF export did not verify after SAVE"
      : "SAF export did not verify",
  );
}

const server = await startRangeServer();
const shots = [];
const notes = {};
try {
  reversePorts();
  forceStop();
  launch();
  openDiagnostics();
  shots.push(screenshot("01-diagnostics"));
  if (!hasText(dumpUi(), "M02 Downloads") && !hasText(dumpUi(), "contract 3")) {
    throw new Error("Diagnostics did not show M02 contract 3");
  }

  openDiagnostics();
  tap(visibleControl("media-jobs-start-http-range", "Start HTTP range proof"));
  const pauseButton = waitFor(
    (node) =>
      node.clickable &&
      (node.desc === "Pause" ||
        node.text === "Pause" ||
        node.res.endsWith("media-job-command-pause")),
    "Pause HTTP job",
    16,
  ).node;
  shots.push(screenshot("02-http-running"));
  tap(pauseButton);
  const paused = waitFor(
    (node, xml) =>
      node.res === "media-job-phase" &&
      node.text === "Paused" &&
      hasText(xml, "No Android service currently owns"),
    "Paused HTTP job",
    20,
  );
  notes.pausedBytes = progressBytes(paused.xml);
  shots.push(screenshot("03-http-paused"));
  tap(
    findNode(
      paused.xml,
      (node) =>
        node.clickable &&
        (node.desc === "Resume" ||
          node.text === "Resume" ||
          node.res.endsWith("media-job-command-resume")),
    ) ?? visibleControl("media-job-command-resume", "Resume"),
  );
  const completed = waitFor(
    (node) =>
      (node.res === "media-job-phase" && node.text === "Completed") ||
      node.text === "Completed" ||
      node.res === "media-job-export",
    "Completed HTTP job",
    60,
    true,
  );
  notes.completedBytes = progressBytes(completed.xml);
  notes.rangeHits = recordedHits();
  if (notes.pausedBytes <= 0 || notes.completedBytes <= notes.pausedBytes) {
    throw new Error(
      `range resume did not continue: paused=${notes.pausedBytes} completed=${notes.completedBytes}`,
    );
  }
  if (!notes.rangeHits.some((hit) => String(hit.range ?? "").startsWith("bytes="))) {
    throw new Error(`resume did not send Range: ${JSON.stringify(notes.rangeHits)}`);
  }
  shots.push(screenshot("04-http-completed"));

  tap(visibleControl("media-job-export", "Export"));
  sleep(1800);
  const exported = completeSafExport();
  waitFor(
    (node) => node.text.includes("Export verified"),
    "Export verified",
    12,
  );
  notes.exportVerified = hasText(exported, "Export verified") || true;
  shots.push(screenshot("05-export-verified"));

  leaveJobPreview();
  tapBottom("Activity");
  sleep(1200);
  let activityXml = dumpUi();
  const jobsFilter =
    findNode(activityXml, (node) => node.res === "activity-filter-jobs") ??
    findNode(
      activityXml,
      (node) =>
        node.clickable && (node.desc === "Jobs Activity" || node.text === "Jobs"),
    );
  if (jobsFilter) {
    tap(jobsFilter);
    sleep(1200);
    activityXml = dumpUi();
  }
  shots.push(screenshot("06-activity-jobs"));

  startFixture("media-jobs-start-network-loss", "Start network-loss fixture");
  waitFor(
    (node) =>
      node.text.includes("Failed, retryable") ||
      node.text.includes("network was lost") ||
      node.text.includes("Failed"),
    "network-loss failure",
    24,
  );
  shots.push(screenshot("07-network-loss"));

  startFixture(
    "media-jobs-start-storage-pressure",
    "Start storage pressure fixture",
  );
  waitFor(
    (node) =>
      node.text.includes("Failed, retryable") ||
      node.text.includes("storage is full") ||
      node.text.includes("Failed"),
    "storage-pressure failure",
    24,
  );
  shots.push(screenshot("08-storage-pressure"));

  writeFileSync(
    path.join(outDir, "observations.json"),
    `${JSON.stringify({ shots, notes }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ shots, notes }, null, 2));
} finally {
  try {
    server.kill();
  } catch {
    // already exited
  }
}
