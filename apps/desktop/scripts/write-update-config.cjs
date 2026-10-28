const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { getAppUpdatePublishConfiguration } = require("app-builder-lib/out/publish/PublishManager");
const { serializeToYaml } = require("builder-util");

// electron-builder skips updater metadata for directory-only Windows builds.
module.exports = async ({ packager, appOutDir, arch }) => {
  const config = await getAppUpdatePublishConfiguration(packager, null, arch, true);
  await writeFile(
    path.join(packager.getResourcesDir(appOutDir), "app-update.yml"),
    serializeToYaml(config)
  );
};
