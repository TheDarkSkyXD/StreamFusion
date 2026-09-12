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
  "action:activity-tab",
  "action:activity-mark-read",
  "action:activity-dismiss-item",
  "action:activity-clear-completed",
  "shell-route:activity",
  "shell-route:activity/alert-preview",
  "shell-route:more",
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
  "screen:search",
  "screen:home",
  "screen:categories",
  "screen:following",
  "screen:channel",
  "screen:watch",
  "screen:multi",
  "screen:history",
  "screen:moderation-home",
  "screen:settings",
  "shell-route:search",
  "shell-route:search/result-preview",
  "shell-route:following",
  "shell-route:following/channel-preview",
  "shell-route:watch",
  "shell-route:watch/session-preview",
  "shell-route:activity/job-preview",
  "shell-route:more/home",
  "shell-route:more/categories",
  "shell-route:more/multistream",
  "shell-route:more/history",
  "shell-route:more/moderation",
  "shell-route:more/settings",
]);

const owners = {
  "screen:search": [130, 132, 133, 147, 149],
  "screen:home": [130, 131, 132, 147, 148],
  "screen:categories": [130, 132, 133, 147, 150],
  "screen:category-detail": [130, 132, 133, 147, 150],
  "screen:following": [134, 147, 151],
  "screen:channel": [130, 132, 133, 147, 148, 151],
  "screen:watch": [152, 153, 156, 157, 167],
  "screen:video": [133, 153, 154],
  "screen:multi": [143, 160, 167],
  "screen:history": [155],
  "screen:activity": [141, 151, 172, 173, 174],
  "screen:moderation-home": [159, 168],
  "screen:moderation": [159, 168],
  "screen:settings": [167, 168, 170],
  "screen:accounts": [135, 145, 146, 151],
  "screen:system": [143, 170, 171],
  "screen:more": [139, 141],
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
  "action:activity-clear-completed": [
    "apps/mobile/src/features/activity/domain/activity-inbox-workflow.ts",
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
      "Search, Following, Watch, Home, Categories, History, Moderation, and Settings remain placeholders. Feature issues own those screens.",
    owners: [147, 148, 149, 150, 152, 155, 159, 167],
  },
  {
    id: "GAP-195-03",
    status: "owned-elsewhere",
    finding:
      "The 17 Settings panels and six Diagnostics tabs have no Mobile routes or tab components.",
    owners: [143, 167, 170, 171],
  },
  {
    id: "GAP-195-04",
    status: "owned-elsewhere",
    finding:
      "Guest and account notification delivery, FCM, and job producers are absent. Activity is a local inbox only.",
    owners: [151, 163, 172, 173, 174],
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

The Activity destination shows an unread badge. Android Back cancels an Activity dismissal confirmation before it pops a route. Reselecting Activity scrolls the inbox to the top. Search, Following, Watch, Settings, and Diagnostics tabs stay with their owners.

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
