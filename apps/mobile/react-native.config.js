const path = require("node:path");

module.exports = {
  reactNativePath: path.dirname(require.resolve("react-native/package.json")),
  project: { android: { sourceDir: "android", appName: "app" } },
};
