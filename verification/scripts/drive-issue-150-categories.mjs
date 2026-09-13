import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const adb = process.env.ADB ?? `${process.env.ANDROID_HOME}/platform-tools/adb`;
const outDir = path.resolve("verification/evidence/issue-150");
const packageName = "com.thedarkskyxd.streamfusion.dev";
const launchUri =
  "exp+streamfusion-development://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081";
mkdirSync(outDir, { recursive: true });

function run(args, options = {}) {
  return execFileSync(adb, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 90_000,
  });
}

function sleep(ms) {
  spawnSync("sleep", [String(ms / 1000)]);
}

function screenshot(name) {
  const remote = `/sdcard/${name}.png`;
  const local = path.join(outDir, `${name}.png`);
  run(["shell", "screencap", "-p", remote]);
  run(["pull", remote, local]);
  const digest = createHash("sha256").update(readFileSync(local)).digest("hex");
  return { name, path: path.relative(process.cwd(), local), sha256: `sha256:${digest}` };
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

function dumpUi() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      run(["shell", "uiautomator", "dump", "/sdcard/uidump.xml"], {
        timeout: 90_000,
      });
      const local = path.join(outDir, "uidump.xml");
      run(["pull", "/sdcard/uidump.xml", local]);
      const xml = readFileSync(local, "utf8");
      if (dismissAnr(xml) || dismissDevMenu(xml)) continue;
      return xml;
    } catch {
      sleep(2000);
    }
  }
  throw new Error("uiautomator dump failed");
}

function nodesFrom(xml) {
  return [...xml.matchAll(/<node [^>]+>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[0].matchAll(/(\w+)="([^"]*)"/g)].map((item) => [
        item[1],
        item[2]
          .replaceAll("&amp;", "&")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">"),
      ]),
    );
    const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    return {
      text: attrs.text ?? "",
      desc: attrs["content-desc"] ?? "",
      res: attrs["resource-id"] ?? "",
      clickable: attrs.clickable === "true",
      enabled: attrs.enabled !== "false",
      x: bounds ? (Number(bounds[1]) + Number(bounds[3])) / 2 : 0,
      y: bounds ? (Number(bounds[2]) + Number(bounds[4])) / 2 : 0,
    };
  });
}

function findNode(xml, predicate) {
  return nodesFrom(xml).find(predicate) ?? null;
}

function tap(node) {
  if (node === null) throw new Error("tap target missing");
  run(["shell", "input", "tap", String(Math.round(node.x)), String(Math.round(node.y))]);
}

function swipeUp() {
  run(["shell", "input", "swipe", "540", "1500", "540", "420", "350"]);
  sleep(700);
}

function swipeDown() {
  run(["shell", "input", "swipe", "540", "500", "540", "1500", "350"]);
  sleep(700);
}

function isOpenCategories(node) {
  if (node.desc === "Open Categories") return true;
  if (node.res.includes("open-categories")) return true;
  return node.text === "Categories" && node.y > 400 && node.y < 900;
}

function isProofChip(mode) {
  return (node) =>
    node.desc === `Inject ${mode} category state` ||
    node.res.includes(`category-proof-${mode}`) ||
    (node.text === mode && node.y > 400 && node.y < 1900);
}

function waitFor(predicate, label, attempts = 30) {
  let xml = "";
  for (let i = 0; i < attempts; i += 1) {
    xml = dumpUi();
    const node = findNode(xml, predicate);
    if (node) return { xml, node };
    if (i > 4 && i % 3 === 0) swipeUp();
    sleep(1200);
  }
  writeFileSync(path.join(outDir, "last-fail.xml"), xml);
  screenshot("last-fail");
  throw new Error(`missing ${label}`);
}

