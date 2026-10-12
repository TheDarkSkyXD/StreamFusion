module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["module:@react-native/babel-preset"],
    plugins: ["@babel/plugin-transform-export-namespace-from", "./scripts/public-config-babel-plugin.cjs", "react-native-worklets/plugin"],
  };
};
