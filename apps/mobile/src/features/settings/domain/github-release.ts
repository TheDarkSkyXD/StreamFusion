import type { AndroidRelease, GithubReleaseCheck } from "../capabilities/support-settings";

type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly stage: number;
  readonly stageNumber: number;
};

const ANDROID_TAG = /^android-v(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?)$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?$/;
const STAGES: Record<string, number> = { alpha: 0, beta: 1, rc: 2 };
const RELEASE_BASE = "https://github.com/TheDarkSkyXD/StreamFusion/releases";

export function interpretGithubReleases(input: {
  readonly installedVersion: string;
  readonly allowPrerelease: boolean;
  readonly payload: unknown;
}): GithubReleaseCheck {
  if (!Array.isArray(input.payload)) {
    return { status: "error", message: "GitHub returned an invalid releases list. Try again." };
  }
  const installed = parseVersion(input.installedVersion);
  if (!installed) {
    return { status: "error", message: "The installed app version cannot be compared with Android releases." };
  }

  let latest: { release: AndroidRelease; version: Version } | null = null;
  let malformedNewer: Version | null = null;
  for (const item of input.payload) {
    const candidate = parseAndroidRelease(item);
    if (!candidate && isRecord(item) && typeof item.tag_name === "string") {
      const tag = ANDROID_TAG.exec(item.tag_name);
      const version = tag?.[1] ? parseVersion(tag[1]) : null;
      if (version && compareVersions(version, installed) > 0 &&
        (input.allowPrerelease || version.stage === 3) && item.draft !== true) {
        if (!malformedNewer || compareVersions(version, malformedNewer) > 0) {
          malformedNewer = version;
        }
      }
    }
    if (!candidate || (!input.allowPrerelease && candidate.version.stage < 3)) continue;
    if (!latest || compareVersions(candidate.version, latest.version) > 0) {
      latest = candidate;
    }
  }
  if (malformedNewer && (!latest || compareVersions(malformedNewer, latest.version) >= 0)) {
    return { status: "error", message: "A newer Android release has invalid update metadata. Try again later." };
  }
  if (!latest) {
    return { status: "current", release: null };
  }
  return compareVersions(latest.version, installed) > 0
    ? { status: "available", release: latest.release }
    : { status: "current", release: latest.release };
}

function parseAndroidRelease(value: unknown): { release: AndroidRelease; version: Version } | null {
  if (!isRecord(value) || value.draft === true || typeof value.tag_name !== "string") return null;
  const match = ANDROID_TAG.exec(value.tag_name);
  if (!match) return null;
  const versionText = match[1];
  if (!versionText) return null;
  const version = parseVersion(versionText);
  if (!version || value.prerelease !== (version.stage < 3) || !Array.isArray(value.assets)) return null;

  const tag = value.tag_name;
  const releaseUrl = `${RELEASE_BASE}/tag/${tag}`;
  const asset = value.assets.find((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.browser_download_url !== "string") return false;
    return entry.name === `StreamFusion-${tag}.apk` &&
      entry.browser_download_url === `${RELEASE_BASE}/download/${tag}/${entry.name}`;
  });
  if (!isRecord(asset) || typeof asset.browser_download_url !== "string") return null;
  const digest = typeof asset.digest === "string" && /^sha256:[a-fA-F0-9]{64}$/.test(asset.digest)
    ? asset.digest.slice(7).toLowerCase()
    : null;
  if (!digest || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 || asset.size > 1_000_000_000) return null;
  const manifestName = "android-update.json";
  const hasManifest = value.assets.some((entry: unknown) =>
    isRecord(entry) && entry.name === manifestName &&
    entry.browser_download_url === `${RELEASE_BASE}/download/${tag}/${manifestName}`);
  if (!hasManifest) return null;
  return {
    version,
    release: {
      version: versionText,
      tag,
      notes: typeof value.body === "string" ? value.body.trim().slice(0, 32_768) : "",
      releaseUrl,
      apkBytes: asset.size,
      apkSha256: digest,
    },
  };
}

function parseVersion(value: string): Version | null {
  const match = VERSION.exec(value.replace(/^v/, ""));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    stage: match[4] ? (STAGES[match[4]] ?? 3) : 3,
    stageNumber: match[5] ? Number(match[5]) : 0,
  };
}

function compareVersions(left: Version, right: Version): number {
  for (const key of ["major", "minor", "patch", "stage", "stageNumber"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
