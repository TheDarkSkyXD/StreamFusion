import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createVerificationLaunchPlan,
  runManagedVerificationSession,
  waitForChildExitOrSignal,
} from "./control-launch-plan.mjs";

const request = Object.freeze({
  port: 48123,
  profileDir: "C:\\runs\\preview\\profile",
});

test("the missing mode keeps the development launch plan", () => {
  const plan = createVerificationLaunchPlan(request, {
    platform: "linux",
    execPath: "/usr/bin/node",
    env: { ELECTRON_RUN_AS_NODE: "1", KEEP: "yes" },
  });

  assert.deepEqual(plan.launcher, {
    mode: "dev:electron",
    command: "npm start",
    selection: 1,
  });
  assert.equal(plan.command, "npm");
  assert.deepEqual(plan.args, [
    "start",
    "--",
    "--remote-debugging-port=48123",
    "--user-data-dir=C:\\runs\\preview\\profile",
  ]);
  assert.equal(plan.readinessTimeoutMs, 120_000);
  assert.deepEqual(plan.env, { KEEP: "yes" });
});

test("unknown and inherited mode names are rejected", () => {
  for (const mode of ["invalid", "toString"]) {
    assert.throws(
      () => createVerificationLaunchPlan({ ...request, mode }),
      /Unknown verification launch mode/,
    );
  }
});

test("preview launches npm run preview without skipBuild", () => {
  const plan = createVerificationLaunchPlan(
    { ...request, mode: "preview", electronArgs: ["--disable-gpu"] },
    {
      platform: "linux",
      execPath: "/usr/bin/node",
      env: {},
    },
  );

  assert.deepEqual(plan.launcher, {
    mode: "preview",
    command: "npm run preview",
  });
  assert.deepEqual(plan.args, [
    "run",
    "preview",
    "--",
    "--",
    "--remote-debugging-port=48123",
    "--user-data-dir=C:\\runs\\preview\\profile",
    "--disable-gpu",
  ]);
  assert.equal(plan.args.includes("--skipBuild"), false);
  assert.equal(plan.readinessTimeoutMs, 300_000);
});

test("Windows uses npm_execpath before the beside-Node fallback", () => {
  const withNpmExecpath = createVerificationLaunchPlan(
    { ...request, mode: "preview" },
    {
      platform: "win32",
      execPath: "C:\\node\\node.exe",
      env: { npm_execpath: "C:\\npm\\npm-cli.js" },
    },
  );
  const fallback = createVerificationLaunchPlan(
    { ...request, mode: "preview" },
    { platform: "win32", execPath: "C:\\node\\node.exe", env: {} },
  );

  assert.equal(withNpmExecpath.command, "C:\\node\\node.exe");
  assert.equal(withNpmExecpath.args[0], "C:\\npm\\npm-cli.js");
  assert.equal(fallback.command, "C:\\node\\node.exe");
  assert.equal(
    fallback.args[0],
    "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
  );
});

test("the controller reserves CDP and profile switches", () => {
  for (const electronArgs of [
    ["--user-data-dir", "C:\\other"],
    ["--user-data-dir=C:\\other"],
    ["--remote-debugging-port", "9222"],
    ["--remote-debugging-port=9222"],
  ]) {
    assert.throws(
      () => createVerificationLaunchPlan({ ...request, electronArgs }),
      /reserved by the verification controller/,
    );
  }
});

test("managed sessions clean once after success and failure", async () => {
  for (const outcome of [
    { result: { code: 0, signal: null } },
    { error: new Error("launcher wait failed") },
  ]) {
    const state = { id: "test-run" };
    let cleanupCount = 0;
    const child = new EventEmitter();
    const session = runManagedVerificationSession(
      {},
      {
        launch: async () => ({ state, child }),
        cleanup: async (received) => {
          cleanupCount += 1;
          assert.equal(received, state);
        },
        waitForExit: async () => {
          if (outcome.error) throw outcome.error;
          return outcome.result;
        },
      },
    );

    if (outcome.error) await assert.rejects(session, /launcher wait failed/);
    else assert.deepEqual(await session, outcome.result);
    assert.equal(cleanupCount, 1);
  }
});

test("SIGINT completes the managed wait and cleanup runs once", async () => {
  const child = new EventEmitter();
  const signals = new EventEmitter();
  const state = { id: "signal-run" };
  let cleanupCount = 0;
  const session = runManagedVerificationSession(
    {},
    {
      launch: async () => ({ state, child }),
      cleanup: async () => {
        cleanupCount += 1;
      },
      waitForExit: (launchedChild) =>
        waitForChildExitOrSignal(launchedChild, signals),
    },
  );

  queueMicrotask(() => signals.emit("SIGINT"));
  assert.deepEqual(await session, { code: 130, signal: "SIGINT" });
  assert.equal(cleanupCount, 1);
});
