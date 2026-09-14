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
const outDir = path.resolve("verification/evidence/issue-160");
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

function tap(node, yShift = 0) {
  if (node === null) throw new Error("tap target missing");
  run([
    "shell",
    "input",
    "tap",
    String(Math.round(node.x)),
    String(Math.round(node.y + yShift)),
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
  const cont = findNode(
    xml,
    (node) => node.text === "Continue" || node.desc === "Continue",
  );
  if (cont) {
    tap(cont);
    sleep(1500);
    return true;
  }
  if (hasText(xml, "Fast Refresh") || hasText(xml, "Open React Native dev menu")) {
    run(["shell", "input", "tap", "990", "210"]);
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
  run(["shell", "input", "swipe", "180", "1520", "180", "520", "280"]);
  sleep(700);
}

function isOnScreen(node) {
  return node.height > 48 && node.top >= 200 && node.bottom <= 1880;
}

function twitchChannelCard(node) {
  return (
    node.clickable &&
    (node.res.startsWith("search-channel-twitch") ||
      /on twitch/i.test(`${node.desc} ${node.text}`))
  );
}

function hideKeyboard() {
  const xml = dumpUi();
  if (findNode(xml, bottomTab("Search"))) return xml;
  run(["shell", "input", "tap", "1014", "1960"]);
  sleep(700);
  const afterIme = dumpUi();
  if (findNode(afterIme, bottomTab("Search"))) return afterIme;
  return afterIme;
}

const observations = [];
const artifacts = [];

function observe(step, xml, extra = {}) {
  observations.push({
    step,
    texts: nodesFrom(xml)
      .map((node) => node.text || node.desc)
      .filter((value) => value.length > 0)
      .slice(0, 60),
    ...extra,
  });
}

function shot(name, xml, extra) {
  artifacts.push(screenshot(name));
  observe(name, xml, extra);
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
}

const BOTTOM_TABS = {
  Search: [112, 2032],
  Following: [326, 2032],
  Watch: [540, 2032],
  Activity: [753, 2032],
  More: [967, 2032],
};

function tapBottom(name) {
  const xml = dumpUi();
  const tab = findNode(xml, bottomTab(name));
  if (tab) tap(tab);
  else {
    const point = BOTTOM_TABS[name];
    if (!point) throw new Error(`${name} tab missing`);
    run(["shell", "input", "tap", String(point[0]), String(point[1])]);
  }
  sleep(1500);
}

function openMoreDestinations() {
  let xml = dumpUi();
  if (hasText(xml, "More destinations")) return xml;
  const nestedMore =
    findNode(xml, (node) => node.res?.startsWith("screen-more-")) ??
    findNode(xml, (node) => node.text.includes("Multistream ·"));
  if (nestedMore) {
    const back = findNode(
      xml,
      (node) =>
        node.clickable && (node.desc === "Back" || node.text === "Back"),
    );
    if (back) {
      tap(back);
      sleep(1000);
      xml = dumpUi();
      if (hasText(xml, "More destinations")) return xml;
    }
  }
  tapBottom("More");
  sleep(1200);
  xml = dumpUi();
  if (hasText(xml, "More destinations")) return xml;
  const back = findNode(
    xml,
    (node) => node.clickable && (node.desc === "Back" || node.text === "Back"),
  );
  if (back) {
    tap(back);
    sleep(1000);
    xml = dumpUi();
  }
  return xml;
}

function openMore() {
  return openMoreDestinations();
}

function openMultistream() {
  let xml = dumpUi();
  if (
    hasText(xml, "Multistream ·") ||
    findNode(xml, (node) => node.res === "screen-multi") ||
    findNode(xml, (node) => node.res === "screen-more-multistream")
  ) {
    return xml;
  }
  xml = openMoreDestinations();
  if (
    hasText(xml, "Multistream ·") ||
    findNode(xml, (node) => node.res === "screen-multi")
  ) {
    return xml;
  }
  const destination =
    findNode(xml, (node) => node.res === "open-more-multistream") ??
    findNode(xml, (node) => node.desc === "Multistream" || node.text === "Multistream") ??
    findNode(xml, (node) => node.res === "more-multistream");
  if (!destination) throw new Error("Multistream destination missing");
  tap(destination);
  sleep(1500);
  waitFor(
    (node) =>
      node.res === "screen-multi" ||
      node.res === "screen-more-multistream" ||
      node.text.includes("Multistream ·"),
    "Multistream room",
    16,
  );
  return dumpUi();
}

function openSearch() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    tapBottom("Search");
    const xml = dumpUi();
    if (
      hasText(xml, "Search Twitch + Kick") ||
      hasText(xml, "Search streams") ||
      hasText(xml, "Search works without signing in")
    ) {
      return xml;
    }
  }
  throw new Error("Search destination did not open");
}

function openHome() {
  let xml = openMore();
  if (
    findNode(xml, (node) => node.res === "home-live-discovery") ||
    findNode(xml, (node) => node.res === "screen-more-home")
  ) {
    return xml;
  }
  const destination =
    findNode(xml, (node) => node.res === "open-more-home") ??
    findNode(xml, (node) => node.desc === "Home" || node.text === "Home");
  if (!destination) throw new Error("Home destination missing");
  tap(destination);
  sleep(2000);
  waitFor(
    (node) =>
      node.res === "home-live-discovery" ||
      node.res.startsWith("home-stream-"),
    "Home live discovery",
    24,
    true,
  );
  return dumpUi();
}

function searchChannel(query) {
  let xml = openSearch();
  const repeat = findNode(
    xml,
    (node) =>
      node.res === `repeat-search-${query}` ||
      node.desc === `Search again for ${query}`,
  );
  if (repeat) {
    tap(repeat);
  } else {
    const field = findNode(xml, (node) => node.res === "search-field");
    if (field) tap(field);
    sleep(400);
    run(["shell", "input", "text", query]);
    sleep(400);
    xml = dumpUi();
    const submit = findNode(xml, (node) => node.res === "submit-search");
    if (submit) tap(submit);
    else run(["shell", "input", "keyevent", "66"]);
  }
  sleep(3000);
  xml = hideKeyboard();
  const channelsChip = findNode(
    xml,
    (node) => node.res === "search-tab-channels" && node.clickable,
  );
  if (channelsChip) {
    tap(channelsChip);
    sleep(1500);
    xml = dumpUi();
  }
  const twitch = waitFor(twitchChannelCard, `${query} Twitch channel`, 30, true);
  tap(twitch.node);
  sleep(1500);
  return waitFor(
    (node) =>
      node.res === "channel-detail" ||
      node.res === "channel-header" ||
      node.res === "channel-add-multistream",
    "channel detail",
    16,
  ).xml;
}

const usedHomeStreams = new Set();

function addLiveFromHome() {
  let xml = openHome();
  const card = waitFor(
    (node) =>
      node.res.startsWith("home-stream-") &&
      !usedHomeStreams.has(node.res) &&
      node.height > 80,
    "live Home stream",
    30,
    true,
  );
  usedHomeStreams.add(card.node.res);
  tap(card.node);
  sleep(2000);
  return addCurrentChannel();
}

function addCurrentChannel() {
  const add = waitFor(
    (node) => node.res === "channel-add-multistream" && node.enabled,
    "Add to Multistream",
    12,
    true,
  );
  tap(add.node);
  sleep(2000);
  return dumpUi();
}

function tapByRes(res, label = res) {
  const found = waitFor((node) => node.res === res && node.clickable, label, 12, true);
  tap(found.node);
  sleep(1200);
  return dumpUi();
}

try {
  try {
    run(["shell", "cmd", "thermalservice", "reset"]);
  } catch {
    // API 30 emulators may not expose thermalservice override.
  }
  run(["shell", "wm", "size", "reset"]);
  forceStop();
  launch();
  sleep(5000);
  dumpUi();

  let xml = openMultistream();
  shot("01-multistream-empty", xml, {
    empty: hasText(xml, "0 configured") || hasText(xml, "Empty slot"),
  });

  xml = addLiveFromHome();
  shot("02-channel-first", xml);
  xml = dumpUi();
  shot("03-after-first-add", xml, {
    configured: hasText(xml, "1 configured"),
  });

  xml = addLiveFromHome();
  shot("04-second-live", xml, {
    configured: hasText(xml, "2 configured"),
  });
  xml = dumpUi();
  shot("05-two-slots", xml, {
    configured: hasText(xml, "2 configured") || hasText(xml, "3 configured"),
    active: hasText(xml, "2 active") || hasText(xml, "1 active"),
  });
  xml = addLiveFromHome();
  shot("06-retained-third", xml, {
    retained: hasText(xml, "retained") || hasText(xml, "3 configured"),
  });

  xml = tapByRes("multistream-edit", "Edit");
  shot("07-edit-sheet", xml);
  const done = findNode(xml, (node) => node.res === "close-multistream-edit");
  if (done) {
    tap(done);
    sleep(1000);
    xml = dumpUi();
  }

  const audio = findNode(xml, (node) => node.res.startsWith("audio-owner-") && node.enabled);
  if (audio) {
    tap(audio);
    sleep(1000);
    xml = dumpUi();
  }
  shot("08-audio-owner", xml);

  xml = tapByRes("restore-slot", "Restore slot");
  shot("09-restore-slot", xml);

  try {
    run(["shell", "cmd", "thermalservice", "override-status", "3"]);
  } catch {
    // Keep going; Cool device still exercises recovery.
  }
  sleep(2500);
  xml = tapByRes("cool-device", "Cool device");
  try {
    run(["shell", "cmd", "thermalservice", "reset"]);
  } catch {
    // ignore
  }
  sleep(2000);
  xml = dumpUi();
  shot("10-thermal-and-cool", xml, {
    thermal: hasText(xml, "Stage") || hasText(xml, "thermal") || hasText(xml, "retained"),
  });

  run(["shell", "wm", "size", "1280x800"]);
  sleep(2000);
  xml = dumpUi();
  shot("11-tablet-width", xml);
  run(["shell", "wm", "size", "reset"]);
  sleep(1500);

  const pip = findNode(xml, (node) => node.res === "multistream-pip");
  if (pip) {
    tap(pip);
    sleep(2500);
    xml = dumpUi();
    shot("12-pip-handoff", xml);
    run(["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"]);
    sleep(1200);
    run(["shell", "input", "tap", "540", "1100"]);
    sleep(1500);
    xml = dumpUi();
  }

  forceStop();
  launch();
  sleep(5000);
  xml = openMultistream();
  shot("13-process-death", xml, {
    restored: hasText(xml, "3 configured") || hasText(xml, "2 configured") || hasText(xml, "1 configured"),
  });

  writeFileSync(
    path.join(outDir, "observations.json"),
    JSON.stringify({ artifacts, observations }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        artifacts: artifacts.map((item) => item.path),
        last: observations.at(-1),
      },
      null,
      2,
    ),
  );
} catch (error) {
  writeFileSync(
    path.join(outDir, "observations.json"),
    JSON.stringify(
      {
        ok: false,
        error: String(error?.message ?? error),
        artifacts,
        observations,
      },
      null,
      2,
    ),
  );
  throw error;
}
