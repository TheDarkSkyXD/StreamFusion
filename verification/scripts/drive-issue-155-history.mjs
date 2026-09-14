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
const outDir = path.resolve("verification/evidence/issue-155");
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
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

function byDesc(value) {
  return (node) => node.desc === value || node.text === value;
}

function byIncludes(value) {
  return (node) => node.desc.includes(value) || node.text.includes(value);
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
  return node.height > 48 && node.top >= 360 && node.bottom <= 1750;
}

function twitchChannelCard(node) {
  return (
    node.clickable &&
    isOnScreen(node) &&
    node.res.startsWith("search-channel-twitch")
  );
}

function hideKeyboard() {
  const xml = dumpUi();
  if (findNode(xml, bottomTab("Search"))) return xml;
  run(["shell", "input", "tap", "1014", "1960"]);
  sleep(700);
  const afterIme = dumpUi();
  if (findNode(afterIme, bottomTab("Search"))) return afterIme;
  run(["shell", "input", "keyevent", "4"]);
  sleep(700);
  return dumpUi();
}

function dismissMiniPlayer() {
  const xml = dumpUi();
  const close = findNode(xml, (node) => node.res === "dismiss-player");
  if (!close) return xml;
  tap(close);
  sleep(1200);
  return dumpUi();
}

function isTappable(node) {
  return node.height > 24 && node.top >= 360 && node.bottom <= 2010 && node.bottom > node.top;
}

function historyAction(xml, prefix) {
  return (
    findNode(
      xml,
      (node) => node.clickable && node.res.startsWith(prefix) && isTappable(node),
    ) ?? findNode(xml, (node) => node.clickable && node.res.startsWith(prefix) && node.height > 24)
  );
}

function startWatching(node) {
  return (
    node.res === "watch-start" ||
    node.desc === "Start watching" ||
    node.text === "Start watching"
  );
}

const observations = [];
const artifacts = [];

