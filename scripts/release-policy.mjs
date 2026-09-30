import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESKTOP_TAG_PREFIX = "v";
const MOBILE_TAG_PREFIX = "android-v";
const PRERELEASE_LABELS = {
  alpha: "Alpha",
  beta: "Beta",
  rc: "Release Candidate",
};

function parseVersion(version, product) {
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    return { version, prerelease: false, prereleaseLabel: "" };
  }

  const prereleaseMatch = version.match(/^\d+\.\d+\.\d+-(alpha|beta|rc)(?:\.(\d+))?$/);
  if (!prereleaseMatch) {
    throw new Error(`unsupported ${product} release version: ${version}`);
  }

  return {
    version,
    prerelease: true,
    prereleaseLabel: PRERELEASE_LABELS[prereleaseMatch[1]],
  };
}

export function validateReleaseTag({ tag, version }) {
  if (tag !== `${DESKTOP_TAG_PREFIX}${version}`) {
    throw new Error(
      `release tag ${tag} must exactly match desktop version ${DESKTOP_TAG_PREFIX}${version}`,
    );
  }
  return parseVersion(version, "desktop");
}

export function validateMobileReleaseTag({ tag, version }) {
  if (tag !== `${MOBILE_TAG_PREFIX}${version}`) {
    throw new Error(
      `release tag ${tag} must exactly match mobile version ${MOBILE_TAG_PREFIX}${version}`,
    );
  }
  return parseVersion(version, "mobile");
}

function isMobileTag(tag) {
  return tag.startsWith(MOBILE_TAG_PREFIX);
}

function runCli() {
  const [, , tag, outputPath] = process.argv;
  if (!tag || !outputPath) {
    throw new Error("usage: node scripts/release-policy.mjs <tag> <github-output-path>");
  }

  const mobile = isMobileTag(tag);
  const manifest = mobile ? "mobile" : "desktop";
  const packagePath = fileURLToPath(
    new URL(`../apps/${manifest}/package.json`, import.meta.url),
  );
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  const release = mobile
    ? validateMobileReleaseTag({ tag, version })
    : validateReleaseTag({ tag, version });
  appendFileSync(
    outputPath,
    [
      `release_tag=${tag}`,
      `product=${manifest}`,
      `version=${release.version}`,
      `prerelease=${release.prerelease}`,
      `prerelease_label=${release.prereleaseLabel}`,
      "",
    ].join("\n")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
