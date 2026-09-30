const { withAppBuildGradle } = require("expo/config-plugins");

const UPLOAD_SIGNING_CONFIG = `        release {
            storeFile file(System.getenv("STREAMFUSION_UPLOAD_STORE_FILE") ?: "release.keystore")
            storePassword System.getenv("STREAMFUSION_UPLOAD_STORE_PASSWORD")
            keyAlias System.getenv("STREAMFUSION_UPLOAD_KEY_ALIAS")
            keyPassword System.getenv("STREAMFUSION_UPLOAD_KEY_PASSWORD")
        }
`;

/**
 * Expo's prebuild template hardcodes `signingConfig signingConfigs.debug` on
 * the release build type, so a release APK is signed with the shared Android
 * debug key. That is not a slower upload, it is a different application
 * identity: Android would refuse to update such an install later, and anyone
 * holding the well-known debug key could produce an update that the platform
 * accepts.
 *
 * This rewrites the release build type to use a signing config built from the
 * keystore the release workflow materializes, and fails the build outright when
 * that keystore is absent so a debug-signed APK can never be produced by
 * accident.
 */
function applyReleaseSigning(contents) {
  if (contents.includes("STREAMFUSION_UPLOAD_STORE_FILE")) {
    return contents;
  }

  const withConfig = contents.replace(
    /^[ \t]*signingConfigs \{/mu,
    (match) => `${match}\n${UPLOAD_SIGNING_CONFIG}`,
  );
  if (withConfig === contents) {
    throw new Error(
      "with-production-signing could not find a signingConfigs block in app/build.gradle",
    );
  }

  // The debug build type legitimately signs with the debug key. Only the release
  // build type must change, so match the debug reference that sits inside the
  // release block rather than the first one in the file.
  const rewritten = withConfig.replace(
    /(^[ \t]*release \{[^}]*?)signingConfig signingConfigs\.debug/imu,
    "$1signingConfig signingConfigs.release",
  );
  if (rewritten === withConfig) {
    throw new Error(
      "with-production-signing could not find a release build type signing its APK with the debug key",
    );
  }
  return rewritten;
}

function withProductionSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        `with-production-signing only supports Groovy build scripts, found ${config.modResults.language}`,
      );
    }
    config.modResults.contents = applyReleaseSigning(config.modResults.contents);
    return config;
  });
}

module.exports = withProductionSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
module.exports.UPLOAD_SIGNING_CONFIG = UPLOAD_SIGNING_CONFIG;
