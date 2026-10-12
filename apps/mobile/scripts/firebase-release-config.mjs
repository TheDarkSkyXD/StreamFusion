import { readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const applicationId = "com.thedarkskyxd.streamfusion";
const destination = resolve(dirname(fileURLToPath(import.meta.url)), "../android/app/google-services.json");
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const apiKey = /^AIza[A-Za-z0-9_-]{35}$/u;
const trustedKey = /^[A-Za-z0-9_-]{43}$/u;
const keyId = /^[A-Za-z0-9._:-]{1,128}$/u;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFirebaseConfig(firebaseConfig) {
  const project = isObject(firebaseConfig) ? firebaseConfig.project_info : undefined;
  const senderId = isObject(project) ? project.project_number : undefined;
  if (typeof senderId !== "string" || !/^[1-9]\d*$/u.test(senderId)) {
    throw new Error("Firebase project_info.project_number is required");
  }
  if (typeof project.project_id !== "string" || !/^[a-z][a-z0-9-]+[a-z0-9]$/u.test(project.project_id)) {
    throw new Error("Firebase project_info.project_id is required");
  }

  const clients = isObject(firebaseConfig) ? firebaseConfig.client : undefined;
  const client = Array.isArray(clients) ? clients.find((entry) =>
    isObject(entry) && isObject(entry.client_info) &&
    isObject(entry.client_info.android_client_info) &&
    entry.client_info.android_client_info.package_name === applicationId
  ) : undefined;
  if (!client) throw new Error(`Firebase client for ${applicationId} is required`);

  const appId = client.client_info.mobilesdk_app_id;
  if (typeof appId !== "string" || !new RegExp(`^1:${senderId}:android:[a-fA-F0-9]+$`, "u").test(appId)) {
    throw new Error("Firebase client_info.mobilesdk_app_id must match project_number");
  }
  if (!Array.isArray(client.api_key) || !client.api_key.some((entry) =>
    isObject(entry) && typeof entry.current_key === "string" && apiKey.test(entry.current_key)
  )) {
    throw new Error("Firebase client api_key.current_key is required");
  }
}

function validatePublicConfiguration(environment) {
  const relay = environment.STREAMFUSION_PUBLIC_RELAY_URL;
  let url;
  try {
    url = new URL(relay);
  } catch {
    throw new Error("STREAMFUSION_PUBLIC_RELAY_URL must be a production HTTPS URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    url.protocol !== "https:" || !hostname.includes(".") || isIP(hostname) ||
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    hostname.endsWith(".test") || hostname.endsWith(".invalid") ||
    hostname.endsWith(".example") || url.username || url.password || url.hash
  ) {
    throw new Error("STREAMFUSION_PUBLIC_RELAY_URL must be a production HTTPS URL");
  }

  let keys;
  try {
    keys = JSON.parse(environment.STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS);
  } catch {
    throw new Error("STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS must be a nonempty JSON key map");
  }
  if (
    !isObject(keys) || Object.keys(keys).length === 0 ||
    !Object.entries(keys).every(([id, value]) => keyId.test(id) && typeof value === "string" && trustedKey.test(value))
  ) {
    throw new Error("STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS must be a nonempty JSON key map");
  }
}

export function validateProductionReleaseConfig({ firebaseConfig, environment }) {
  validateFirebaseConfig(firebaseConfig);
  validatePublicConfiguration(environment);
}

export function materializeFirebaseConfig({ encoded, destination, environment }) {
  const normalized = typeof encoded === "string" ? encoded.replace(/\s+/gu, "") : "";
  if (!normalized || !base64.test(normalized)) {
    throw new Error("STREAMFUSION_MOBILE_GOOGLE_SERVICES_BASE64 must contain base64-encoded Firebase JSON");
  }
  let firebaseConfig;
  try {
    firebaseConfig = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    throw new Error("STREAMFUSION_MOBILE_GOOGLE_SERVICES_BASE64 must contain base64-encoded Firebase JSON");
  }
  validateProductionReleaseConfig({ firebaseConfig, environment });
  writeFileSync(destination, `${JSON.stringify(firebaseConfig)}\n`, { mode: 0o600 });
}

export function checkProductionReleaseConfig({ source, environment }) {
  let firebaseConfig;
  try {
    firebaseConfig = JSON.parse(readFileSync(source, "utf8"));
  } catch {
    throw new Error("Production requires android/app/google-services.json with valid Firebase JSON");
  }
  validateProductionReleaseConfig({ firebaseConfig, environment });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--materialize") {
      materializeFirebaseConfig({
        encoded: process.env.STREAMFUSION_MOBILE_GOOGLE_SERVICES_BASE64,
        destination,
        environment: process.env,
      });
    } else if (process.argv[2] === "--check") {
      checkProductionReleaseConfig({ source: destination, environment: process.env });
    } else {
      throw new Error("Use --materialize or --check");
    }
    console.log("Production Firebase and public relay configuration passed validation");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production configuration validation failed");
    process.exitCode = 1;
  }
}
