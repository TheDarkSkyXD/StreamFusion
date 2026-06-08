import { beforeEach, describe, expect, it, vi } from "vitest";

import { forwardWebContentsConsole } from "@/backend/logging/web-contents-log-forwarder";

// Mock the project logger so the test can assert level + tag without touching
// the real log file.
const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Guards: web-contents-log-forwarder accepts ANY WebContents instance — not
// only mainWindow.webContents. Slice 05 spawns per-slot WebContentsViews; each
// of those needs its own forwarded log channel. The contract that makes that
// possible is the parameterized `webContents` argument verified here.

function makeFakeWebContents() {
  let handler: ((details: unknown) => void) | null = null;
  return {
    on: vi.fn((event: string, cb: (details: unknown) => void) => {
      if (event === "console-message") handler = cb;
    }),
    /** Test helper: fire a fake console-message. */
    emitConsoleMessage(details: unknown): void {
      handler?.(details);
    },
  };
}

beforeEach(() => {
  mocks.loggerWarn.mockClear();
  mocks.loggerError.mockClear();
});

describe("forwardWebContentsConsole — works with arbitrary WebContents (slice 05 contract)", () => {
  it("subscribes a console-message handler on the provided WebContents", () => {
    const fakeWC = makeFakeWebContents();
    forwardWebContentsConsole(
      fakeWC as unknown as Electron.WebContents,
      { tag: "SlotView-0" }
    );
    expect(fakeWC.on).toHaveBeenCalledWith("console-message", expect.any(Function));
  });

  it("routes a warning message into logger.warn under the provided tag", () => {
    const fakeWC = makeFakeWebContents();
    forwardWebContentsConsole(
      fakeWC as unknown as Electron.WebContents,
      { tag: "SlotView-0" }
    );

    fakeWC.emitConsoleMessage({
      level: "warning",
      message: "HLS.js: fragment retry exhausted",
      sourceId: "https://x.test/player.js",
      lineNumber: 42,
    });

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "SlotView-0",
      "HLS.js: fragment retry exhausted",
      { source: "https://x.test/player.js", line: 42 }
    );
  });

  it("routes an error message into logger.error under the provided tag", () => {
    const fakeWC = makeFakeWebContents();
    forwardWebContentsConsole(
      fakeWC as unknown as Electron.WebContents,
      { tag: "SlotView-3" }
    );

    fakeWC.emitConsoleMessage({ level: "error", message: "decoder crashed" });

    expect(mocks.loggerError).toHaveBeenCalledWith("SlotView-3", "decoder crashed", undefined);
  });

  it("ignores info / debug / verbose levels (avoid third-party noise)", () => {
    const fakeWC = makeFakeWebContents();
    forwardWebContentsConsole(
      fakeWC as unknown as Electron.WebContents,
      { tag: "SlotView-0" }
    );

    fakeWC.emitConsoleMessage({ level: "info", message: "noise" });
    fakeWC.emitConsoleMessage({ level: "verbose", message: "more noise" });
    fakeWC.emitConsoleMessage({ level: 1, message: "numeric info (older Electron)" });

    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("handles the older numeric-level shape (3=error, 2=warn)", () => {
    const fakeWC = makeFakeWebContents();
    forwardWebContentsConsole(
      fakeWC as unknown as Electron.WebContents,
      { tag: "SlotView-0" }
    );

    fakeWC.emitConsoleMessage({ level: 2, message: "old-shape warn" });
    fakeWC.emitConsoleMessage({ level: 3, message: "old-shape error" });

    expect(mocks.loggerWarn).toHaveBeenCalledWith("SlotView-0", "old-shape warn", undefined);
    expect(mocks.loggerError).toHaveBeenCalledWith("SlotView-0", "old-shape error", undefined);
  });

  it("two different WebContents register independent handlers (slice 05 multi-WCV)", () => {
    const wcA = makeFakeWebContents();
    const wcB = makeFakeWebContents();
    forwardWebContentsConsole(wcA as unknown as Electron.WebContents, { tag: "SlotView-A" });
    forwardWebContentsConsole(wcB as unknown as Electron.WebContents, { tag: "SlotView-B" });

    wcA.emitConsoleMessage({ level: "warning", message: "from A" });
    wcB.emitConsoleMessage({ level: "error", message: "from B" });

    expect(mocks.loggerWarn).toHaveBeenCalledWith("SlotView-A", "from A", undefined);
    expect(mocks.loggerError).toHaveBeenCalledWith("SlotView-B", "from B", undefined);
  });
});
