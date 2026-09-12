import { describe, expect, it } from "vitest";

import { resolveHardwareBack } from "../domain/hardware-back";

// Guards: Android Back cancels an Activity overlay before it pops a route
// Guards: destination-root Back leaves the task instead of popping an empty stack
describe("hardware back", () => {
  it("cancels an Activity confirmation before popping a route", () => {
    expect(
      resolveHardwareBack({ canNavigateBack: true, hasOverlay: true }),
    ).toBe("cancel-dismissal");
    expect(
      resolveHardwareBack({ canNavigateBack: false, hasOverlay: true }),
    ).toBe("cancel-dismissal");
  });

  it("pops the active destination when no overlay is open", () => {
    expect(
      resolveHardwareBack({ canNavigateBack: true, hasOverlay: false }),
    ).toBe("navigate-back");
  });

  it("leaves the task from a destination root", () => {
    expect(
      resolveHardwareBack({ canNavigateBack: false, hasOverlay: false }),
    ).toBe("leave-task");
  });
});
