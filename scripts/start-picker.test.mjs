import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  START_PROMPT,
  START_TARGETS,
  chooseStartTarget,
  launchRootScript,
  runStartPicker,
} from "./start-picker-lib.mjs";

test("the picker exposes Electron, Browser, Mobile, and E2E Preview", () => {
  assert.match(START_PROMPT, /1\) Electron/);
  assert.match(START_PROMPT, /2\) Browser/);
  assert.match(START_PROMPT, /3\) Mobile \(Expo Go\)/);
  assert.match(START_PROMPT, /4\) E2E Preview/);
  assert.deepEqual(
    START_TARGETS.map(({ name, script }) => ({ name, script })),
    [
      { name: "electron", script: "desktop" },
      { name: "browser", script: "browser" },
      { name: "mobile", script: "mobile" },
      { name: "e2e-preview", script: "e2e:preview" },
    ],
  );
});

test("non-interactive and invalid selections preserve Electron startup", async () => {
  assert.equal(
    (await chooseStartTarget({ interactive: false, ask: async () => "3" }))
      .script,
    "desktop",
  );
  assert.equal(
    (await chooseStartTarget({ interactive: true, ask: async () => "invalid" }))
      .script,
    "desktop",
  );
});

test("numeric and named selections resolve every start target", async () => {
  for (const [answer, script] of [
    ["1", "desktop"],
    ["browser", "browser"],
    ["3", "mobile"],
    ["4", "e2e:preview"],
    ["e2e-preview", "e2e:preview"],
  ]) {
    const target = await chooseStartTarget({
      interactive: true,
      ask: async () => answer,
    });
    assert.equal(target.script, script);
  }
});

test("the launcher forwards E2E Preview Electron arguments", async () => {
  const calls = [];
  const child = new EventEmitter();
  const result = launchRootScript(START_TARGETS[3], {
    cwd: "C:\\repo",
    env: { TEST: "1" },
    platform: "linux",
    forwardArgs: ["--disable-gpu"],
    spawn(command, args, options) {
      calls.push({ command, args, options });
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
  });

  assert.equal(await result, 0);
  assert.deepEqual(calls[0].args, [
    "run",
    "e2e:preview",
    "--",
    "--disable-gpu",
  ]);
});

test("the picker launches the selected root script", async () => {
  let launched;
  const code = await runStartPicker({
    interactive: true,
    ask: async () => "3",
    launch: async (target) => {
      launched = target;
      return 0;
    },
  });

  assert.equal(launched, START_TARGETS[2]);
  assert.equal(code, 0);
});

test("the launcher uses npm and forwards arguments", async () => {
  const calls = [];
  const child = new EventEmitter();
  const result = launchRootScript(START_TARGETS[2], {
    cwd: "C:\\repo",
    env: { TEST: "1", npm_execpath: "C:\\npm\\npm-cli.js" },
    platform: "win32",
    execPath: "C:\\node\\node.exe",
    forwardArgs: ["--device", "Pixel_2"],
    spawn(command, args, options) {
      calls.push({ command, args, options });
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
  });

  assert.equal(await result, 0);
  assert.deepEqual(calls, [
    {
      command: "C:\\node\\node.exe",
      args: [
        "C:\\npm\\npm-cli.js",
        "run",
        "mobile",
        "--",
        "--device",
        "Pixel_2",
      ],
      options: {
        cwd: "C:\\repo",
        env: { TEST: "1", npm_execpath: "C:\\npm\\npm-cli.js" },
        stdio: "inherit",
      },
    },
  ]);
});
