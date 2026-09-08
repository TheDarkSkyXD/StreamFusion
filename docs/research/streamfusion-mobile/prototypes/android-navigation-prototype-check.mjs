import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";

const prototypePath = resolve(
  import.meta.dirname,
  "android-navigation-prototype.html",
);
const prototype = readFileSync(prototypePath, "utf8");
const actions = [
  ...new Set(
    [...prototype.matchAll(/data-action="([a-z][a-z0-9-]*)"/g)].map(
      (match) => match[1],
    ),
  ),
].sort();
const settingKeys = [
  ...new Set(
    [
      ...prototype.matchAll(/setting(?:Toggle|Choice|Range)\(\s*"([^"]+)"/g),
    ].map((match) => match[1]),
  ),
].sort();
const dynamicPlayerControls = 6;
const requiredActions = [
  "player-play-pause",
  "player-seek-back",
  "player-seek-forward",
  "player-quality",
  "player-speed",
  "player-fullscreen",
  "player-pip",
  "player-captions",
  "job-record",
  "chat-send",
  "chat-emotes",
  "multistream-edit",
  "multi-chat-mode",
  "history-clear",
  "history-remove",
  "moderation-tools",
  "notification-permission",
  "check-updates",
];
const requiredSettings = [
  "caption-track",
  "caption-text-size",
  "caption-background-opacity",
  "automatic-foreground-updates",
  "diagnostic-window",
  "diagnostic-io-window",
];
const forbidden = [
  /fetch\(/,
  /XMLHttpRequest/,
  /navigator\.credentials/,
  /setting(?:Toggle|Choice|Range)\(\s*"prerelease"/,
  /setting(?:Toggle|Choice|Range)\(\s*"startup-updates"/,
  /setting(?:Toggle|Choice|Range)\(\s*"update-frequency"/,
];
const missingActions = requiredActions.filter(
  (action) => !actions.includes(action),
);
const missingSettings = requiredSettings.filter(
  (key) => !settingKeys.includes(key),
);
const presentForbidden = forbidden
  .filter((pattern) => pattern.test(prototype))
  .map(String);
const inlineScript = prototype.match(/<script>([\s\S]*)<\/script>/)?.[1];

if (!inlineScript) throw new Error("Missing inline prototype script");
new Script(inlineScript);

if (
  missingActions.length ||
  missingSettings.length ||
  presentForbidden.length
) {
  throw new Error(
    [
      missingActions.length && `Missing actions: ${missingActions.join(", ")}`,
      missingSettings.length &&
        `Missing settings: ${missingSettings.join(", ")}`,
      presentForbidden.length &&
        `Forbidden prototype tokens: ${presentForbidden.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

console.log(
  `Prototype declaration check: actions=${actions.length} literalSettingKeys=${settingKeys.length} dynamicPlayerControls=${dynamicPlayerControls} totalSettingKeys=${settingKeys.length + dynamicPlayerControls} requiredActions=${requiredActions.length} requiredSettings=${requiredSettings.length}`,
);
