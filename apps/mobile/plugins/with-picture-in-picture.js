const { withAndroidManifest } = require("expo/config-plugins");

const PIP_CONFIG_CHANGES = [
  "keyboard",
  "keyboardHidden",
  "orientation",
  "screenLayout",
  "screenSize",
  "smallestScreenSize",
  "uiMode",
];

const PIP_REPLACE = "android:supportsPictureInPicture,android:resizeableActivity";

function mergeConfigChanges(existing) {
  return [...new Set([...(existing ?? "").split("|").filter(Boolean), ...PIP_CONFIG_CHANGES])].join(
    "|",
  );
}

function mergeToolsReplace(existing) {
  return [...new Set([...(existing ?? "").split(",").map((part) => part.trim()).filter(Boolean), ...PIP_REPLACE.split(",")])].join(
    ",",
  );
}

function isLauncherActivity(name) {
  return typeof name === "string" && name.endsWith("MainActivity");
}

function applyPictureInPictureToManifest(manifest) {
  const application = manifest.application?.[0];
  if (application?.$) {
    application.$["android:resizeableActivity"] = "true";
  }
  const activities = application?.activity ?? [];
  for (const activity of activities) {
    if (!activity.$) continue;
    activity.$["android:supportsPictureInPicture"] = "true";
    activity.$["android:resizeableActivity"] = "true";
    activity.$["android:configChanges"] = mergeConfigChanges(
      activity.$["android:configChanges"],
    );
    if (isLauncherActivity(activity.$["android:name"])) {
      activity.$["tools:replace"] = mergeToolsReplace(activity.$["tools:replace"]);
    }
  }
  return manifest;
}

function withPictureInPicture(config) {
  return withAndroidManifest(config, (config) => {
    applyPictureInPictureToManifest(config.modResults.manifest);
    return config;
  });
}

module.exports = withPictureInPicture;
module.exports.applyPictureInPictureToManifest = applyPictureInPictureToManifest;
