import { describe, expect, it } from "vitest";

import { resolveDebuggingPolicy } from "@backend/runtime-mode";

// Guards: packaged builds never expose Chrome DevTools Protocol, even when a launch argument requests it.
// Guards: development launches expose CDP only when automation explicitly requests a port.
describe("resolveDebuggingPolicy", () => {
  it("disables debugging for every packaged launch", () => {
    expect(
      resolveDebuggingPolicy({
        isPackaged: true,
        argv: ["StreamFusion.exe", "--remote-debugging-port=9005"],
      })
    ).toEqual({ kind: "disabled" });
  });

  it("preserves an explicit development port", () => {
    expect(
      resolveDebuggingPolicy({
        isPackaged: false,
        argv: ["electron", ".", "--remote-debugging-port=9222"],
      })
    ).toEqual({ kind: "cdp", source: "cli", port: 9222 });
  });

  it("keeps debugging disabled when a development port is not explicitly supplied", () => {
    expect(
      resolveDebuggingPolicy({
        isPackaged: false,
        argv: ["electron", "."],
      })
    ).toEqual({ kind: "disabled" });
  });
});
