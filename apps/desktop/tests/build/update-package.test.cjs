const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm } = require("node:fs/promises");
const path = require("node:path");
const { NsisUpdater } = require("electron-updater");
const { Platform } = require("app-builder-lib");
const { build } = require("../../package.json");
const startBuild = require("../../start.builder.config.cjs");

for (const [name, config, signed] of [
  ["desktop", build, false],
  ["start", startBuild, false],
  ["signed desktop", build, true],
]) {
  test(`${name} directory package supports GitHub updates without an installer target`, async () => {
    const scratch = path.resolve(__dirname, "../../.cache/update-package-tests");
    await mkdir(scratch, { recursive: true });
    const appOutDir = await mkdtemp(path.join(scratch, "package-"));
    const resources = path.join(appOutDir, "resources");
    await mkdir(resources);
    try {
      const packager = {
        config,
        platform: Platform.WINDOWS,
        platformSpecificBuildOptions: config.win,
        appInfo: { version: "2.0.0", updaterCacheDirName: "streamfusion-updater" },
        info: { config, repositoryInfo: null, appInfo: { version: "2.0.0" } },
        expandMacro: (value) => value,
        getResourcesDir: () => resources,
        isForceCodeSigningVerification: signed,
        signingManager: {
          value: Promise.resolve({
            computedPublisherName: { value: Promise.resolve(["StreamFusion Test Publisher"]) },
          }),
        },
      };
      if (config.afterPack) {
        await require(path.resolve(__dirname, "../..", config.afterPack))({
          packager,
          appOutDir,
          arch: 1,
          targets: [],
          electronPlatformName: "win32",
        });
      }
      const updater = new NsisUpdater(null, {
        version: "2.0.0",
        name: "StreamFusion",
        isPackaged: true,
        appUpdateConfigPath: path.join(resources, "app-update.yml"),
        baseCachePath: appOutDir,
      });
      const downloadHelper = await updater.getOrCreateDownloadHelper();
      assert.equal(downloadHelper.cacheDir, path.join(appOutDir, "streamfusion-updater"));
      const metadata = await readFile(updater.app.appUpdateConfigPath, "utf8");
      assert.match(
        metadata,
        /https:\/\/github.com\/TheDarkSkyXD\/StreamFusion\/releases\/latest\/download/
      );
      if (signed) assert.match(metadata, /publisherName:\s+- StreamFusion Test Publisher/);
    } finally {
      await rm(appOutDir, { recursive: true, force: true });
    }
  });
}
