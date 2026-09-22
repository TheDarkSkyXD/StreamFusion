const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const workspaceRoot = path.resolve(__dirname, "../..");
const mobileRoot = __dirname;
const desktopI18nRoot = path.resolve(
  workspaceRoot,
  "apps/desktop/src/frontend/i18n",
);
const config = getDefaultConfig(mobileRoot);
const queryStringCompatPath = path.resolve(
  mobileRoot,
  "vendor/query-string-compat.cjs",
);
const coreSubpathPattern = /^@streamfusion\/core\/([a-z-]+)$/u;
const tanstackModern = new Set([
  "@tanstack/query-core",
  "@tanstack/react-query",
]);

// Expo SDK 52+ already configures monorepo watchFolders + nodeModulesPaths.
// Replacing nodeModulesPaths can load duplicate react-native copies and crash
// Hermes with "property is not writable" inside setUpDefaultReactNativeEnvironment.
// Only trim unrelated workspace apps from watchers to keep FD usage down.
const ignoredWatchSuffixes = [
  `${path.sep}apps${path.sep}desktop`,
  `${path.sep}apps${path.sep}worker`,
  `${path.sep}apps${path.sep}integration-relay`,
];
config.watchFolders = (config.watchFolders ?? []).filter(
  (folder) =>
    !ignoredWatchSuffixes.some((suffix) => folder.endsWith(suffix)),
);
// Share desktop display-language catalogs without watching the whole Electron app.
if (!config.watchFolders.includes(desktopI18nRoot)) {
  config.watchFolders.push(desktopI18nRoot);
}

const mobileOrigin = path.join(mobileRoot, "package.json");

function isReactFamily(moduleName) {
  return (
    moduleName === "react" ||
    moduleName === "react-native" ||
    moduleName.startsWith("react/") ||
    moduleName.startsWith("react-native/")
  );
}

const fs = require("node:fs");

function resolveDesktopI18nPath(remainder) {
  const base = path.resolve(desktopI18nRoot, remainder);
  for (const ext of ["", ".ts", ".tsx", ".js", ".json"]) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  for (const ext of [".ts", ".tsx", ".js"]) {
    const candidate = path.join(base, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return base;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@desktop-i18n" || moduleName.startsWith("@desktop-i18n/")) {
    const remainder =
      moduleName === "@desktop-i18n"
        ? "index"
        : moduleName.slice("@desktop-i18n/".length);
    return {
      filePath: resolveDesktopI18nPath(remainder),
      type: "sourceFile",
    };
  }
  const coreSubpath = coreSubpathPattern.exec(moduleName)?.[1];
  if (coreSubpath) {
    return {
      filePath: path.resolve(
        mobileRoot,
        "../../packages/core/src",
        coreSubpath,
        "index.ts",
      ),
      type: "sourceFile",
    };
  }
  if (tanstackModern.has(moduleName)) {
    return {
      filePath: path.resolve(
        workspaceRoot,
        "node_modules",
        moduleName,
        "build/modern/index.js",
      ),
      type: "sourceFile",
    };
  }
  if (
    moduleName === "query-string" &&
    /[\\/]node_modules[\\/]expo-router[\\/]/.test(context.originModulePath)
  ) {
    return { filePath: queryStringCompatPath, type: "sourceFile" };
  }

  // Prefer the app workspace copy of react / react-native so Metro never mixes
  // root 0.86.2 with apps/mobile 0.86.3 during RN environment setup.
  if (isReactFamily(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: mobileOrigin },
      moduleName,
      platform,
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
