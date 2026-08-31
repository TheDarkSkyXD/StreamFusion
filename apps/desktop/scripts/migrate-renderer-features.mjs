import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(desktopRoot, "src");

const moves = [
  ["shared", "backend/api/unified/platform-types.ts", "shared/platform-types.ts"],

  ["shell", "components/layout", "features/shell/components/layout"],
  ["shell", "components/TopNavBar", "features/shell/components/TopNavBar"],
  ["shell", "components/recovery", "features/shell/components/recovery"],
  ["shell", "components/ToastRoot.tsx", "features/shell/components/ToastRoot.tsx"],
  ["shell", "components/ToastRoot.stories.tsx", "features/shell/components/ToastRoot.stories.tsx"],
  ["shell", "hooks/app-shutdown-registry.ts", "features/shell/utils/app-shutdown-registry.ts"],
  ["shell", "hooks/use-app-shutdown.ts", "features/shell/data/use-app-shutdown.ts"],
  ["shell", "pages/preloadable-component.ts", "routes/preloadable-component.ts"],

  ["discovery", "pages/Home", "features/discovery/components/HomePage"],
  ["discovery", "pages/Following", "features/discovery/components/FollowingPage"],
  ["discovery", "pages/Categories", "features/discovery/components/CategoriesPage"],
  ["discovery", "pages/CategoryDetail", "features/discovery/components/CategoryDetailPage"],
  ["discovery", "pages/SearchResults", "features/discovery/components/SearchPage"],
  ["discovery", "components/discovery", "features/discovery/components/discovery"],
  ["discovery", "components/search", "features/discovery/components/search"],
  [
    "discovery",
    "components/stream/featured-stream.tsx",
    "features/discovery/components/stream/featured-stream.tsx",
  ],
  [
    "discovery",
    "components/stream/featured-stream.stories.tsx",
    "features/discovery/components/stream/featured-stream.stories.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-card.tsx",
    "features/discovery/components/stream/stream-card.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-card.stories.tsx",
    "features/discovery/components/stream/stream-card.stories.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-card-skeleton.tsx",
    "features/discovery/components/stream/stream-card-skeleton.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-card-skeleton.stories.tsx",
    "features/discovery/components/stream/stream-card-skeleton.stories.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-grid.tsx",
    "features/discovery/components/stream/stream-grid.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-grid.stories.tsx",
    "features/discovery/components/stream/stream-grid.stories.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-verified-badge.tsx",
    "features/discovery/components/stream/stream-verified-badge.tsx",
  ],
  [
    "discovery",
    "components/stream/stream-verified-badge.stories.tsx",
    "features/discovery/components/stream/stream-verified-badge.stories.tsx",
  ],
  ["discovery", "hooks/queries", "features/discovery/data/queries"],
  ["discovery", "hooks/useSearchHistory.ts", "features/discovery/data/useSearchHistory.ts"],
  [
    "discovery",
    "routes/category-detail-search.ts",
    "features/discovery/routes/category-detail-search.ts",
  ],
  ["discovery", "search", "features/discovery/utils/search"],

  ["playback", "pages/Stream", "features/playback/components/StreamPage"],
  ["playback", "pages/Video", "features/playback/components/VideoPage"],
  ["playback", "components/player", "features/playback/components/player"],
  ["playback", "components/stream/related-content", "features/playback/components/related-content"],
  ["playback", "components/stream/stream-info.tsx", "features/playback/components/stream-info.tsx"],
  [
    "playback",
    "components/stream/stream-info.stories.tsx",
    "features/playback/components/stream-info.stories.tsx",
  ],
  [
    "playback",
    "components/stream/active-recording-dialog.tsx",
    "features/playback/components/active-recording-dialog.tsx",
  ],
  [
    "playback",
    "components/stream/active-recording-dialog.stories.tsx",
    "features/playback/components/active-recording-dialog.stories.tsx",
  ],
  [
    "playback",
    "components/stream/vod-progress-bar.tsx",
    "features/playback/components/vod-progress-bar.tsx",
  ],
  [
    "playback",
    "components/stream/vod-progress-bar.stories.tsx",
    "features/playback/components/vod-progress-bar.stories.tsx",
  ],
  [
    "playback",
    "hooks/use-ad-element-observer.ts",
    "features/playback/data/use-ad-element-observer.ts",
  ],
  ["playback", "hooks/use-share-action.ts", "features/playback/data/use-share-action.ts"],
  ["playback", "hooks/useStreamPlayback.ts", "features/playback/data/useStreamPlayback.ts"],
  ["playback", "hooks/queries/useVodLiveLink.ts", "features/playback/data/useVodLiveLink.ts"],
  ["playback", "lib/managed-interval.ts", "features/playback/utils/managed-interval.ts"],
  ["playback", "lib/stream-route-preload.ts", "features/playback/routes/stream-route-preload.ts"],
  [
    "playback",
    "lib/twitch-playlist-ad-detection.ts",
    "features/playback/utils/twitch-playlist-ad-detection.ts",
  ],
  [
    "playback",
    "lib/twitch-rendition-continuity.ts",
    "features/playback/utils/twitch-rendition-continuity.ts",
  ],
  [
    "playback",
    "lib/twitch-unsafe-media-hold.ts",
    "features/playback/utils/twitch-unsafe-media-hold.ts",
  ],

  ["chat", "components/chat", "features/chat/components/chat"],
  ["chat", "components/chat-replay", "features/chat/components/chat-replay"],
  [
    "chat",
    "hooks/chat-replay-playback-store.ts",
    "features/chat/data/chat-replay-playback-store.ts",
  ],
  ["chat", "hooks/chat-replay-window.ts", "features/chat/routes/chat-replay-window.ts"],
  ["chat", "hooks/use-chat-replay.ts", "features/chat/data/use-chat-replay.ts"],
  ["chat", "hooks/useChatRoomState.ts", "features/chat/data/useChatRoomState.ts"],
  [
    "chat",
    "hooks/useChatSettingsSync.test-helpers.ts",
    "features/chat/data/useChatSettingsSync.test-helpers.ts",
  ],
  ["chat", "hooks/useChatSettingsSync.ts", "features/chat/data/useChatSettingsSync.ts"],
  [
    "chat",
    "hooks/useStickyDismissedPrediction.ts",
    "features/chat/data/useStickyDismissedPrediction.ts",
  ],
  ["chat", "lib/chat-density-presentation.ts", "features/chat/utils/chat-density-presentation.ts"],
  ["chat", "lib/chat-visuals.ts", "features/chat/utils/chat-visuals.ts"],

  ["auth", "components/auth", "features/auth/components/auth"],
  [
    "auth",
    "components/LiveNotificationToast.tsx",
    "features/auth/components/LiveNotificationToast.tsx",
  ],
  [
    "auth",
    "components/LiveNotificationToast.stories.tsx",
    "features/auth/components/LiveNotificationToast.stories.tsx",
  ],
  ["auth", "hooks/useAuth.ts", "features/auth/data/useAuth.ts"],
  [
    "auth",
    "hooks/use-live-notification-bridge.ts",
    "features/auth/data/use-live-notification-bridge.ts",
  ],
  ["auth", "hooks/useRequireModScopes.ts", "features/auth/data/useRequireModScopes.ts"],
  [
    "auth",
    "lib/live-notification-preferences.ts",
    "features/auth/utils/live-notification-preferences.ts",
  ],

  ["multistream", "pages/MultiStream", "features/multistream/components/MultiStreamPage"],
  ["multistream", "components/multistream", "features/multistream/components/multistream"],
  ["multistream", "store/multistream-store.ts", "features/multistream/data/multistream-store.ts"],

  ["media-library", "pages/Downloads", "features/media-library/components/DownloadsPage"],
  ["media-library", "pages/History", "features/media-library/components/HistoryPage"],
  ["media-library", "components/recording", "features/media-library/components/recording"],
  [
    "media-library",
    "components/download-duplicate-confirmation-dialog.tsx",
    "features/media-library/components/download-duplicate-confirmation-dialog.tsx",
  ],
  [
    "media-library",
    "components/download-duplicate-confirmation-dialog.stories.tsx",
    "features/media-library/components/download-duplicate-confirmation-dialog.stories.tsx",
  ],
  [
    "media-library",
    "hooks/use-download-actions.ts",
    "features/media-library/data/use-download-actions.ts",
  ],
  [
    "media-library",
    "hooks/use-stream-recording-actions.ts",
    "features/media-library/data/use-stream-recording-actions.ts",
  ],
  [
    "media-library",
    "hooks/use-stream-recording-state.tsx",
    "features/media-library/data/use-stream-recording-state.tsx",
  ],
  [
    "media-library",
    "hooks/queries/useHistoryQuery.ts",
    "features/media-library/data/useHistoryQuery.ts",
  ],
  [
    "media-library",
    "lib/stream-recording-presentation.ts",
    "features/media-library/utils/stream-recording-presentation.ts",
  ],

  ["moderation", "pages/Mod", "features/moderation/components/ModPage"],
  ["moderation", "hooks/mod-log-query-keys.ts", "features/moderation/data/mod-log-query-keys.ts"],
  ["moderation", "hooks/useIsKickMod.ts", "features/moderation/data/useIsKickMod.ts"],
  ["moderation", "hooks/useIsTwitchMod.ts", "features/moderation/data/useIsTwitchMod.ts"],
  [
    "moderation",
    "hooks/useModerationAuthority.ts",
    "features/moderation/data/useModerationAuthority.ts",
  ],
  ["moderation", "hooks/useModLog.ts", "features/moderation/data/useModLog.ts"],
  [
    "moderation",
    "hooks/useResolveTwitchChannel.ts",
    "features/moderation/data/useResolveTwitchChannel.ts",
  ],
  [
    "moderation",
    "store/moderated-channels-store.ts",
    "features/moderation/data/moderated-channels-store.ts",
  ],

  ["settings", "pages/Settings", "features/settings/components/SettingsPage"],
  ["settings", "components/settings", "features/settings/components/settings"],
  [
    "settings",
    "hooks/use-diagnostics-workspace.ts",
    "features/settings/data/use-diagnostics-workspace.ts",
  ],
  ["settings", "hooks/useElectron.ts", "features/settings/data/useElectron.ts"],
  ["settings", "hooks/useNetworkStatus.ts", "features/settings/data/useNetworkStatus.ts"],
  ["settings", "hooks/usePlatformHealth.ts", "features/settings/data/usePlatformHealth.ts"],
  ["settings", "hooks/useUpdater.ts", "features/settings/data/useUpdater.ts"],
  ["settings", "renderer/diagnostics", "features/settings/data/diagnostics"],
  ["settings", "lib/settings-toast.ts", "features/settings/utils/settings-toast.ts"],
].map(([feature, from, to]) => ({
  feature,
  from,
  to:
    to === "features/playback/utils/managed-interval.ts"
      ? "shared/utils/managed-interval.ts"
      : feature !== "shell" && from.startsWith("pages/")
        ? `frontend/${from}`
        : to.startsWith("features/") || to.startsWith("routes/")
          ? `frontend/${to}`
          : to,
}));

