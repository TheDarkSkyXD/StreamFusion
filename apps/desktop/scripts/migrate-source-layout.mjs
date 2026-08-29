import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(desktopRoot, "src");

const moves = [
  ["features/discovery/components/HomePage", "frontend/pages/Home"],
  ["features/discovery/components/FollowingPage", "frontend/pages/Following"],
  ["features/discovery/components/CategoriesPage", "frontend/pages/Categories"],
  ["features/discovery/components/CategoryDetailPage", "frontend/pages/CategoryDetail"],
  ["features/discovery/components/SearchPage", "frontend/pages/SearchResults"],
  ["features/playback/components/StreamPage", "frontend/pages/Stream"],
  ["features/playback/components/VideoPage", "frontend/pages/Video"],
  ["features/media-library/components/DownloadsPage", "frontend/pages/Downloads"],
  ["features/media-library/components/HistoryPage", "frontend/pages/History"],
  ["features/moderation/components/ModPage", "frontend/pages/Mod"],
  ["features/multistream/components/MultiStreamPage", "frontend/pages/MultiStream"],
  ["features/settings/components/SettingsPage", "frontend/pages/Settings"],
  ["features/playback/utils/managed-interval.ts", "shared/utils/managed-interval.ts"],
  ["lib/chromium-cache-path.ts", "backend/utility/chromium-cache-path.ts"],
  ["lib/cross-logger.ts", "shared/utils/cross-logger.ts"],
  ["lib/sleep.ts", "shared/utils/sleep.ts"],
  ["lib/user-data-path.ts", "backend/utility/user-data-path.ts"],
  ["main.ts", "backend/main.ts"],
  ["preload", "backend/preload"],
  ["ipc-contracts", "shared/ipc-contracts"],
  ["shared/electron.d.ts", "frontend/electron.d.ts"],
  ["shared/svg.d.ts", "frontend/svg.d.ts"],
  ["shared/sherpa-onnx-node.d.ts", "backend/sherpa-onnx-node.d.ts"],
  ["App.tsx", "frontend/App.tsx"],
  ["renderer.tsx", "frontend/renderer.tsx"],
  ["global.css", "frontend/global.css"],
  ["vite-env.d.ts", "frontend/vite-env.d.ts"],
  ["assets", "frontend/assets"],
  ["components", "frontend/components"],
  ["dev-relay", "frontend/dev-relay"],
  ["docs", "frontend/docs"],
  ["features", "frontend/features"],
  ["hooks", "frontend/hooks"],
  ["lib", "frontend/lib"],
  ["providers", "frontend/providers"],
  ["renderer", "frontend/renderer"],
  ["routes", "frontend/routes"],
  ["slot-renderer", "frontend/slot-renderer"],
  ["store", "frontend/store"],
].map(([from, to]) => ({ from, to }));

const checkOnly = process.argv.includes("--check");
const sortedMoves = moves.sort((left, right) => right.from.length - left.from.length);
const requiredPages = [
  "Categories",
  "CategoryDetail",
  "Downloads",
  "Following",
  "History",
  "Home",
  "Mod",
  "MultiStream",
  "SearchResults",
  "Settings",
  "Stream",
  "Video",
];
const requiredFeatureFolders = ["components", "data", "routes", "utils"];
const normalize = (value) => path.normalize(value);
const sourcePath = (value) => path.join(sourceRoot, normalize(value));

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

function mappedPath(value) {
  const absolute = normalize(value);
  for (const move of sortedMoves) {
    const from = sourcePath(move.from);
    const to = sourcePath(move.to);
    const fromWithoutExtension = from.replace(/\.[^.\\/]+$/, "");
    const toWithoutExtension = to.replace(/\.[^.\\/]+$/, "");
    if (absolute === fromWithoutExtension) return toWithoutExtension;
    if (absolute === from || absolute.startsWith(`${from}${path.sep}`)) {
      return path.join(to, path.relative(from, absolute));
    }
  }
  return absolute;
}

