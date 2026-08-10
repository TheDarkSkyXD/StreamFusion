"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const electronBuilderDirectory = path.dirname(require.resolve("electron-builder/package.json"));
const appBuilderLibDirectory = path.join(path.dirname(electronBuilderDirectory), "app-builder-lib");
const { Data, NtExecutable, NtExecutableResource, Resource } = require(
  require.resolve("resedit", { paths: [appBuilderLibDirectory] })
);

async function mirrorRuntimeDirectory(sourceDirectory, targetDirectory) {
  await fs.mkdir(targetDirectory, { recursive: true });
  for (const entry of await fs.readdir(sourceDirectory, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === "electron.exe") continue;

    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      await mirrorRuntimeDirectory(sourcePath, targetPath);
    } else {
      await fs.link(sourcePath, targetPath);
    }
  }
}

async function prepareBrandedElectronExecutable({ electronPath, electronVersion, iconPath }) {
  if (process.platform !== "win32") return electronPath;

  const iconBuffer = await fs.readFile(iconPath);
  const iconHash = createHash("sha256").update(iconBuffer).digest("hex").slice(0, 12);
  const sourceDirectory = path.dirname(electronPath);
  const targetDirectory = path.join(
    path.dirname(sourceDirectory),
    `streamfusion-dev-${electronVersion}-${iconHash}`
  );
  const targetPath = path.join(targetDirectory, "electron.exe");
  const completionMarker = path.join(targetDirectory, ".complete");

  try {
    await fs.access(completionMarker);
    return targetPath;
  } catch {
    // Generate the branded executable below.
  }

  await fs.rm(targetDirectory, { recursive: true, force: true });
  await mirrorRuntimeDirectory(sourceDirectory, targetDirectory);

  const sourceBuffer = await fs.readFile(electronPath);
  const executable = NtExecutable.from(sourceBuffer);
  const resources = NtExecutableResource.from(executable);
  const iconFile = Data.IconFile.from(iconBuffer);

  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    0x0409,
    iconFile.icons.map((icon) => icon.data)
  );
  resources.outputResource(executable);

  await fs.writeFile(targetPath, Buffer.from(executable.generate()));
  await fs.writeFile(completionMarker, "");
  return targetPath;
}

module.exports = { prepareBrandedElectronExecutable };
