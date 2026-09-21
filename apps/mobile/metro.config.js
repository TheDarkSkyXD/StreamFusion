const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const workspaceRoot = path.resolve(__dirname, "../..");
const mobileRoot = __dirname;
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

const mobileOrigin = path.join(mobileRoot, "package.json");

function isReactFamily(moduleName) {
  return (
    moduleName === "react" ||
    moduleName === "react-native" ||
    moduleName.startsWith("react/") ||
    moduleName.startsWith("react-native/")
  );
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
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
