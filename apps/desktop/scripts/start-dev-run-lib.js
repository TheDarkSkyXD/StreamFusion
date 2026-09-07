"use strict";

const { existsSync } = require("node:fs");
const { cp, copyFile, mkdir, mkdtemp, rm } = require("node:fs/promises");
const path = require("node:path");

async function createDevelopmentRun(projectDir) {
  const runsDir = path.join(projectDir, ".cache", "dev-runs");
  await mkdir(runsDir, { recursive: true });

  const runDir = await mkdtemp(path.join(runsDir, "start-"));
  const appDir = path.join(runDir, "app");
  const outDir = path.join(appDir, "out");
  await mkdir(appDir, { recursive: true });
  await copyFile(path.join(projectDir, "package.json"), path.join(appDir, "package.json"));
  await cp(path.join(projectDir, "assets", "icons"), path.join(appDir, "assets", "icons"), {
    recursive: true,
  });
  const utilityDir = path.join(projectDir, "out", "utility");
  if (existsSync(utilityDir)) {
    await cp(utilityDir, path.join(outDir, "utility"), { recursive: true });
  }

  return {
    appDir,
    outDir,
    cleanup: () => rm(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
  };
}

function createElectronViteArguments(userArgs, developmentRun) {
  const separatorIndex = userArgs.indexOf("--");
  const viteArgs = separatorIndex === -1 ? userArgs : userArgs.slice(0, separatorIndex);
  const electronArgs = separatorIndex === -1 ? [] : userArgs.slice(separatorIndex);

  return [
    "dev",
    ...viteArgs,
    "--outDir",
    developmentRun.outDir,
    "--entry",
    developmentRun.appDir,
    ...electronArgs,
  ];
}

module.exports = {
  createDevelopmentRun,
  createElectronViteArguments,
};
