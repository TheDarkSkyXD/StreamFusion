const { readFileSync } = require("node:fs");
const path = require("node:path");

const VERSION = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?$/u;
const CERTIFICATE = /^[a-f0-9]{64}$/u;

function resolveNativeConfig({ config } = {}, environment = process.env) {
  const committed = JSON.parse(readFileSync(path.join(__dirname, "native-config.json"), "utf8"));
  if (environment.STREAMFUSION_RELEASE_CHANNEL !== "production") {
    if (config && JSON.stringify(config) !== JSON.stringify(committed)) throw new Error("Development identity must match native-config.json");
    return committed;
  }
  const version = environment.STREAMFUSION_PRODUCTION_VERSION;
  const code = environment.STREAMFUSION_PRODUCTION_VERSION_CODE;
  if (!version || !VERSION.test(version)) throw new Error("A production build requires STREAMFUSION_PRODUCTION_VERSION");
  if (!code || !/^[1-9]\d*$/u.test(code) || !Number.isSafeInteger(Number(code))) throw new Error("A production build requires STREAMFUSION_PRODUCTION_VERSION_CODE");
  const signer = JSON.parse(readFileSync(path.join(__dirname, "config/production-signing-certificate.json"), "utf8"));
  if (signer.applicationId !== "com.thedarkskyxd.streamfusion") throw new Error("The pinned signer must belong to the production application id");
  if (!CERTIFICATE.test(signer.certificateSha256 ?? "")) throw new Error("The production signing certificate must be pinned before building");
  return {
    ...committed,
    name: "StreamFusion",
    slug: "streamfusion",
    scheme: "streamfusion",
    version,
    android: { ...committed.android, package: "com.thedarkskyxd.streamfusion", versionCode: Number(code) },
  };
}

module.exports = resolveNativeConfig;