function findScrolling(predicate, label, passes = 8) {
  for (let i = 0; i < passes; i += 1) {
    const xml = dumpUi();
    const node = findNode(xml, predicate);
    if (node) return { xml, node };
    swipeUp();
  }
  throw new Error(`missing ${label} after scroll`);
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

const observations = [];
const artifacts = [];

function observe(step, xml, extra = {}) {
  observations.push({
    step,
    texts: nodesFrom(xml)
      .map((node) => node.text || node.desc)
      .filter((value) => value.length > 0)
      .slice(0, 40),
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

function openHomeFromShell() {
  const xml = dumpUi();
  if (findNode(xml, isOpenCategories)) return;
  const moreTab = findNode(
    xml,
    (node) => (node.desc === "More" || node.text === "More") && node.y > 1600,
  );
  if (moreTab) {
    tap(moreTab);
    sleep(1000);
  }
  const moreHome = findNode(dumpUi(), byDesc("Home"));
  if (moreHome) {
    tap(moreHome);
    sleep(1000);
  }
  swipeDown();
}

try {
  if (process.env.SKIP_LAUNCH !== "1") {
    forceStop();
    launch();
    waitFor(
      (node) =>
        node.desc === "More" ||
        node.text === "More" ||
        node.desc === "Open Categories" ||
        node.text === "Continue" ||
        node.text === "Wait" ||
        node.text === "Fast Refresh",
      "shell or launcher chrome",
      50,
    );
  }
  let categoriesXml = dumpUi();
  if (!hasText(categoriesXml, "DEVELOPMENT CATEGORY DISCOVERY")) {
    openHomeFromShell();
    const home = waitFor(isOpenCategories, "Open Categories", 30);
    shot("home-open-categories", home.xml, {
      proof: hasText(home.xml, "D07 category discovery proof")
        ? "unexpected D07 token on Home"
        : "Home Categories entry is visible",
    });
    tap(home.node);
    const categories = waitFor(
      (node) =>
        node.text === "Loading categories from Twitch and Kick." ||
        node.text === "Categories could not be loaded." ||
        node.text === "DEVELOPMENT CATEGORY DISCOVERY",
      "Categories screen",
      30,
    );
    categoriesXml = categories.xml;
    shot("categories-live", categoriesXml, {
      phase: nodesFrom(categoriesXml).find((node) =>
        node.text.toLowerCase().includes("categor"),
      )?.text,
    });
  } else {
    shot("categories-live", categoriesXml, {
      phase: nodesFrom(categoriesXml).find((node) =>
        node.text.toLowerCase().includes("categor"),
      )?.text,
    });
  }
  const readyChip = findScrolling(
    isProofChip("ready"),
    "ready proof chip",
    6,
  );
  tap(readyChip.node);
  sleep(800);
  const ready = dumpUi();
  shot("categories-ready", ready, {
    justChatting: hasText(ready, "Just Chatting"),
    proof: hasText(ready, "D07 category discovery proof"),
  });

  const english =
    findNode(ready, byDesc("Language English")) ??
    findNode(ready, (node) => node.text === "English");
  if (english) {
    tap(english);
    sleep(600);
  }
  const language = dumpUi();
  shot("categories-language-en", language, {
    englishSelected: hasText(language, "English"),
  });

  let searched = language;
  if (!hasText(language, "Just Chatting")) {
    const search = findScrolling(
      (node) =>
        node.res.includes("categories-search") ||
        node.desc === "categories-search" ||
        node.desc === "Search categories" ||
        node.text === "Search categories",
      "categories search",
    );
    tap(search.node);
    sleep(400);
    run(["shell", "input", "text", "Just"]);
    sleep(800);
    searched = dumpUi();
  }
  shot("categories-search", searched, {
    query: hasText(searched, "Just"),
    justChatting: hasText(searched, "Just Chatting"),
  });

  const kickCard =
    findNode(
      searched,
      (node) =>
        node.res.includes("category-card-kick") || node.desc.includes("kick-cat"),
    ) ?? findScrolling(byDesc("Just Chatting"), "Just Chatting card").node;
  tap(kickCard);
  const kickDetail = waitFor(
    (node) =>
      node.desc === "Follow category" ||
      (node.text === "Follow" && node.y < 1400),
    "Follow on Kick detail",
    30,
  );
  const platformKick =
    findNode(kickDetail.xml, byDesc("Platform Kick")) ??
    findNode(kickDetail.xml, (node) => node.text === "Kick" && node.y < 1600);
  if (platformKick) {
    tap(platformKick);
    sleep(800);
  }
  shot("detail-kick-live", kickDetail.xml, {
    followDisabled: !kickDetail.node.enabled,
    followReason: hasText(
      kickDetail.xml,
      "Category Follow needs a signed-in provider account",
    ),
    proof: hasText(kickDetail.xml, "D07 category discovery proof"),
  });

  const clipsTab =
    findNode(kickDetail.xml, (node) => node.text === "CLIPS" && node.y > 180 && node.y < 1400) ??
    findNode(kickDetail.xml, byIncludes("CLIPS"));
  tap(clipsTab);
  sleep(800);
  let kickClips = dumpUi();
  for (let i = 0; i < 10; i += 1) {
    if (
      hasText(kickClips, "Kick clips are explained unavailable") ||
      hasText(kickClips, "Kick clips are not available")
    ) {
      break;
    }
    swipeUp();
    kickClips = dumpUi();
  }
  shot("detail-kick-clips-unsupported", kickClips, {
    unsupported:
      hasText(kickClips, "Kick clips are explained unavailable") ||
      hasText(kickClips, "Kick clips are not available"),
  });

  swipeDown();
  swipeDown();
  const videosTab =
    findNode(dumpUi(), (node) => node.text === "VIDEOS" && node.y > 180 && node.y < 1400) ??
    findNode(dumpUi(), byIncludes("VIDEOS"));
  tap(videosTab);
  sleep(800);
  let kickVideos = dumpUi();
  for (let i = 0; i < 8; i += 1) {
    if (hasText(kickVideos, "Kick videos are explained unavailable")) break;
    swipeUp();
    kickVideos = dumpUi();
  }
  shot("detail-kick-videos-unsupported", kickVideos, {
    unsupported: hasText(kickVideos, "Kick videos are explained unavailable"),
    leakedLive: hasText(kickVideos, "Twitch catalog proof stream"),
  });

  swipeDown();
  swipeDown();
  swipeDown();
  const liveTab =
    findNode(dumpUi(), (node) => node.text === "LIVE" && node.y > 180 && node.y < 1400);
  if (liveTab) {
    tap(liveTab);
    sleep(700);
  }
  const platformTwitch =
    findNode(dumpUi(), byDesc("Platform Twitch")) ??
    findNode(dumpUi(), (node) => node.text === "Twitch" && node.y > 200 && node.y < 1600);
  if (platformTwitch) {
    tap(platformTwitch);
    sleep(800);
  }
  let detailReady = findNode(dumpUi(), isProofChip("ready"));
  for (let i = 0; i < 8 && !detailReady; i += 1) {
    swipeUp();
    detailReady = findNode(dumpUi(), isProofChip("ready"));
  }
  if (detailReady) {
    tap(detailReady);
    sleep(800);
  }
  let twitchReady = dumpUi();
  for (let i = 0; i < 8; i += 1) {
    if (hasText(twitchReady, "Twitch catalog proof stream")) break;
    swipeUp();
    twitchReady = dumpUi();
  }
  shot("detail-twitch-live-ready", twitchReady, {
    liveStream: hasText(twitchReady, "Twitch catalog proof stream"),
    followReason: hasText(
      twitchReady,
      "Category Follow needs a signed-in provider account",
    ),
  });

  const twitchClips =
    findNode(twitchReady, byDesc("clips tab")) ??
    findNode(twitchReady, byIncludes("CLIPS"));
  tap(twitchClips);
  sleep(800);
  const twitchClipsUi = dumpUi();
  shot("detail-twitch-clips", twitchClipsUi, {
    leakedLive: hasText(twitchClipsUi, "Twitch catalog proof stream"),
  });

  const twitchVideos =
    findNode(twitchClipsUi, byDesc("videos tab")) ??
    findNode(twitchClipsUi, byIncludes("VIDEOS"));
  tap(twitchVideos);
  sleep(800);
  const twitchVideosUi = dumpUi();
  shot("detail-twitch-videos", twitchVideosUi, {
    leakedLive: hasText(twitchVideosUi, "Twitch catalog proof stream"),
    videoTitle: hasText(twitchVideosUi, "twitch video"),
  });

  const sortViews = findNode(twitchVideosUi, byDesc("Sort Views"));
  if (sortViews) {
    tap(sortViews);
    sleep(500);
  }
  const sorted = dumpUi();
  shot("detail-twitch-videos-views", sorted, {
    leakedLive: hasText(sorted, "Twitch catalog proof stream"),
  });
} catch (error) {
  observations.push({
    step: "drive-failed",
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    artifacts.push(screenshot("drive-failed"));
  } catch {
    observations.push({ step: "drive-failed-screenshot", error: "screencap failed" });
  }
} finally {
  writeFileSync(
    path.join(outDir, "drive-observations.json"),
    `${JSON.stringify({ artifacts, observations, packageName }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ artifacts, steps: observations.length }, null, 2));
}
