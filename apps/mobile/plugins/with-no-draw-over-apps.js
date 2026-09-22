const { withAndroidManifest } = require("expo/config-plugins");

const OVERLAY_PERMISSION = "android.permission.SYSTEM_ALERT_WINDOW";

/**
 * Keep SYSTEM_ALERT_WINDOW off the main/release manifest.
 * Debug manifests may still declare it for the RN Dev Menu / FPS overlay.
 * Product Search, mini-player, and PiP do not need draw-over-apps.
 */
function stripSystemAlertWindowPermission(manifest) {
  const permissions = manifest["uses-permission"];
  if (!Array.isArray(permissions)) return manifest;
  manifest["uses-permission"] = permissions.filter((entry) => {
    const name = entry?.$?.["android:name"];
    return name !== OVERLAY_PERMISSION;
  });
  return manifest;
}

function withNoDrawOverApps(config) {
  return withAndroidManifest(config, (config) => {
    stripSystemAlertWindowPermission(config.modResults.manifest);
    return config;
  });
}

module.exports = withNoDrawOverApps;
module.exports.stripSystemAlertWindowPermission = stripSystemAlertWindowPermission;
module.exports.OVERLAY_PERMISSION = OVERLAY_PERMISSION;
