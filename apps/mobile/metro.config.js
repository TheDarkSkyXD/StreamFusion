const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const queryStringCompatPath = path.resolve(
  __dirname,
  "vendor/query-string-compat.cjs",
);
const coreSubpathPattern = /^@streamfusion\/core\/([a-z-]+)$/u;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const coreSubpath = coreSubpathPattern.exec(moduleName)?.[1];
  if (coreSubpath) {
    return {
      filePath: path.resolve(
        __dirname,
        "../../packages/core/src",
        coreSubpath,
        "index.ts",
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

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
