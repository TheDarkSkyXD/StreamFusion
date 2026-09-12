import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createGateRunner } from "./android-gates/create-gate-runner.mjs";

function sourceCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("cannot resolve source commit");
  return result.stdout.trim();
}

function defaultRunId(gate) {
  return process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_RUN_ID}-${gate}`
    : `local-${gate}`;
}

function parseArguments(argv) {
  const request = { read: false };
  const fields = new Map([
    ["--gate", "gate"],
    ["--run-id", "runId"],
    ["--apk-path", "apkPath"],
    ["--apk-digest", "apkDigest"],
    ["--incoming", "incomingPath"],
    ["--now", "now"],
    ["--source-commit", "sourceCommit"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--read") {
      request.read = true;
      continue;
    }
    if (argument === "--help") return null;
    const field = fields.get(argument);
    const value = argv[index + 1];
    if (!field || !value) throw new Error(`unknown or incomplete argument: ${argument}`);
    request[field] = value;
    index += 1;
  }
  if (!request.gate) throw new Error("--gate is required");
  request.runId ??= defaultRunId(request.gate);
  request.sourceCommit ??= sourceCommit();
  if (request.incomingPath) request.incomingPath = path.resolve(request.incomingPath);
  if (request.apkPath) request.apkPath = path.resolve(request.apkPath);
  return request;
}

function usage() {
  return "Usage: npm run verify:android-gates -- --gate <change|main|candidate|public-release> --run-id <id> [--apk-path <path>] [--apk-digest sha256:<hex>] [--incoming <dir>] [--read] [--now <rfc3339>] [--source-commit <sha>]";
}

async function runCli() {
  const request = parseArguments(process.argv.slice(2));
  if (!request) {
    console.log(usage());
    return;
  }
  const runner = createGateRunner({ repositoryRoot: process.cwd() });
  const verdict = await runner.run({
    ...request,
    fragment: process.env.ANDROID_GATE_FRAGMENT === "1",
    slot: process.env.ANDROID_GATE_SLOT,
  });
  console.log(`${request.gate} gate ${verdict.pass ? "passed" : `failed: ${verdict.reason}`}`);
  if (!verdict.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { parseArguments };
