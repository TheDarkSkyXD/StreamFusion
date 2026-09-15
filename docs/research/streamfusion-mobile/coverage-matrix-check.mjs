import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const shellPath = resolve(
  root,
  "apps/mobile/src/features/shell/domain/shell-navigation.ts",
);
const reportPath = resolve(
  root,
  "docs/research/streamfusion-mobile/coverage-matrix.md",
);
const ledgerPath = resolve(
  root,
  "docs/research/streamfusion-mobile/coverage-matrix-ledger.json",
);

const prototype = readFileSync(prototypePath, "utf8").replaceAll("\r\n", "\n");
const contract = readFileSync(contractPath, "utf8");
const shellSource = readFileSync(shellPath, "utf8");

const between = (text, start, end) => {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Missing prototype anchor: ${start} -> ${end}`);
  }
  return text.slice(startIndex, endIndex);
};
const unique = (values) => [...new Set(values)];
const ids = (text, pattern) => {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return unique(
    [...text.matchAll(new RegExp(pattern.source, flags))].map((match) => match[1]),
  );
};
const parseContractIdentifiers = (markdown) =>
  unique(
    [...markdown.matchAll(/<!-- contract:(screen|panel|tab|action):([^ ]+) -->/g)].map(
      ([, kind, name]) => `${kind}:${name}`,
    ),
  );
const reconcileContractInventory = (contractIds, inventoryIds) => {
  const contractSet = new Set(contractIds);
  const inventorySet = new Set(inventoryIds);
  const missingFromContract = inventoryIds.filter((id) => !contractSet.has(id));
  const extraInContract = contractIds.filter((id) => !inventorySet.has(id));
  const mismatches = [
    missingFromContract.length > 0
      ? `missingFromContract:\n${missingFromContract.join("\n")}`
      : null,
    extraInContract.length > 0
      ? `extraInContract:\n${extraInContract.join("\n")}`
      : null,
  ].filter(Boolean);
  if (mismatches.length === 0) {
    return;
  }
  throw new Error(
    `Contract identifiers do not match prototype inventory:\n${mismatches.join("\n")}`,
  );
};

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
const screens = [
  ...ids(screenBlock, /id: "([^"]+)"/g),
  ...panels.map((panel) => `settings-${panel}`),
];
const tabBlock = between(
  prototype,
  "const tabReviewGroups",
  "const tabbedScreens",
);
const tabs = [
  ...tabBlock.matchAll(
    /screen: "([^"]+)"[\s\S]*?tabs: \[([\s\S]*?)\],\n\s*\},/g,
  ),
].flatMap(([, screen, group]) =>
  ids(group, /"([^"]+)"/g).map((tab) => `${screen}:${tab}`),
);
const actions = ids(prototype, /data-action="([a-z][a-z0-9-]*)"/g);
const shellRoutes = ids(shellSource, /route\(\s*"([^"]+)"/g);

const discovered = [
  ...screens.map((id) => `screen:${id}`),
  ...panels.map((id) => `panel:${id}`),
  ...tabs.map((id) => `tab:${id}`),
  ...actions.map((id) => `action:${id}`),
  ...shellRoutes.map((id) => `shell-route:${id}`),
];
const prototypeInventory = discovered.filter((id) => !id.startsWith("shell-route:"));
reconcileContractInventory(parseContractIdentifiers(contract), prototypeInventory);

const implemented = new Set([
  "screen:activity",
  "screen:more",
  "tab:activity:all",
  "tab:activity:channels",
  "tab:activity:jobs",
  "panel:proxy",
  "screen:settings-proxy",
  "panel:adblock",
  "screen:settings-adblock",
  "action:activity-tab",
  "action:activity-mark-read",
  "action:activity-dismiss-item",
  "action:activity-clear-completed",
  "shell-route:activity",
  "shell-route:activity/alert-preview",
  "shell-route:activity/job-preview",
  "shell-route:more",
  "screen:search",
  "screen:home",
  "screen:categories",
  "screen:category-detail",
  "screen:following",
  "screen:channel",
  "screen:watch",
  "tab:search:all",
  "tab:search:channels",
  "tab:search:streams",
  "tab:search:videos",
  "tab:search:clips",
  "tab:search:categories",
  "tab:category-detail:live",
  "tab:category-detail:clips",
  "tab:category-detail:videos",
  "tab:channel:home",
  "tab:channel:videos",
  "tab:channel:clips",
  "tab:following:live",
  "tab:following:videos",
  "tab:following:clips",
  "tab:following:categories",
  "tab:following:channels",
  "shell-route:search",
  "shell-route:following",
  "shell-route:following/manage",
  "shell-route:more/home",
  "shell-route:more/channel",
  "shell-route:more/categories",
  "shell-route:more/category-detail",
  "shell-route:watch",
  "shell-route:watch/session-preview",
  "action:channel-follow",
  "action:player-play-pause",
  "action:player-mute",
  "action:player-quality",
  "action:player-fullscreen",
  "action:player-pip",
  "action:player-seek-back",
  "action:player-seek-forward",
  "action:mini-player-pause",
  "action:dismiss-player",
  "screen:video",
  "tab:watch:chat",
  "tab:watch:info",
  "tab:watch:related",
  "screen:history",
  "shell-route:more/history",
  "action:history-clear",
  "action:history-remove",
  "screen:multi",
  "shell-route:more/multistream",
  "action:multistream-add",
  "action:multistream-edit",
  "action:audio-owner",
  "action:restore-slot",
  "action:cool-device",
  "screen:settings",
  "panel:appearance",
  "panel:playback",
  "panel:player-controls",
  "panel:buffer",
  "panel:multiview",
  "screen:settings-appearance",
  "screen:settings-playback",
  "screen:settings-player-controls",
  "screen:settings-buffer",
  "screen:settings-multiview",
  "screen:settings-notifications",
  "panel:notifications",
  "shell-route:more/settings",
]);

const partial = new Set([
  "screen:accounts",
  "screen:system",
  "action:connect-account",
  "action:cancel-account-connect",
  "action:copy-account-code",
  "action:open-account-verification",
  "action:retry-account-connect",
  "action:manage-account",
  "action:disconnect-account",
  "action:refresh-capability-policy",
  "action:retry-installation-registration",
  "shell-route:more/accounts",
  "shell-route:more/diagnostics",
]);

const placeholder = new Set([
  "screen:moderation-home",
  "shell-route:search/result-preview",
  "shell-route:following/channel-preview",
  "shell-route:more/moderation",
]);

const owners = {
  "screen:search": [130, 132, 133, 147, 149],
  "screen:home": [130, 131, 132, 147, 148],
  "screen:categories": [130, 132, 133, 147, 150],
  "screen:category-detail": [130, 132, 133, 147, 150],
  "screen:following": [134, 147, 151],
  "screen:channel": [130, 132, 133, 147, 148, 151],
  "action:channel-follow": [151],
  "action:player-play-pause": [152, 153],
  "action:player-mute": [153],
  "action:player-quality": [152, 153],
  "action:player-fullscreen": [152, 153],
  "action:player-pip": [153],
  "action:player-seek-back": [154],
  "action:player-seek-forward": [154],
  "action:mini-player-pause": [152, 153],
  "action:dismiss-player": [152, 153],
  "screen:watch": [152, 153, 156, 157, 167],
  "screen:video": [133, 153, 154],
  "tab:watch:chat": [152, 156],
  "tab:watch:info": [152, 154],
  "tab:watch:related": [152, 154],
  "screen:multi": [143, 160, 167],
  "screen:history": [155],
  "screen:activity": [141, 151, 163, 172, 173, 174],
  "tab:activity:jobs": [141, 163],
  "shell-route:activity/job-preview": [163],
  "screen:moderation-home": [159, 168],
  "screen:moderation": [159, 168],
  "screen:settings": [167, 168, 169, 170],
  "screen:accounts": [135, 145, 146, 151],
  "screen:system": [143, 170, 171],
  "screen:more": [139, 141],
  "screen:settings-proxy": [162, 169],
  "panel:proxy": [162],
  "screen:settings-adblock": [161, 169],
  "panel:adblock": [161],
  "panel:appearance": [167],
  "panel:playback": [167],
  "panel:player-controls": [167],
  "panel:buffer": [167],
  "panel:multiview": [167],
  "panel:notifications": [169],
  "screen:settings-notifications": [169],
  "screen:settings-appearance": [167],
  "screen:settings-playback": [167],
  "screen:settings-player-controls": [167],
  "screen:settings-buffer": [167],
  "screen:settings-multiview": [167],
  "shell-route:more/settings": [162, 167, 169],
  "tab:search:all": [147, 149],
  "tab:search:channels": [147, 149],
  "tab:search:streams": [147, 149],
  "tab:search:videos": [147, 149],
  "tab:search:clips": [147, 149],
  "tab:search:categories": [147, 149],
  "tab:category-detail:live": [147, 150],
  "tab:category-detail:clips": [147, 150],
  "tab:category-detail:videos": [147, 150],
  "tab:channel:home": [147, 148],
  "tab:channel:videos": [147, 148],
  "tab:channel:clips": [147, 148],
  "tab:following:live": [147, 151],
  "tab:following:videos": [147, 151],
  "tab:following:clips": [147, 151],
  "tab:following:categories": [147, 151],
  "tab:following:channels": [147, 151],
  "shell-route:more/history": [155],
  "action:history-clear": [155],
  "action:history-remove": [155],
  "shell-route:more/multistream": [160],
  "action:multistream-add": [160],
  "action:multistream-edit": [160],
  "action:audio-owner": [160],
  "action:restore-slot": [160],
  "action:cool-device": [160],
};

const paths = {
  "screen:activity": [
    "apps/mobile/src/features/activity/components/activity-screen.tsx",
  ],
  "screen:more": ["apps/mobile/src/features/shell/components/app-shell.tsx"],
  "screen:accounts": [
    "apps/mobile/src/features/auth/components/twitch-accounts-panel.tsx",
  ],
  "screen:system": [
    "apps/mobile/src/features/capability-profile/components/capability-profile-panel.tsx",
  ],
  "shell-route:activity": [
    "apps/mobile/src/features/activity/components/activity-screen.tsx",
  ],
  "shell-route:activity/job-preview": [
    "apps/mobile/src/features/media-jobs/components/media-job-screen.tsx",
  ],
  "screen:search": [
    "apps/mobile/src/features/discovery/components/unified-search-screen.tsx",
  ],
  "screen:home": [
    "apps/mobile/src/features/discovery/components/home-live-discovery-screen.tsx",
  ],
  "screen:categories": [
    "apps/mobile/src/features/discovery/components/categories-screen.tsx",
  ],
  "screen:category-detail": [
    "apps/mobile/src/features/discovery/components/category-detail-screen.tsx",
  ],
  "screen:following": [
    "apps/mobile/src/features/follows/components/following-workspace.tsx",
  ],
  "screen:channel": [
    "apps/mobile/src/features/discovery/components/channel-detail-screen.tsx",
  ],
  "tab:search:all": [
    "apps/mobile/src/features/discovery/components/search-results-view.tsx",
  ],
  "tab:search:channels": [
    "apps/mobile/src/features/discovery/components/search-results-view.tsx",
  ],
  "tab:search:streams": [
    "apps/mobile/src/features/discovery/components/search-results-view.tsx",
  ],
  "tab:search:videos": [
    "apps/mobile/src/features/discovery/components/search-results-view.tsx",
  ],
  "tab:search:clips": [
    "apps/mobile/src/features/discovery/components/search-results-view.tsx",
  ],
  "tab:search:categories": [
    "apps/mobile/src/features/discovery/components/search-results-view.tsx",
  ],
  "tab:category-detail:live": [
    "apps/mobile/src/features/discovery/components/category-detail-view.tsx",
  ],
  "tab:category-detail:clips": [
    "apps/mobile/src/features/discovery/components/category-detail-view.tsx",
  ],
  "tab:category-detail:videos": [
    "apps/mobile/src/features/discovery/components/category-detail-view.tsx",
  ],
  "tab:channel:home": [
    "apps/mobile/src/features/discovery/components/channel-tabs.tsx",
  ],
  "tab:channel:videos": [
    "apps/mobile/src/features/discovery/components/channel-tabs.tsx",
  ],
  "tab:channel:clips": [
    "apps/mobile/src/features/discovery/components/channel-tabs.tsx",
  ],
  "tab:following:live": [
    "apps/mobile/src/features/follows/components/following-tab-body.tsx",
  ],
  "tab:following:videos": [
    "apps/mobile/src/features/follows/components/following-tab-body.tsx",
  ],
  "tab:following:clips": [
    "apps/mobile/src/features/follows/components/following-tab-body.tsx",
  ],
  "tab:following:categories": [
    "apps/mobile/src/features/follows/components/following-tab-body.tsx",
  ],
  "tab:following:channels": [
    "apps/mobile/src/features/follows/components/following-tab-body.tsx",
  ],
  "shell-route:search": [
    "apps/mobile/src/features/discovery/components/unified-search-screen.tsx",
  ],
  "shell-route:following": [
    "apps/mobile/src/features/follows/components/following-workspace.tsx",
  ],
  "shell-route:following/manage": [
    "apps/mobile/src/features/follows/components/following-workspace.tsx",
  ],
  "shell-route:more/home": [
    "apps/mobile/src/features/discovery/components/home-live-discovery-screen.tsx",
  ],
  "shell-route:more/channel": [
    "apps/mobile/src/features/discovery/components/channel-detail-screen.tsx",
  ],
  "action:channel-follow": [
    "apps/mobile/src/features/discovery/components/channel-header.tsx",
  ],
  "screen:watch": [
    "apps/mobile/src/features/watch/components/watch-screen.tsx",
  ],
  "screen:video": [
    "apps/mobile/src/features/watch/components/watch-screen.tsx",
  ],
  "tab:watch:chat": [
    "apps/mobile/src/features/watch/components/watch-tabs.tsx",
  ],
  "tab:watch:info": [
    "apps/mobile/src/features/watch/components/watch-tabs.tsx",
  ],
  "tab:watch:related": [
    "apps/mobile/src/features/watch/components/watch-tabs.tsx",
  ],
  "shell-route:watch": [
    "apps/mobile/src/features/watch/components/watch-route.tsx",
  ],
  "shell-route:watch/session-preview": [
    "apps/mobile/src/features/watch/components/watch-route.tsx",
  ],
  "shell-route:more/categories": [
    "apps/mobile/src/features/discovery/components/categories-screen.tsx",
  ],
  "shell-route:more/category-detail": [
    "apps/mobile/src/features/discovery/components/category-detail-screen.tsx",
  ],
  "panel:proxy": [
    "apps/mobile/src/features/connectivity/components/proxy-settings-panel.tsx",
  ],
  "screen:settings-proxy": [
    "apps/mobile/src/features/connectivity/components/proxy-settings-panel.tsx",
  ],
  "panel:adblock": [
    "apps/mobile/src/features/ad-blocking/components/adblock-settings-panel.tsx",
  ],
  "screen:settings-adblock": [
    "apps/mobile/src/features/ad-blocking/components/adblock-settings-panel.tsx",
    "apps/mobile/src/features/shell/components/app-shell.tsx",
  ],
  "shell-route:more/settings": [
    "apps/mobile/src/features/shell/components/app-shell.tsx",
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "screen:settings": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "panel:appearance": [
    "apps/mobile/src/features/settings/components/settings-panels.tsx",
  ],
  "panel:playback": [
    "apps/mobile/src/features/settings/components/settings-panels.tsx",
  ],
  "panel:player-controls": [
    "apps/mobile/src/features/settings/components/settings-panels.tsx",
  ],
  "panel:buffer": [
    "apps/mobile/src/features/settings/components/settings-panels.tsx",
  ],
  "panel:multiview": [
    "apps/mobile/src/features/settings/components/settings-panels.tsx",
  ],
  "screen:settings-appearance": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "screen:settings-playback": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "screen:settings-player-controls": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "screen:settings-buffer": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "screen:settings-multiview": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
  ],
  "panel:notifications": [
    "apps/mobile/src/features/settings/components/notifications-settings-panel.tsx",
  ],
  "screen:settings-notifications": [
    "apps/mobile/src/features/settings/components/settings-workspace.tsx",
    "apps/mobile/src/features/settings/components/notifications-settings-panel.tsx",
  ],
  "action:activity-clear-completed": [
    "apps/mobile/src/features/activity/domain/activity-inbox-workflow.ts",
  ],
  "action:player-play-pause": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:player-mute": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:player-quality": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:player-fullscreen": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:player-pip": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:player-seek-back": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:player-seek-forward": [
    "apps/mobile/src/features/watch/components/player-controls.tsx",
  ],
  "action:mini-player-pause": [
    "apps/mobile/src/features/watch/components/mini-player.tsx",
  ],
  "action:dismiss-player": [
    "apps/mobile/src/features/watch/components/mini-player.tsx",
  ],
  "screen:history": [
    "apps/mobile/src/features/media-library/components/history-screen.tsx",
  ],
  "shell-route:more/history": [
    "apps/mobile/src/features/shell/components/app-shell.tsx",
    "apps/mobile/src/features/media-library/components/history-screen.tsx",
  ],
  "action:history-clear": [
    "apps/mobile/src/features/media-library/components/history-view.tsx",
  ],
  "action:history-remove": [
    "apps/mobile/src/features/media-library/components/history-row.tsx",
  ],
  "screen:multi": [
    "apps/mobile/src/features/multistream/components/multistream-view.tsx",
  ],
  "shell-route:more/multistream": [
    "apps/mobile/src/features/shell/components/app-shell.tsx",
    "apps/mobile/src/features/multistream/components/multistream-screen.tsx",
  ],
  "action:multistream-add": [
    "apps/mobile/src/features/multistream/components/multistream-view.tsx",
  ],
  "action:multistream-edit": [
    "apps/mobile/src/features/multistream/components/multistream-view.tsx",
  ],
  "action:audio-owner": [
    "apps/mobile/src/features/multistream/components/multistream-slot.tsx",
  ],
  "action:restore-slot": [
    "apps/mobile/src/features/multistream/components/multistream-view.tsx",
  ],
  "action:cool-device": [
    "apps/mobile/src/features/multistream/components/multistream-view.tsx",
  ],
};

const classified = new Set([...implemented, ...partial, ...placeholder]);
const unknownClass = [...classified].filter((id) => !discovered.includes(id));
if (unknownClass.length > 0) {
  throw new Error(
    `Coverage status refers to unknown inventory ids:\n${unknownClass.join("\n")}`,
  );
}

const classify = (id) =>
  implemented.has(id)
    ? "implemented"
    : partial.has(id)
      ? "partial"
      : placeholder.has(id)
        ? "placeholder"
        : "missing";

const entries = discovered.map((id) => {
  const [kind, ...rest] = id.split(":");
  const status = classify(id);
  const implementation = paths[id] ?? [];
  for (const filePath of implementation) {
    if (!existsSync(resolve(root, filePath))) {
      throw new Error(`Coverage path is missing: ${filePath}`);
    }
  }
  return {
    id,
    kind,
    name: rest.join(":"),
    status,
    owners: owners[id] ?? [],
    implementation,
    verification: status === "implemented" ? "tests" : "missing",
    evidence: [],
    designRef: "docs/research/streamfusion-mobile/mobile-screen-and-control-contract.md",
  };
});

const totals = entries.reduce((counts, entry) => {
  counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}, {});

const gaps = [
  {
    id: "GAP-195-01",
    status: "escalated",
    finding:
      "More destination order conflicts. The contract lists Accounts before Settings and Diagnostics. SHELL MORE_ROUTE_IDS keeps Accounts last. This PR does not change navigation order.",
    owners: [104, 139, 195],
  },
  {
    id: "GAP-195-02",
    status: "owned-elsewhere",
    finding:
      "Watch and typed History cover guest live HLS, recorded Twitch/Kick video, Twitch clips, and local Stream/Video/Clip rows. Moderation remains a placeholder. Appearance, playback, player controls, buffer, and multiview Settings now persist and apply to Watch and Multistream. Chat and later Settings panels remain on M06+.",
    owners: [147, 148, 149, 150, 152, 159, 167],
  },
  {
    id: "GAP-195-03",
    status: "owned-elsewhere",
    finding:
      "Chat Settings remains M06. Diagnostics still lack dedicated Mobile routes. Notifications, Ad blocking, and Proxy are searchable Settings panels with Product Store authority; remote FCM stays N01.",
    owners: [143, 168, 169, 170, 171],
  },
  {
    id: "GAP-195-04",
    status: "owned-elsewhere",
    finding:
      "Guest notification preferences, Android permission status, and denial recovery live on Settings. Remote FCM registration and background delivery remain N01–N03. Activity is still a local inbox.",
    owners: [151, 169, 172, 173, 174],
  },
  {
    id: "GAP-195-05",
    status: "open",
    finding:
      "More order is recorded, not changed. Physical-device and live-provider evidence remain missing for unfinished features.",
    owners: [195, 196],
  },
];

const ledger = {
  schemaVersion: 1,
  issue: 195,
  designAuthority: [
    "docs/research/streamfusion-mobile/prototypes/android-navigation-prototype.html",
    "docs/research/streamfusion-mobile/mobile-screen-and-control-contract.md",
    "docs/research/streamfusion-mobile/android-navigation-and-interaction-model.md",
  ],
  totals: {
    discovered: entries.length,
    implemented: totals.implemented ?? 0,
    partial: totals.partial ?? 0,
    placeholder: totals.placeholder ?? 0,
    missing: totals.missing ?? 0,
  },
  entries,
  gaps,
};

writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const rows = entries
  .map(
    (entry) =>
      `| \`${entry.id}\` | ${entry.status} | ${entry.owners.map((issue) => `#${issue}`).join(", ") || "—"} | ${entry.implementation.join(", ") || "—"} | ${entry.verification} |`,
  )
  .join("\n");
