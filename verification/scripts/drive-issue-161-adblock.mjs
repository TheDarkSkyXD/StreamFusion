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
const outDir = path.resolve("verification/evidence/issue-161");
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

function tap(node) {
  if (node === null) throw new Error("tap target missing");
  run([
    "shell",
    "input",
    "tap",
    String(Math.round(node.x)),
    String(Math.round(node.y)),
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

function isOnScreen(node) {
  return node.height >= 48 && node.top >= 200 && node.bottom <= 2010;
}

function liveHomeStream(platform) {
  const needle = `live on ${platform}`;
  return (node) =>
    node.clickable &&
    node.height > 80 &&
    node.desc.toLowerCase().includes(needle);
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
  const nested =
    findNode(xml, (node) => node.res?.startsWith("screen-more-")) ??
    findNode(xml, (node) => node.res === "screen-more-settings");
  if (nested) {
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

function openHomeLive() {
  let xml = openMoreDestinations();
  if (
    findNode(xml, (node) => node.res === "home-live-discovery") ||
    findNode(xml, (node) => node.res.startsWith("home-stream-"))
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
      node.res === "home-live-discovery" || node.res.startsWith("home-stream-"),
    "Home live discovery",
    24,
    true,
  );
  return dumpUi();
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

const observations = [];
const artifacts = [];

function observe(step, xml, extra = {}) {
  observations.push({
    step,
    texts: nodesFrom(xml)
      .map((node) => node.text || node.desc)
      .filter((value) => value.length > 0)
      .slice(0, 80),
    ...extra,
  });
}

function shot(name, xml, extra) {
  artifacts.push(screenshot(name));
  observe(name, xml, extra);
}

function openSettings() {
  let xml = dumpUi();
  if (findNode(xml, (node) => node.res === "panel-adblock")) return xml;
  xml = openMoreDestinations();
  const settings =
    findNode(xml, (node) => node.res === "open-more-settings") ??
    findNode(
      xml,
      (node) => node.clickable && (node.text === "Settings" || node.desc === "Settings"),
    );
  if (!settings) throw new Error("Settings destination missing");
  tap(settings);
  sleep(1500);
  return waitFor((node) => node.res === "panel-adblock", "adblock panel", 16, true)
    .xml;
}

function tapRes(res, label = res) {
  const found = waitFor(
    (node) => node.res === res && node.clickable && isOnScreen(node),
    label,
    16,
    true,
  );
  tap(found.node);
  sleep(1400);
  return dumpUi();
}

function hideKeyboard() {
  const xml = dumpUi();
  if (findNode(xml, bottomTab("Search")) || findNode(xml, bottomTab("More"))) {
    return xml;
  }
  run(["shell", "input", "tap", "540", "720"]);
  sleep(700);
  return dumpUi();
}

function dismissMiniPlayer() {
  const close = findNode(dumpUi(), (node) => node.res === "dismiss-player");
  if (!close) return;
  tap(close);
  sleep(1000);
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

function searchKickChannel(query) {
  dismissMiniPlayer();
  let xml = openSearch();
  const repeat = findNode(
    xml,
    (node) =>
      node.res === `repeat-search-${query}` ||
      node.desc === `Search again for ${query}`,
  );
  if (repeat) tap(repeat);
  else {
    const field = findNode(xml, (node) => node.res === "search-field");
    if (field) tap(field);
    sleep(400);
    run(["shell", "input", "text", query]);
    sleep(400);
    xml = dumpUi();
    const submit = findNode(xml, (node) => node.res === "submit-search");
    if (submit) tap(submit);
  }
  sleep(2500);
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
  const kick = waitFor(
    (node) =>
      node.clickable &&
      node.res.startsWith("search-channel-kick") &&
      isOnScreen(node),
    "Kick search channel",
    24,
    true,
  );
  tap(kick.node);
  sleep(2000);
  return openWatchFromChannel(dumpUi());
}

function openWatchFromChannel(xml) {
  const watch =
    findNode(
      xml,
      (node) => node.res === "channel-watch" && node.clickable && isOnScreen(node),
    ) ??
    waitFor(
      (node) => node.res === "channel-watch" && node.clickable && isOnScreen(node),
      "channel Watch",
      16,
      true,
    ).node;
  tap(watch);
  sleep(2000);
  let next = dumpUi();
  const start = findNode(
    next,
    (node) => node.res === "watch-start" && node.clickable && isOnScreen(node),
  );
  if (start) {
    tap(start);
    sleep(2000);
    next = dumpUi();
  }
  return waitFor(
    (node) => node.res === "watch-adblock-status" && isOnScreen(node),
    "Watch filtering banner",
    20,
    true,
  ).xml;
}

try {
  run(["reverse", "tcp:8081", "tcp:8081"]);
  const watchOnly = process.env.WATCH_ONLY === "1";
  if (!watchOnly) {
    forceStop();
    launch();
    sleep(5000);
    dumpUi();
  }

  let xml = dumpUi();
  if (!watchOnly) {
    xml = openSettings();
    shot("01-settings-strip", xml, {
      strip: hasText(xml, "Twitch ads are filtered") || hasText(xml, "Method: strip"),
      kick: hasText(xml, "Kick has no approved filter"),
      twitch: hasText(xml, "Twitch live playlists"),
    });

    xml = tapRes("adblock-method-canary", "canary");
    xml = waitFor(
      (_node, dump) => hasText(dump, "Canary is watching Twitch ads"),
      "canary title",
      12,
    ).xml;
    shot("02-settings-canary", xml, {
      canary:
        hasText(xml, "Canary is watching Twitch ads") ||
        hasText(xml, "Method: canary"),
    });

    xml = tapRes("adblock", "kill switch");
    shot("03-settings-off", xml, {
      off:
        hasText(xml, "Playback filtering off") || hasText(xml, "Filtering off"),
    });

    xml = tapRes("adblock", "kill switch on");
    shot("04-settings-on", xml, {
      on: hasText(xml, "Filtering on") || hasText(xml, "Twitch ads are filtered"),
    });
  }

  if (process.env.KICK_ONLY === "1") {
    xml = searchKickChannel("xqc");
    shot("06-watch-kick", xml, {
      banner: Boolean(findNode(xml, (node) => node.res === "watch-adblock-status")),
      kickCopy: hasText(xml, "Kick has no approved filter"),
    });
    writeFileSync(
      path.join(outDir, "observations.json"),
      `${JSON.stringify({ artifacts, observations }, null, 2)}\n`,
    );
    console.log(JSON.stringify({ artifacts, ok: true }, null, 2));
    process.exit(0);
  }

  xml = openHomeLive();
  const twitch = waitFor(liveHomeStream("twitch"), "Home Twitch stream", 24, true)
    .node;
  tap(twitch);
  sleep(2000);
  xml = openWatchFromChannel(dumpUi());
  hideKeyboard();
  shot("05-watch-twitch", xml, {
    banner: Boolean(findNode(xml, (node) => node.res === "watch-adblock-status")),
    twitchCopy:
      hasText(xml, "Twitch ads are filtered") ||
      hasText(xml, "Canary is watching Twitch ads") ||
      hasText(xml, "Playback filtering"),
  });

  xml = searchKickChannel("xqc");
  shot("06-watch-kick", xml, {
    banner: Boolean(findNode(xml, (node) => node.res === "watch-adblock-status")),
    kickCopy: hasText(xml, "Kick has no approved filter"),
  });

  writeFileSync(
    path.join(outDir, "observations.json"),
    `${JSON.stringify({ artifacts, observations }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ artifacts, ok: true }, null, 2));
} catch (error) {
  writeFileSync(
    path.join(outDir, "observations.json"),
    `${JSON.stringify({ artifacts, error: String(error), observations }, null, 2)}\n`,
  );
  console.error(error);
  process.exit(1);
}
