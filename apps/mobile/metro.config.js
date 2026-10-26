const path = require("node:path");
const { getDefaultConfig } = require("@react-native/metro-config");

const workspaceRoot = path.resolve(__dirname, "../..");
const mobileRoot = __dirname;
const desktopI18nRoot = path.resolve(
  workspaceRoot,
  "apps/desktop/src/frontend/i18n",
);
const config = getDefaultConfig(mobileRoot);
const coreSubpathPattern = /^@streamfusion\/core\/([a-z-]+)$/u;
const tanstackModern = new Set([
  "@tanstack/query-core",
  "@tanstack/react-query",
]);

config.watchFolders = [path.join(workspaceRoot, "packages", "core"), desktopI18nRoot];
config.resolver.blockList = [
  ...[config.resolver.blockList].flat(),
  /[\\/]android[\\/](?:\.gradle|\.cxx|build|app[\\/](?:build|\.cxx))[\\/].*/,
];

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

function resolveSourcePath(root, remainder, platform) {
  const base = path.resolve(root, remainder);
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
  const suffixes = [platform, "native", ""].flatMap((variant) => extensions.map((extension) => variant ? `.${variant}${extension}` : extension));
  for (const ext of ["", ...suffixes]) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  for (const ext of suffixes) {
    const candidate = path.join(base, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return base;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("@mobile/")) {
    return {
      filePath: resolveSourcePath(path.join(mobileRoot, "src"), moduleName.slice("@mobile/".length), platform),
      type: "sourceFile",
    };
  }
  if (moduleName === "@desktop-i18n" || moduleName.startsWith("@desktop-i18n/")) {
    const remainder =
      moduleName === "@desktop-i18n"
        ? "index"
        : moduleName.slice("@desktop-i18n/".length);
    return {
      filePath: resolveSourcePath(desktopI18nRoot, remainder, platform),
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
        mobileRoot,
        "node_modules",
        moduleName,
        "build/modern/index.js",
      ),
      type: "sourceFile",
    };
  }

  if (isReactFamily(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: mobileOrigin },
      moduleName,
      platform,
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.nodeModulesPaths = [path.join(mobileRoot, "node_modules")];
module.exports = config;
