const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const queryStringCompatPath = path.resolve(
  __dirname,
  "vendor/query-string-compat.cjs",
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "query-string" &&
    /[\\/]node_modules[\\/]expo-router[\\/]/.test(context.originModulePath)
  ) {
    return { filePath: queryStringCompatPath, type: "sourceFile" };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
