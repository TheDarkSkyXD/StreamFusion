const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const yaml = require("js-yaml");

const artifactsDirectory = "artifacts";
const outputDirectory = "release-assets";
const version = process.argv[2];

if (!version) {
  throw new Error("usage: node .github/scripts/merge_artifacts.js <version>");
}

const expectedBundles = {
  "streamfusion-windows-x64": [
    `StreamFusion-${version}-Setup.exe`,
    `StreamFusion-${version}-Setup.exe.blockmap`,
    "latest.yml",
  ],
  "streamfusion-macos-x64": [
    `StreamFusion-${version}-x64.dmg`,
    `StreamFusion-${version}-x64.zip`,
    "latest-mac.yml",
  ],
  "streamfusion-macos-arm64": [
    `StreamFusion-${version}-arm64.dmg`,
    `StreamFusion-${version}-arm64.zip`,
    "latest-mac.yml",
  ],
};

const bundleEntries = fs.readdirSync(artifactsDirectory, { withFileTypes: true });
for (const entry of bundleEntries) {
  if (!entry.isDirectory() || !Object.hasOwn(expectedBundles, entry.name)) {
    throw new Error(`unexpected artifact bundle: ${entry.name}`);
  }
}

const releaseAssets = new Map();
const assetHashes = new Map();
for (const [bundleName, expectedFiles] of Object.entries(expectedBundles)) {
  const bundleDirectory = path.join(artifactsDirectory, bundleName);
  const actualEntries = fs.readdirSync(bundleDirectory, { withFileTypes: true });
  const allowedFiles = new Set(expectedFiles);

  for (const filename of expectedFiles) {
    const artifactPath = path.join(bundleDirectory, filename);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`missing required artifact: ${artifactPath}`);
    }
    if (!filename.endsWith(".yml")) {
      if (releaseAssets.has(filename)) {
        throw new Error(`conflicting duplicate release artifact: ${filename}`);
      }
      releaseAssets.set(filename, artifactPath);
    }
  }

  for (const entry of actualEntries) {
    if (!entry.isFile() || !allowedFiles.has(entry.name)) {
      throw new Error(`unexpected release artifact: ${path.join(bundleDirectory, entry.name)}`);
    }
  }
}

function readUpdaterMetadata(bundleName, filename) {
  const metadataPath = path.join(artifactsDirectory, bundleName, filename);
  let document;
  try {
    document = yaml.load(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`invalid updater metadata ${metadataPath}: ${error.message}`);
  }

  if (!document || document.version !== version) {
    throw new Error(
      `metadata version ${document?.version ?? "<missing>"} does not match release ${version}`
    );
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error(`updater metadata has no files: ${metadataPath}`);
  }

  for (const file of document.files) {
    if (!file || typeof file.url !== "string" || path.basename(file.url) !== file.url) {
      throw new Error(`updater metadata has an invalid asset URL: ${metadataPath}`);
    }
    const assetPath = releaseAssets.get(file.url);
    if (!assetPath) {
      throw new Error(`metadata references missing asset ${file.url}`);
    }
    if (!Number.isSafeInteger(file.size) || file.size !== fs.statSync(assetPath).size) {
      throw new Error(`metadata size does not match asset ${file.url}`);
    }
    if (typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
      throw new Error(`metadata sha512 is invalid for asset ${file.url}`);
    }
    let actualHash = assetHashes.get(file.url);
    if (!actualHash) {
      actualHash = createHash("sha512").update(fs.readFileSync(assetPath)).digest("base64");
      assetHashes.set(file.url, actualHash);
    }
    if (file.sha512 !== actualHash) {
      throw new Error(`metadata sha512 does not match asset ${file.url}`);
    }
  }
  const hasTopLevelPath = Object.hasOwn(document, "path");
  const hasTopLevelHash = Object.hasOwn(document, "sha512");
  const topLevelFile = hasTopLevelPath
    ? document.files.find((file) => file.url === document.path)
    : undefined;
  if (
    hasTopLevelPath !== hasTopLevelHash ||
    (hasTopLevelPath && (!topLevelFile || document.sha512 !== topLevelFile.sha512))
  ) {
    throw new Error("top-level metadata path and sha512 must match files[]");
  }
  return document;
}

function mergeUpdaterMetadata(documents) {
  const merged = { ...documents[0], files: [] };
  const filesByUrl = new Map();

  for (const document of documents) {
    for (const file of document.files) {
      const existing = filesByUrl.get(file.url);
      if (existing && !isDeepStrictEqual(existing, file)) {
        throw new Error(`conflicting updater metadata for ${file.url}`);
      }
      filesByUrl.set(file.url, file);
    }
    if (document.releaseDate && (!merged.releaseDate || document.releaseDate > merged.releaseDate)) {
      merged.releaseDate = document.releaseDate;
    }
  }

  merged.files = [...filesByUrl.values()].sort((left, right) => left.url.localeCompare(right.url));
  const primaryFile = merged.files[0];
  merged.path = primaryFile.url;
  merged.sha512 = primaryFile.sha512;
  if (Object.hasOwn(merged, "size")) {
    merged.size = primaryFile.size;
  }
  return merged;
}

const windowsMetadata = readUpdaterMetadata("streamfusion-windows-x64", "latest.yml");
const macMetadata = mergeUpdaterMetadata([
  readUpdaterMetadata("streamfusion-macos-arm64", "latest-mac.yml"),
  readUpdaterMetadata("streamfusion-macos-x64", "latest-mac.yml"),
]);

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
for (const [filename, sourcePath] of [...releaseAssets].sort(([left], [right]) =>
  left.localeCompare(right)
)) {
  fs.copyFileSync(sourcePath, path.join(outputDirectory, filename));
}
fs.writeFileSync(path.join(outputDirectory, "latest.yml"), yaml.dump(windowsMetadata));
fs.writeFileSync(path.join(outputDirectory, "latest-mac.yml"), yaml.dump(macMetadata));

console.log(`Prepared ${releaseAssets.size + 2} validated release assets for v${version}.`);
