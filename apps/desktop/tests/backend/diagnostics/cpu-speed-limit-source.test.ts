import { describe, expect, it } from "vitest";

import { parseWindowsCpuSpeedLimit } from "@backend/diagnostics/cpu-speed-limit-source";

const POWERCFG_OUTPUT = `
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  Power Setting GUID: bc5038f7-23e0-4960-96da-33abaf5935ec  (Maximum processor state)
    Minimum Possible Setting: 0x00000000
    Maximum Possible Setting: 0x00000064
    Possible Settings increment: 0x00000001
    Current AC Power Setting Index: 0x00000064
    Current DC Power Setting Index: 0x0000004b
`;

// Guards: Diagnostics shows the active Windows maximum processor state before Electron emits a speed-limit event.
describe("parseWindowsCpuSpeedLimit", () => {
  it("selects the active AC or battery value without mistaking bounds for current settings", () => {
    expect(parseWindowsCpuSpeedLimit(POWERCFG_OUTPUT, false)).toBe(100);
    expect(parseWindowsCpuSpeedLimit(POWERCFG_OUTPUT, true)).toBe(75);
  });

  it("rejects incomplete or out-of-range power plan output", () => {
    expect(
      parseWindowsCpuSpeedLimit("Current AC Power Setting Index: 0x00000064", true)
    ).toBeNull();
    expect(
      parseWindowsCpuSpeedLimit(
        "Current AC Power Setting Index: 0x00000065\nCurrent DC Power Setting Index: 0x00000064",
        false
      )
    ).toBeNull();
  });
});
