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

function readStoredLayout(): unknown {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
}

// Guards: the development console retains its chat/UI tools and direct Diagnostics route while
// removing the duplicate performance tab.
// Guards: the development console must reopen in its minimized state at the last dragged position.
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

  it("persists minimized state immediately when the console collapses", () => {
    const { unmount } = render(<DeveloperConsole />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));

    expect(readStoredLayout()).toMatchObject({ visibility: "collapsed" });

    unmount();
    render(<DeveloperConsole />);

    expect(screen.getByTitle(/^Click to expand/)).toHaveStyle({
      width: "48px",
      height: "48px",
    });
    expect(screen.queryByText("Developer Console")).not.toBeInTheDocument();
  });

  it("reopens minimized at the last dragged position", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "chat-sim",
        position: { x: 40, y: 50 },
        visibility: "collapsed",
      })
    );

    const { unmount } = render(<DeveloperConsole />);

    const minimizedConsole = screen.getByTitle(/^Click to expand/);
    expect(minimizedConsole).toHaveStyle({ left: "40px", top: "50px" });

    fireEvent.mouseDown(minimizedConsole, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 35, clientY: 45 });

    expect(readStoredLayout()).toMatchObject({
      position: { x: 65, y: 85 },
      visibility: "collapsed",
    });

    unmount();
    render(<DeveloperConsole />);

    expect(screen.getByTitle(/^Click to expand/)).toHaveStyle({ left: "65px", top: "85px" });
  });
});
