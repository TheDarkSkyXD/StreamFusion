import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const prototypePath = resolve(
  root,
  "docs/research/streamfusion-mobile/prototypes/android-navigation-prototype.html",
);
const contractPath = resolve(
  root,
  "docs/research/streamfusion-mobile/mobile-screen-and-control-contract.md",
);
const prototype = readFileSync(prototypePath, "utf8").replaceAll("\r\n", "\n");
const contract = readFileSync(contractPath, "utf8");
const sourceAnchors = [
  "settingsDefinitions",
  "tabReviewGroups",
  "searchScreen",
  "searchResults",
  "searchHistory",
  "homeScreen",
  "categoriesScreen",
  "categoryDetailScreen",
  "followingScreen",
  "channelScreen",
  "watchScreen",
  "videoStage",
  "chatPanel",
  "videoScreen",
  "multistreamScreen",
  "slot",
  "historyScreen",
  "activityScreen",
  "moderationHomeScreen",
  "moderationScreen",
  "settingsScreen",
  "settingDetailScreen",
  "accountsScreen",
  "systemScreen",
  "diagnosticsTabContent",
  "moreScreen",
  "settingToggle",
  "settingChoice",
  "settingRange",
  "settingField",
];

const between = (text, start, end) => {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Missing prototype anchor: ${start} -> ${end}`);
  }
  return text.slice(startIndex, endIndex);
};
const unique = (values) => [...new Set(values)];
const ids = (text, pattern) =>
  unique([...text.matchAll(pattern)].map((match) => match[1]));

const definitions = between(
  prototype,
  "const settingsDefinitions",
  "const screens",
);
const panels = ids(definitions, /id: "([^"]+)"/g);
const screenBlock = between(
  prototype,
  "const screens",
  "const tabReviewGroups",
);
const directScreens = ids(screenBlock, /id: "([^"]+)"/g);
const screens = [
  ...directScreens,
  ...panels.map((panel) => `settings-${panel}`),
];
const tabBlock = between(
  prototype,
  "const tabReviewGroups",
  "const tabbedScreens",
);
const tabGroups = [
  ...tabBlock.matchAll(
    /screen: "([^"]+)"[\s\S]*?tabs: \[([\s\S]*?)\],\n\s*\},/g,
  ),
].flatMap(([, screen, tabs]) =>
  ids(tabs, /"([^"]+)"/g).map((tab) => `${screen}:${tab}`),
);
const actions = ids(prototype, /data-action="([a-z][a-z0-9-]*)"/g);
const playerControlSection = between(
  prototype,
  'if (sectionId === "player-controls")',
  'if (sectionId === "buffer")',
);
const playerControlMatch = playerControlSection.match(
  /\[([\s\S]*?)\]\.map\(\(label, index\) => settingToggle/,
);
if (!playerControlMatch) {
  throw new Error("Missing dynamic player-control declaration");
}
const playerControls = ids(playerControlMatch[1], /"([^"]+)"/g).map(
  (label, index) => ({ key: `control-${index}`, label }),
);
const settingKeys = unique([
  ...ids(prototype, /setting(?:Toggle|Choice|Range)\(\s*"([^"]+)"/g),
  ...playerControls.map(({ key }) => key),
]);

const required = [
  ...screens.map((screen) => `screen:${screen}`),
  ...panels.map((panel) => `panel:${panel}`),
  ...tabGroups.map((tab) => `tab:${tab}`),
  ...actions.map((action) => `action:${action}`),
];
const missing = required.filter(
  (item) => !contract.includes(`<!-- contract:${item} -->`),
);
const markers = [
  ...contract.matchAll(/<!-- contract:(screen|panel|tab|action):([^ ]+) -->/g),
].map(([, type, value]) => `${type}:${value}`);
const duplicateMarkers = markers.filter(
  (marker, index) => markers.indexOf(marker) !== index,
);
const extraMarkers = markers.filter((marker) => !required.includes(marker));
const missingSourceAnchors = sourceAnchors.filter(
  (anchor) => !new RegExp(`\\b${anchor}\\b`).test(prototype),
);

if (
  screens.length === 0 ||
  panels.length === 0 ||
  tabGroups.length === 0 ||
  actions.length === 0
) {
  throw new Error(
    `Empty prototype inventory: screens=${screens.length} panels=${panels.length} tabs=${tabGroups.length} actions=${actions.length}`,
  );
}
if (missing.length > 0) {
  throw new Error(`Missing contract coverage:\n${missing.join("\n")}`);
}
if (duplicateMarkers.length > 0 || extraMarkers.length > 0) {
  throw new Error(
    `Invalid contract markers:\nduplicates=${unique(duplicateMarkers).join(",")}\nextras=${unique(extraMarkers).join(",")}`,
  );
}
if (missingSourceAnchors.length > 0) {
  throw new Error(
    `Missing prototype source anchors:\n${missingSourceAnchors.join("\n")}`,
  );
}
const undocumentedSettingKeys = settingKeys.filter(
  (key) => !contract.includes(`\`${key}\``),
);
if (undocumentedSettingKeys.length > 0) {
  throw new Error(
    `Missing settings-control coverage:\n${undocumentedSettingKeys.join("\n")}`,
  );
}
const undocumentedPlayerControls = playerControls.filter(
  ({ key, label }) => !contract.includes(`\`${key}\` ${label}`),
);
if (undocumentedPlayerControls.length > 0) {
  throw new Error(
    `Missing dynamic player-control labels:\n${undocumentedPlayerControls.map(({ key, label }) => `${key} ${label}`).join("\n")}`,
  );
}

console.log(
  `Mobile contract declaration reconciliation: screens=${screens.length} panels=${panels.length} tabs=${tabGroups.length} actions=${actions.length} sourceSettingKeys=${settingKeys.length} dynamicPlayerControls=${playerControls.length} sourceAnchors=${sourceAnchors.length}`,
);
console.log(
  "This check compares declarations and markers. It does not prove UI or workflow behavior.",
);
