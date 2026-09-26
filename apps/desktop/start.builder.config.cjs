const { build } = require("./package.json");

module.exports = {
  ...build,
  directories: { ...build.directories, output: ".cache/start/package" },
  files: build.files.map((file) =>
    file === "out/**/*" ? { from: ".cache/start/app/out", to: "out", filter: ["**/*"] } : file
  ),
};
