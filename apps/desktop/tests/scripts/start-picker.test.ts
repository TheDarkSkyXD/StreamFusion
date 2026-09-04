import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  chooseStartSelection,
  launchStartMode,
  runStartPicker,
} from "../../scripts/start-picker-lib.js";

// Guards: pressing Enter at the interactive start prompt launches Electron only by default.
// Guards: piped and automation starts bypass the prompt and launch Electron only.
// Guards: the picker exposes Electron, Browser, and Mobile in that order while dev:mcp remains a direct automation script.
// Guards: choosing Mobile reports that it is unavailable and exits without launching Electron.
// Guards: picker modes launch start-dev.js through Node, avoiding npm.cmd spawn EINVAL on Windows.
// Guards: browser mode adds its development flag without mutating the inherited environment.
// Guards: npm start forwards explicit Electron arguments after a separator so runtime proofs use their isolated profile.
// Guards: root npm start reaches the desktop picker through the unified workspace without a nested install.
describe("start picker", () => {
  it("defaults to Electron-only when the interactive answer is empty", async () => {
    const ask = vi.fn().mockResolvedValue("");

    await expect(chooseStartSelection({ interactive: true, ask })).resolves.toEqual({
      kind: "launch",
      mode: "dev:electron",
    });
  });

  it("presents exactly three options in order and maps each answer to its selection", async () => {
    const expectedSelections = [
      ["1", { kind: "launch", mode: "dev:electron" }],
      ["2", { kind: "launch", mode: "dev" }],
      ["3", { kind: "unavailable", name: "Mobile" }],
    ] as const;
    const expectedPrompt = [
      "",
      "How would you like to start StreamFusion?",
      "  1) Electron",
      "  2) Browser",
      "  3) Mobile",
      "",
      "Choose a start mode [1]: ",
    ].join("\n");

    for (const [answer, expectedSelection] of expectedSelections) {
      const ask = vi.fn().mockResolvedValue(answer);

      await expect(chooseStartSelection({ interactive: true, ask })).resolves.toEqual(
        expectedSelection
      );
      expect(ask).toHaveBeenCalledWith(expectedPrompt);
    }
  });

  it("defaults invalid interactive answers to Electron-only", async () => {
    for (const answer of ["4", "garbage"]) {
      const ask = vi.fn().mockResolvedValue(answer);

      await expect(chooseStartSelection({ interactive: true, ask })).resolves.toEqual({
        kind: "launch",
        mode: "dev:electron",
      });
    }
  });

  it("reports Mobile as unavailable without launching a start mode", async () => {
    const launch = vi.fn();
    const reportUnavailable = vi.fn();

    await expect(
      runStartPicker({
        interactive: true,
        ask: vi.fn().mockResolvedValue("3"),
        launch,
        reportUnavailable,
      })
    ).resolves.toBe(1);

    expect(reportUnavailable).toHaveBeenCalledWith(
      "StreamFusion Mobile is not implemented yet."
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("launches Electron-only without prompting when stdin is non-interactive", async () => {
    const ask = vi.fn();
    const launch = vi.fn().mockResolvedValue(0);

    await expect(
      runStartPicker({
        interactive: false,
        ask,
        launch,
      })
    ).resolves.toBe(0);

    expect(ask).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith("dev:electron");
  });

  it("keeps automation scripts direct while desktop package start runs quality checks", () => {
    const desktopPackage = JSON.parse(
      readFileSync(resolve(__dirname, "../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(desktopPackage.scripts.start).toBe("npm run start:checked --");
    expect(desktopPackage.scripts.dev).toBe(
      "cross-env STREAMFUSION_BROWSER_DEV=1 node scripts/start-dev.js"
    );
    expect(desktopPackage.scripts["dev:electron"]).toBe("node scripts/start-dev.js");
    expect(desktopPackage.scripts["dev:mcp"]).toBe(
      "node scripts/start-dev.js -- --remote-debugging-port=9222"
    );
  });

  it("launches Electron mode through Node with inherited terminal IO and returns its exit code", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const env = { TEST_ENV: "preserved" };
    const startDevPath = resolve(__dirname, "../../scripts/start-dev.js");

    const exitCode = launchStartMode("dev:electron", {
      spawn,
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      cwd: "C:\\repo\\apps\\desktop",
      env,
    });

    expect(spawn).toHaveBeenCalledWith("C:\\Program Files\\nodejs\\node.exe", [startDevPath], {
      cwd: "C:\\repo\\apps\\desktop",
      env: { TEST_ENV: "preserved" },
      stdio: "inherit",
    });

    child.emit("exit", 7, null);
    await expect(exitCode).resolves.toBe(7);
  });

  it("forwards explicit Electron arguments through start-dev after a separator", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const startDevPath = resolve(__dirname, "../../scripts/start-dev.js");

    const exitCode = launchStartMode("dev:electron", {
      spawn,
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      cwd: "C:\\repo\\apps\\desktop",
      env: { TEST_ENV: "preserved" },
      electronArgs: ["--user-data-dir=C:\\proof-profile"],
    });

    expect(spawn).toHaveBeenCalledWith(
      "C:\\Program Files\\nodejs\\node.exe",
      [startDevPath, "--", "--user-data-dir=C:\\proof-profile"],
      expect.objectContaining({ cwd: "C:\\repo\\apps\\desktop", stdio: "inherit" })
    );

    child.emit("exit", 0, null);
    await expect(exitCode).resolves.toBe(0);
  });

  it("adds browser mode to the child environment without spawning a package manager", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const env = { TEST_ENV: "preserved", npm_execpath: "C:\\npm-cli.js" };
    const startDevPath = resolve(__dirname, "../../scripts/start-dev.js");

    const exitCode = launchStartMode("dev", {
      spawn,
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      cwd: "C:\\repo\\apps\\desktop",
      env,
    });

    expect(spawn).toHaveBeenCalledWith("C:\\Program Files\\nodejs\\node.exe", [startDevPath], {
      cwd: "C:\\repo\\apps\\desktop",
      env: {
        TEST_ENV: "preserved",
        npm_execpath: "C:\\npm-cli.js",
        STREAMFUSION_BROWSER_DEV: "1",
      },
      stdio: "inherit",
    });
    expect(env).toEqual({ TEST_ENV: "preserved", npm_execpath: "C:\\npm-cli.js" });

    child.emit("exit", 0, null);
    await expect(exitCode).resolves.toBe(0);
  });
});
