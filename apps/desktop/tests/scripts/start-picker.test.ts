import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  chooseStartMode,
  launchNpmScript,
  runStartPicker,
} from "../../scripts/start-picker-lib.js";

// Guards: pressing Enter at the interactive start prompt launches Electron only by default.
// Guards: piped and automation starts bypass the prompt and launch Electron only.
// Guards: the picker exposes two human-facing modes while dev:mcp remains a direct automation script.
// Guards: Windows launches npm through Node instead of spawning npm.cmd, which fails with EINVAL.
// Guards: Windows still locates npm when npm_execpath is absent from the inherited environment.
describe("start picker", () => {
  it("defaults to Electron-only when the interactive answer is empty", async () => {
    const ask = vi.fn().mockResolvedValue("");

    await expect(chooseStartMode({ interactive: true, ask })).resolves.toBe("dev:electron");
  });

  it("presents exactly two modes in order and maps them to their direct scripts", async () => {
    const expectedModes = [
      ["1", "dev:electron"],
      ["2", "dev"],
    ] as const;
    const expectedPrompt = [
      "",
      "How would you like to start StreamFusion?",
      "  1) Electron app only (default)",
      "  2) Electron app + browser",
      "",
      "Choose a start mode [1]: ",
    ].join("\n");

    for (const [answer, expectedMode] of expectedModes) {
      const ask = vi.fn().mockResolvedValue(answer);

      await expect(chooseStartMode({ interactive: true, ask })).resolves.toBe(expectedMode);
      expect(ask).toHaveBeenCalledWith(expectedPrompt);
    }
  });

  it("defaults invalid interactive answers to Electron-only", async () => {
    for (const answer of ["3", "garbage"]) {
      const ask = vi.fn().mockResolvedValue(answer);

      await expect(chooseStartMode({ interactive: true, ask })).resolves.toBe("dev:electron");
    }
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

  it("exposes direct automation scripts while routing root npm start through the picker", () => {
    const desktopPackage = JSON.parse(
      readFileSync(resolve(__dirname, "../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const rootPackage = JSON.parse(
      readFileSync(resolve(__dirname, "../../../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(rootPackage.scripts.start).toBe("npm start --prefix apps/desktop");
    expect(desktopPackage.scripts.start).toBe("node scripts/start-picker.js");
    expect(desktopPackage.scripts.dev).toBe(
      "cross-env STREAMFUSION_BROWSER_DEV=1 node scripts/start-dev.js"
    );
    expect(desktopPackage.scripts["dev:electron"]).toBe("node scripts/start-dev.js");
    expect(desktopPackage.scripts["dev:mcp"]).toBe(
      "node scripts/start-dev.js -- --remote-debugging-port=9222"
    );
  });

  it("launches the selected npm script with inherited terminal IO and returns its exit code", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const env = {
      TEST_ENV: "preserved",
      npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    };

    const exitCode = launchNpmScript("dev:mcp", {
      spawn,
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      cwd: "C:\\repo\\apps\\desktop",
      env,
    });

    expect(spawn).toHaveBeenCalledWith(
      "C:\\Program Files\\nodejs\\node.exe",
      ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "run", "dev:mcp"],
      {
        cwd: "C:\\repo\\apps\\desktop",
        env,
        stdio: "inherit",
      }
    );

    child.emit("exit", 7, null);
    await expect(exitCode).resolves.toBe(7);
  });

  it("falls back to the npm CLI beside Node on Windows when npm_execpath is absent", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);

    const exitCode = launchNpmScript("dev:electron", {
      spawn,
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      cwd: "C:\\repo\\apps\\desktop",
      env: { TEST_ENV: "preserved" },
    });

    expect(spawn).toHaveBeenCalledWith(
      "C:\\Program Files\\nodejs\\node.exe",
      ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "run", "dev:electron"],
      {
        cwd: "C:\\repo\\apps\\desktop",
        env: { TEST_ENV: "preserved" },
        stdio: "inherit",
      }
    );

    child.emit("exit", 0, null);
    await expect(exitCode).resolves.toBe(0);
  });
});
