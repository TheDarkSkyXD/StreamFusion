import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UiDebugTool } from "@/components/dev/UiDebugTool";
import { setNetworkStatusOverrideForDebug } from "@/features/settings/data/useNetworkStatus";

vi.mock("@/features/settings/data/useNetworkStatus", () => ({
  setNetworkStatusOverrideForDebug: vi.fn(),
}));

// Guards: debug console can force and reset the app-level offline banner without changing the real network adapter.
describe("UiDebugTool", () => {
  it("simulates the offline banner from a debug button", () => {
    render(<UiDebugTool />);

    fireEvent.click(screen.getByRole("button", { name: "Show offline banner" }));

    expect(setNetworkStatusOverrideForDebug).toHaveBeenCalledWith(false);
  });

  it("resets the network simulation from a debug button", () => {
    render(<UiDebugTool />);

    fireEvent.click(screen.getByRole("button", { name: "Use real network state" }));

    expect(setNetworkStatusOverrideForDebug).toHaveBeenCalledWith(null);
  });
});
