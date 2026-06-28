import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DebugPanel } from "@/components/dev/DebugPanel";

vi.mock("@/components/dev/PerfTool", () => ({
  PerfTool: () => <div>Perf tool</div>,
}));

vi.mock("@/components/dev/ChatSimTool", () => ({
  ChatSimTool: () => <div>Chat sim tool</div>,
}));

vi.mock("@/components/dev/UiDebugTool", () => ({
  UiDebugTool: () => <div>UI debug tool</div>,
}));

const STORAGE_KEY = "streamfusion-debug-panel";

// Guards: the dev debug console must always leave a visible restore control when hidden,
// otherwise persisted localStorage can make the performance widget look missing after reload.
describe("DebugPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { toggleDevTools: vi.fn() },
    });
  });

  it("renders a restore button instead of disappearing when persisted hidden", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hidden: true,
        collapsed: false,
        activeId: "perf",
        position: { x: 40, y: 50 },
      })
    );

    render(<DebugPanel />);

    expect(screen.getByRole("button", { name: "Show Debug Console" })).toBeInTheDocument();
    expect(screen.queryByText("Debug Console")).not.toBeInTheDocument();
  });

  it("restores the full debug console from the hidden chip", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hidden: true,
        collapsed: true,
        activeId: "perf",
        position: { x: 40, y: 50 },
      })
    );

    render(<DebugPanel />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Show Debug Console" }));
    fireEvent.mouseUp(document);

    expect(screen.getByText("Debug Console")).toBeInTheDocument();
    expect(screen.getByText("Perf tool")).toBeInTheDocument();
  });

  it("opens the UI debug tab", () => {
    render(<DebugPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "UI" }));

    expect(screen.getByText("UI debug tool")).toBeInTheDocument();
  });
});