const requestedFeature = process.argv.includes("--feature")
  ? process.argv[process.argv.indexOf("--feature") + 1]
  : undefined;
const checkOnly = process.argv.includes("--check");
const selectedMoves = moves
  .filter(({ feature }) => requestedFeature === undefined || feature === requestedFeature)
  .sort((left, right) => right.from.length - left.from.length);

if (requestedFeature && !moves.some(({ feature }) => feature === requestedFeature)) {
  throw new Error(`Unknown feature: ${requestedFeature}`);
}

const normalize = (value) => path.normalize(value);
const sourcePath = (value) => path.join(sourceRoot, normalize(value));

function mappedPath(value) {
  const absolute = normalize(value);
  for (const move of selectedMoves) {
    const from = sourcePath(move.from);
    const fromWithoutExtension = from.replace(/\.[^.\\/]+$/, "");
    const toWithoutExtension = sourcePath(move.to).replace(/\.[^.\\/]+$/, "");
    if (absolute === fromWithoutExtension) return toWithoutExtension;
    if (absolute === from || absolute.startsWith(`${from}${path.sep}`)) {
      return path.join(sourcePath(move.to), path.relative(from, absolute));
    }
  }
  return absolute;
}

async function exists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(root) {
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

function resolveSpecifier(specifier, importer) {
  if (specifier.startsWith("@/")) return path.join(sourceRoot, specifier.slice(2));
  if (specifier.startsWith("@backend/")) {
    return path.join(sourceRoot, "backend", specifier.slice("@backend/".length));
  }
  if (specifier.startsWith("@shared/")) {
    return path.join(sourceRoot, "shared", specifier.slice("@shared/".length));
  }
  if (specifier.startsWith("@frontend/")) {
    return path.join(sourceRoot, "frontend", specifier.slice("@frontend/".length));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return path.resolve(path.dirname(importer), specifier);
  }
  return undefined;
}

function rewriteSpecifier(specifier, oldImporter, newImporter) {
  const suffixIndex = specifier.search(/[?#]/);
  const bareSpecifier = suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : specifier.slice(suffixIndex);
  const resolved = resolveSpecifier(bareSpecifier, oldImporter);
  if (!resolved) return specifier;
  const target = mappedPath(resolved);
  const importerMoved = mappedPath(oldImporter);

  if (/^@(?:backend|frontend|shared)?\//.test(bareSpecifier)) {
    const aliasRoots = [
      [path.join(sourceRoot, "frontend"), "@/"],
      [path.join(sourceRoot, "backend"), "@backend/"],
      [path.join(sourceRoot, "shared"), "@shared/"],
    ];
    for (const [root, prefix] of aliasRoots) {
      if (target === root || target.startsWith(`${root}${path.sep}`)) {
        return `${prefix}${path.relative(root, target).split(path.sep).join("/")}${suffix}`;
      }
    }
    return specifier;
  }
  if (target === resolved && importerMoved === oldImporter) return specifier;

  let relative = path.relative(path.dirname(newImporter), target).split(path.sep).join("/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return `${relative}${suffix}`;
}

function rewriteSource(content, oldFile, newFile) {
  return content.replace(
    /(\b(?:from|import|require|mock|doMock)\s*\(?\s*)(["'])(@\/|@backend\/|@frontend\/|@shared\/|\.\.?\/)([^"'\r\n]*)\2/g,
    (match, context, quote, prefix, rest) => {
      const specifier = `${prefix}${rest}`;
      const rewritten = rewriteSpecifier(specifier, oldFile, newFile);
      return `${context}${quote}${rewritten}${quote}`;
    }
  );
}

async function verifyLayout() {
  const failures = [];
  for (const move of selectedMoves) {
    const from = sourcePath(move.from);
    const to = sourcePath(move.to);
    if (await exists(from)) failures.push(`legacy path remains: ${move.from}`);
    if (!(await exists(to))) failures.push(`target is missing: ${move.to}`);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  process.stdout.write(`Verified ${selectedMoves.length} feature moves.\n`);
}

if (checkOnly) {
  await verifyLayout();
  process.exit(0);
}

const invalidMoves = [];
for (const move of selectedMoves) {
  const fromExists = await exists(sourcePath(move.from));
  const toExists = await exists(sourcePath(move.to));
  if (fromExists === toExists) {
    invalidMoves.push(
      fromExists
        ? `both source and target exist: ${move.from} -> ${move.to}`
        : `source and target are missing: ${move.from} -> ${move.to}`
    );
  }
}
if (invalidMoves.length > 0) {
  throw new Error(`Migration preflight failed:\n${invalidMoves.join("\n")}`);
}

const textFiles = [
  ...(await collectFiles(path.join(desktopRoot, "src"))),
  ...(await collectFiles(path.join(desktopRoot, "tests"))),
  ...(await collectFiles(path.join(desktopRoot, ".storybook"))),
].filter((file) => /\.(?:[cm]?[jt]sx?|json|md)$/.test(file));

const snapshots = new Map();
for (const file of textFiles) snapshots.set(file, await fs.readFile(file, "utf8"));

for (const move of selectedMoves) {
  const from = sourcePath(move.from);
  const to = sourcePath(move.to);
  const fromExists = await exists(from);
  const toExists = await exists(to);
  if (!fromExists && toExists) continue;
  if (!fromExists) throw new Error(`Missing source: ${move.from}`);
  if (toExists) throw new Error(`Refusing to overwrite target: ${move.to}`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

for (const [oldFile, content] of snapshots) {
  const newFile = mappedPath(oldFile);
  const rewritten = rewriteSource(content, oldFile, newFile);
  if (rewritten !== content) await fs.writeFile(newFile, rewritten);
}

await verifyLayout();