function resolveSpecifier(specifier, importer) {
  if (specifier.startsWith("@/")) return path.join(sourceRoot, specifier.slice(2));
  if (specifier.startsWith("@backend/")) {
    return path.join(sourceRoot, "backend", specifier.slice("@backend/".length));
  }
  if (specifier.startsWith("@frontend/")) {
    return path.join(sourceRoot, "frontend", specifier.slice("@frontend/".length));
  }
  if (specifier.startsWith("@shared/")) {
    return path.join(sourceRoot, "shared", specifier.slice("@shared/".length));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return path.resolve(path.dirname(importer), specifier);
  }
  return undefined;
}

function aliasFor(target) {
  const roots = [
    [path.join(sourceRoot, "frontend"), "@/"],
    [path.join(sourceRoot, "backend"), "@backend/"],
    [path.join(sourceRoot, "shared"), "@shared/"],
  ];
  for (const [root, prefix] of roots) {
    if (target === root || target.startsWith(`${root}${path.sep}`)) {
      return `${prefix}${path.relative(root, target).split(path.sep).join("/")}`;
    }
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
    const alias = aliasFor(target);
    return alias ? `${alias}${suffix}` : specifier;
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
      const rewritten = rewriteSpecifier(`${prefix}${rest}`, oldFile, newFile);
      return `${context}${quote}${rewritten}${quote}`;
    }
  );
}

async function verifyLayout() {
  const failures = [];
  for (const move of sortedMoves) {
    const from = sourcePath(move.from);
    const to = sourcePath(move.to);
    if (await exists(from)) failures.push(`legacy path remains: ${move.from}`);
    if (!(await exists(to))) failures.push(`target is missing: ${move.to}`);
  }

  const sourceDirectories = (await fs.readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (sourceDirectories.join(",") !== "backend,frontend,shared") {
    failures.push(
      `src directories must be backend, frontend, shared; found: ${sourceDirectories.join(", ")}`
    );
  }

  const pagesRoot = path.join(sourceRoot, "frontend", "pages");
  for (const page of requiredPages) {
    if (!(await exists(path.join(pagesRoot, page))))
      failures.push(`page folder is missing: ${page}`);
  }

  const featuresRoot = path.join(sourceRoot, "frontend", "features");
  const featureEntries = await fs.readdir(featuresRoot, { withFileTypes: true });
  for (const feature of featureEntries.filter((entry) => entry.isDirectory())) {
    for (const folder of requiredFeatureFolders) {
      if (!(await exists(path.join(featuresRoot, feature.name, folder)))) {
        failures.push(`feature folder is missing: ${feature.name}/${folder}`);
      }
    }
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  process.stdout.write(`Verified ${sortedMoves.length} source-layout moves.\n`);
}

if (checkOnly) {
  await verifyLayout();
  process.exit(0);
}

const invalidMoves = [];
for (const move of sortedMoves) {
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
].filter((file) => /\.(?:[cm]?[jt]sx?|json|md|css|html)$/.test(file));

const snapshots = new Map();
for (const file of textFiles) snapshots.set(file, await fs.readFile(file, "utf8"));

for (const move of sortedMoves) {
  const from = sourcePath(move.from);
  const to = sourcePath(move.to);
  if (!(await exists(from)) && (await exists(to))) continue;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

for (const [oldFile, content] of snapshots) {
  const newFile = mappedPath(oldFile);
  const rewritten = rewriteSource(content, oldFile, newFile);
  if (rewritten !== content) await fs.writeFile(newFile, rewritten);
}

const featureMapPath = path.resolve(
  desktopRoot,
  "../../.agents/skills/streamfusion-feature-map/references/features.md"
);
let featureMap = await fs.readFile(featureMapPath, "utf8");
for (const [from, to] of [
  ["apps/desktop/src/features/", "apps/desktop/src/frontend/features/"],
  ["apps/desktop/src/routes/", "apps/desktop/src/frontend/routes/"],
  ["apps/desktop/src/components/", "apps/desktop/src/frontend/components/"],
  ["apps/desktop/src/store/", "apps/desktop/src/frontend/store/"],
  ["apps/desktop/src/preload/", "apps/desktop/src/backend/preload/"],
  ["apps/desktop/src/App.tsx", "apps/desktop/src/frontend/App.tsx"],
]) {
  featureMap = featureMap.replaceAll(from, to);
}
await fs.writeFile(featureMapPath, featureMap);

await verifyLayout();
