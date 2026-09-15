import {
  dumpUi,
  findControl,
  findNode,
  hasText,
  hideKeyboard,
  openMoreDestinations,
  run,
  sleep,
  swipeDown,
  swipeUp,
  tap,
  tapBottom,
  waitFor,
} from "./drive-issue-166-captions-ui.mjs";

function captionsPanelVisible(xml) {
  const stamp = findNode(
    xml,
    (node) => node.res === "local-captions-build-stamp",
  );
  const install = findControl(
    xml,
    "local-captions-install-fixture",
    "Install fixture English model",
  );
  return Boolean(
    stamp &&
      stamp.top >= 280 &&
      stamp.bottom <= 900 &&
      install &&
      install.height >= 48,
  );
}

export function ensureCaptionControls() {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    let xml = dumpUi();
    if (captionsPanelVisible(xml)) {
      const install = findControl(
        xml,
        "local-captions-install-fixture",
        "Install fixture English model",
      );
      if (install.top >= 280 && install.bottom <= 1980) return xml;
      if (install.top < 280) {
        swipeDown();
        continue;
      }
    }
    if (
      !findNode(
        xml,
        (node) =>
          node.res === "local-captions-diagnostics" ||
          node.res === "screen-more-diagnostics",
      )
    ) {
      xml = openDiagnostics();
      continue;
    }
    swipeDown();
  }
  return openDiagnostics();
}

export function openDiagnostics() {
  let xml = openMoreDestinations();
  if (captionsPanelVisible(xml)) {
    return xml;
  }
  if (findNode(xml, (node) => node.res === "screen-more-diagnostics")) {
    return waitFor(
      (node) => node.res === "local-captions-diagnostics",
      "Captions diagnostics",
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
    (node) => node.res === "local-captions-diagnostics",
    "Captions diagnostics",
    16,
    true,
  ).xml;
}

function visibleControl(testId, label) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const xml = dumpUi();
    const button = findControl(xml, testId, label);
    if (
      button &&
      button.height >= 48 &&
      button.top >= 280 &&
      button.bottom <= 1980
    ) {
      return button;
    }
    if (button && button.top < 280) {
      swipeDown();
      continue;
    }
    swipeUp();
  }
  throw new Error(`${label} missing`);
}

export function tapControl(testId, label) {
  ensureCaptionControls();
  tap(visibleControl(testId, label));
  sleep(1200);
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

function openWatchFromChannel() {
  const xml = dumpUi();
  const channelWatch =
    findNode(
      xml,
      (node) =>
        node.res === "channel-watch" &&
        node.clickable &&
        node.top >= 280 &&
        node.bottom <= 1980,
    ) ??
    waitFor(
      (node) =>
        node.res === "channel-watch" &&
        node.clickable &&
        node.top >= 280 &&
        node.bottom <= 1980,
      "channel Watch",
      16,
      true,
    ).node;
  tap(channelWatch);
  sleep(2000);
  const next = dumpUi();
  const start = findNode(
    next,
    (node) =>
      node.res === "watch-start" &&
      node.clickable &&
      node.top >= 280 &&
      node.bottom <= 1980,
  );
  if (start) {
    tap(start);
    sleep(2500);
  }
  return waitFor(
    (node) => node.res === "watch-captions" || node.res === "watch-player-stage",
    "Watch captions",
    20,
    true,
  ).xml;
}

function searchKickChannel(query) {
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
  hideKeyboard();
  xml = dumpUi();
  const channelsChip = findNode(
    xml,
    (node) => node.res === "search-tab-channels" && node.clickable,
  );
  if (channelsChip) {
    tap(channelsChip);
    sleep(1500);
  }
  const kick = waitFor(
    (node) =>
      node.clickable &&
      node.res.startsWith("search-channel-kick") &&
      node.top >= 280 &&
      node.bottom <= 1980,
    "Kick search channel",
    24,
    true,
  );
  tap(kick.node);
  sleep(2000);
  return openWatchFromChannel();
}

function retryHomeCatalog() {
  for (const label of ["Retry kick", "Retry twitch"]) {
    const xml = dumpUi();
    const retry = findNode(
      xml,
      (node) => node.clickable && (node.text === label || node.desc === label),
    );
    if (retry) {
      tap(retry);
      sleep(800);
    }
  }
  sleep(3500);
}

function liveHomeStream() {
  return (node) =>
    node.clickable &&
    node.height > 80 &&
    node.top >= 280 &&
    node.bottom <= 1980 &&
    (node.desc.toLowerCase().includes("live on") ||
      node.res.startsWith("home-stream-") ||
      node.res.startsWith("stream-card-"));
}

export function openHomeLive() {
  let xml = openMoreDestinations();
  if (
    !findNode(xml, (node) => node.res === "home-live-discovery") &&
    !findNode(xml, (node) => node.res.startsWith("home-stream-"))
  ) {
    const destination =
      findNode(xml, (node) => node.res === "open-more-home") ??
      findNode(xml, (node) => node.desc === "Home" || node.text === "Home");
    if (!destination) throw new Error("Home destination missing");
    tap(destination);
    sleep(2000);
  }
  xml = dumpUi();
  if (hasText(xml, "could not be loaded") || hasText(xml, "catalog read failed")) {
    retryHomeCatalog();
  }
  try {
    const stream = waitFor(liveHomeStream(), "Home live stream", 10, true).node;
    tap(stream);
    sleep(2000);
    return openWatchFromChannel();
  } catch {
    return searchKickChannel("xqc");
  }
}