function observe(step, xml, extra = {}) {
  observations.push({
    step,
    texts: nodesFrom(xml)
      .map((node) => node.text || node.desc)
      .filter((value) => value.length > 0)
      .slice(0, 50),
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

function openMore() {
  const xml = dumpUi();
  if (hasText(xml, "More destinations") || hasText(xml, "Return to watched")) {
    return xml;
  }
  tapBottom("More");
  return dumpUi();
}

function openHistory() {
  const xml = openMore();
  if (hasText(xml, "Streams, videos, and clips stay on this device")) {
    return xml;
  }
  const history = findNode(xml, (node) => node.desc === "History" || node.text === "History");
  if (!history) throw new Error("History destination missing");
  tap(history);
  sleep(1500);
  return dumpUi();
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

try {
  forceStop();
  launch();
  sleep(4000);
  dumpUi();

  let xml = openHistory();
  shot(
    "01-history-initial",
    xml,
    hasText(xml, "Watched streams, videos, and clips appear here.")
      ? { empty: true }
      : { empty: false },
  );

  xml = openSearch();
  const repeat =
    findNode(xml, (node) => node.desc === "Search again for xqc") ??
    findNode(dumpUi(), (node) => node.res.includes("repeat-search-xqc"));
  if (repeat) tap(repeat);
  else run(["shell", "input", "tap", "768", "1342"]);
  sleep(2500);
  xml = dumpUi();
  shot("02-search-repeat", xml);
  const channelsChip = findNode(
    xml,
    (node) => node.res === "search-tab-channels" && isOnScreen(node),
  );
  if (channelsChip) {
    tap(channelsChip);
    sleep(1500);
    xml = dumpUi();
  }
  const twitch = waitFor(twitchChannelCard, "xQc Twitch channel", 24, true);
  shot("02-search-xqc", twitch.xml);
  tap(twitch.node);
  sleep(1500);

  const channelReady = waitFor(
    (node) =>
      node.res === "channel-detail" ||
      node.res === "channel-header" ||
      node.res === "channel-watch" ||
      node.res === "channel-tabs",
    "channel detail",
    16,
  );
  shot("03-channel-detail", channelReady.xml);
  const videosTab =
    findNode(channelReady.xml, (node) => node.res === "channel-tab-videos") ??
    waitFor((node) => node.res === "channel-tab-videos", "channel Videos tab", 12)
      .node;
  tap(videosTab);
  const vod = waitFor(
    (node, xml) => {
      const rows = nodesFrom(xml).filter(
        (item) =>
          item.clickable &&
          item.res.startsWith("channel-media-") &&
          item.desc.startsWith("Watch ") &&
          isTappable(item),
      );
      return rows.length >= 2 && node.res === rows[1]?.res;
    },
    "completed channel VOD row",
    30,
    true,
  );
  shot("04-channel-videos", vod.xml);
  tap(vod.node);

  const start = waitFor(byDesc("Start watching"), "Start watching", 24);
  shot("05-watch-preview", start.xml, { autoplay: false });
  tap(start.node);
  const playing = waitFor(
    (node) => node.desc === "Pause" || node.text === "Pause",
    "playing Pause",
    30,
  );
  waitFor(
    (node) => {
      if (node.res !== "player-progress") return false;
      const clock = node.text.match(/^(\d+):(\d+)/);
      return Boolean(clock && Number(clock[1]) < 8);
    },
    "VOD start near 0:00",
    24,
  );
  const forward =
    findNode(playing.xml, (node) => node.res === "player-seek-forward") ??
    findNode(dumpUi(), (node) => node.res === "player-seek-forward") ??
    findNode(playing.xml, byDesc("Forward 10 seconds"));
  if (forward) {
    tap(forward);
    sleep(800);
    tap(forward);
  }
  sleep(6000);
  xml = dumpUi();
  shot("06-watch-playing", xml);

  xml = openHistory();
  dismissMiniPlayer();
  const historyReady = waitFor(
    (node) =>
      node.text === "VIDEO" ||
      node.res.startsWith("history-row-") ||
      node.res.startsWith("history-resume-") ||
      node.res.startsWith("history-replay-"),
    "history row after watch",
    20,
  );
  shot("07-history-populated", historyReady.xml);

  dismissMiniPlayer();
  const resume = waitFor(
    (node) => node.res.startsWith("history-resume-") && isTappable(node),
    "history Resume",
    16,
    true,
  );
  tap(resume.node);
  const resumePreview = waitFor(startWatching, "resume Start watching", 24);
  if (hasText(resumePreview.xml, "Pause")) {
    throw new Error("resume autoplayed");
  }
  shot("09-resume-no-autoplay", resumePreview.xml, { autoplay: false });

  xml = openHistory();
  dismissMiniPlayer();
  const replay = waitFor(
    (node) => node.res.startsWith("history-replay-") && isTappable(node),
    "history Replay",
    16,
    true,
  );
  tap(replay.node);
  const replayPreview = waitFor(startWatching, "replay Start watching", 24);
  shot("10-replay-no-autoplay", replayPreview.xml, { autoplay: false });

  xml = openHistory();
  dismissMiniPlayer();
  hideKeyboard();
  const searchField =
    findNode(dumpUi(), (node) => node.res === "history-search") ??
    findNode(dumpUi(), byDesc("Search history"));
  if (searchField) {
    tap(searchField);
    sleep(800);
    run(["shell", "input", "text", "xqc"]);
    sleep(1200);
    xml = dumpUi();
    shot("08-history-search", xml);
    hideKeyboard();
  }

  xml = openHistory();
  dismissMiniPlayer();
  const remove = waitFor(
    (node) => node.res.startsWith("history-remove-") && isTappable(node),
    "history Remove",
    16,
    true,
  );
  tap(remove.node);
  const removeConfirm = waitFor(
    (node) => node.res === "history-confirmation" || node.desc === "Confirm history change",
    "remove confirm",
    12,
  );
  shot("11-remove-confirm", removeConfirm.xml);
  tap(
    findNode(removeConfirm.xml, (node) => node.res === "history-cancel") ??
      findNode(removeConfirm.xml, byDesc("Cancel history change")),
  );
  sleep(800);

  xml = dumpUi();
  const clear =
    findNode(xml, (node) => node.res === "history-clear") ??
    findNode(xml, byDesc("Clear history"));
  if (!clear) throw new Error("Clear missing");
  tap(clear);
  const clearConfirm = waitFor(byDesc("Confirm history change"), "clear confirm", 12);
  shot("12-clear-confirm", clearConfirm.xml);
  tap(
    findNode(clearConfirm.xml, (node) => node.res === "history-cancel") ??
      findNode(clearConfirm.xml, byDesc("Cancel history change")),
  );
  sleep(800);
  xml = dumpUi();
  shot("13-history-kept", xml);

  forceStop();
  launch();
  sleep(5000);
  xml = openHistory();
  const afterDeath = waitFor(
    (node) =>
      node.text === "VIDEO" ||
      node.res.startsWith("history-row-") ||
      node.res.startsWith("history-resume-") ||
      node.res.startsWith("history-replay-"),
    "history after process death",
    24,
  );
  shot("14-process-death", afterDeath.xml);

  run(["shell", "svc", "wifi", "disable"]);
  run(["shell", "svc", "data", "disable"]);
  sleep(1500);
  xml = dumpUi();
  shot("15-offline-history", xml);
  run(["shell", "svc", "wifi", "enable"]);
  run(["shell", "svc", "data", "enable"]);

  xml = openSearch();
  const clipTab = findNode(xml, (node) => node.desc === "Channels" || node.text === "Channels");
  if (clipTab) {
    tap(clipTab);
    sleep(800);
  }
  const twitchAgain = findNode(dumpUi(), (node) =>
    node.clickable && /xqc on twitch/i.test(`${node.desc} ${node.text}`),
  );
  if (twitchAgain) {
    tap(twitchAgain);
    const clips = waitFor(
      (node) => node.desc === "Clips" || node.text === "Clips",
      "Clips tab",
      24,
    );
    tap(clips.node);
    const clip = waitFor(
      (node) => node.clickable && node.desc.startsWith("Watch "),
      "Twitch clip row",
      24,
    );
    shot("16-channel-clips", clip.xml);
    tap(clip.node);
    const clipStart = waitFor(byDesc("Start watching"), "clip Start watching", 24);
    tap(clipStart.node);
    waitFor((node) => node.desc === "Pause" || node.text === "Pause", "clip playing", 24);
    sleep(3000);
    xml = openHistory();
    shot("17-history-with-clip", xml);
  }

  xml = openHistory();
  const streamOpen =
    findNode(xml, (node) => node.desc.startsWith("Open ")) ??
    findNode(xml, (node) => node.text === "Open");
  observe("stream-open-present", xml, { present: Boolean(streamOpen) });

  writeFileSync(
    path.join(outDir, "drive-observations.json"),
    `${JSON.stringify({ artifacts, observations }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, artifacts }, null, 2));
} catch (error) {
  writeFileSync(
    path.join(outDir, "drive-observations.json"),
    `${JSON.stringify({ artifacts, error: String(error), observations }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
}
