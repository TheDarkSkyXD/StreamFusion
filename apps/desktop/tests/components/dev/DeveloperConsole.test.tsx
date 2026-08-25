import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeveloperConsole } from "@/components/dev/DeveloperConsole";

vi.mock("@/components/dev/ChatSimTool", () => ({
  ChatSimTool: () => <div>Chat sim tool</div>,
}));

vi.mock("@/components/dev/UiDebugTool", () => ({
  UiDebugTool: () => <div>UI debug tool</div>,
}));

const STORAGE_KEY = "streamfusion-debug-panel";

// Guards: the development console retains its chat/UI tools and direct Diagnostics route while
// removing the duplicate performance tab.
describe("DeveloperConsole", () => {
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

    render(<DeveloperConsole />);

    expect(screen.getByRole("button", { name: "Show Developer Console" })).toBeInTheDocument();
    expect(screen.queryByText("Developer Console")).not.toBeInTheDocument();
  });

  it("restores the full developer console from the hidden chip", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hidden: true,
        collapsed: true,
        activeId: "perf",
        position: { x: 40, y: 50 },
      })
    );

    render(<DeveloperConsole />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Show Developer Console" }));
    fireEvent.mouseUp(document);

    expect(screen.getByText("Developer Console")).toBeInTheDocument();
    expect(await screen.findByText("Chat sim tool")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Perf" })).not.toBeInTheDocument();
  });

  it("opens the UI debug tab", () => {
    render(<DeveloperConsole />);

    fireEvent.click(screen.getByRole("tab", { name: "UI" }));

    expect(screen.getByText("UI debug tool")).toBeInTheDocument();
  });

  it("opens Diagnostics from the console header", () => {
    render(<DeveloperConsole />);

    fireEvent.click(screen.getByRole("button", { name: "Open Diagnostics" }));

    expect(window.location.hash).toBe("#/settings?tab=diagnostics");
  });
});