const gapRows = gaps
  .map(
    (gap) =>
      `| \`${gap.id}\` | ${gap.status} | ${gap.finding} | ${gap.owners.map((issue) => `#${issue}`).join(", ")} |`,
  )
  .join("\n");

const report = `# Mobile coverage matrix

This matrix is the #195 inventory. It is not a claim that every feature is done.
Specification, implementation, and verification stay separate. Feature owners keep their screens.

Source revisions are the files in this commit. The checker fails when a contract screen, tab, panel, action, or shell route appears or disappears without a matching row.

## Totals

| Status | Count |
| --- | ---: |
| Implemented | ${ledger.totals.implemented} |
| Partial | ${ledger.totals.partial} |
| Placeholder | ${ledger.totals.placeholder} |
| Missing | ${ledger.totals.missing} |
| Discovered | ${ledger.totals.discovered} |

Implemented means the current candidate has a working control or screen for that row.
Placeholder means the shell can open a saved-place route.
Missing means no route or control exists yet.

## Source register

| Source | Role |
| --- | --- |
| #104 approved prototype B and later amendments | Navigation model |
| [Screen and control contract](mobile-screen-and-control-contract.md) | Screens, tabs, panels, actions |
| [Implementation specification](streamfusion-mobile-implementation-specification.md) | Business rules |
| \`apps/mobile/src/features/shell/domain/shell-navigation.ts\` | Current shell routes |
| #110 updater policy | Supersedes mockup prerelease and hourly update choices |

## Inventory

| Id | Status | Owners | Implementation | Verification |
| --- | --- | --- | --- | --- |
${rows}

## Gap register

| Id | Status | Finding | Owners |
| --- | --- | --- | --- |
${gapRows}

## This increment

Guest Search, Home, Channel Detail, Categories, Following, Watch, recorded video/clip playback, typed History, and Media Job preview land in this candidate. Moderation, remaining Settings panels, and remaining Diagnostics tabs stay with their owners.

Run \`node docs/research/streamfusion-mobile/coverage-matrix-check.mjs\` after a contract or shell-route change.
`;

writeFileSync(reportPath, report);

if (actions.length === 0 || screens.length === 0 || shellRoutes.length === 0) {
  throw new Error(
    `Empty coverage inventory: screens=${screens.length} actions=${actions.length} shellRoutes=${shellRoutes.length}`,
  );
}

console.log(
  `Mobile coverage matrix: discovered=${ledger.totals.discovered} implemented=${ledger.totals.implemented} partial=${ledger.totals.partial} placeholder=${ledger.totals.placeholder} missing=${ledger.totals.missing} gaps=${gaps.length}`,
);
console.log(
  "This check reconciles the approved inventory with the current shell. It does not prove provider or native behavior.",
);
