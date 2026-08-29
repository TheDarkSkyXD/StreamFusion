import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Guards: the development console retains its chat/UI tools and direct Diagnostics route without the removed performance tab.
// Guards: the development console must reopen in its minimized state at the last dragged position.
// Guards: durable console layout survives a renderer-origin change without flashing at the default position.
// Guards: dragging updates the local cache continuously but writes only the final minimized position durably on mouseup.
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

  it("restores minimized layout from the durable store after the renderer origin changes", async () => {
    const durableValues = new Map<string, unknown>();
    durableValues.set(STORAGE_KEY, {
      activeId: "chat-sim",
      position: { x: 40, y: 50 },
      visibility: "expanded",
    });
    const store = {
      delete: vi.fn(async (key: string) => {
        durableValues.delete(key);
      }),
      get: vi.fn(async (key: string) => durableValues.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        durableValues.set(key, value);
      }),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { store, toggleDevTools: vi.fn() },
    });

    const { unmount } = render(<DeveloperConsole />);
    expect(screen.queryByText("Developer Console")).not.toBeInTheDocument();
    await screen.findByText("Developer Console");

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(store.set).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.objectContaining({ position: { x: 40, y: 50 }, visibility: "collapsed" })
    );
    store.set.mockClear();

    const minimizedConsole = screen.getByTitle(/^Click to expand/);
    fireEvent.mouseDown(minimizedConsole, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 35, clientY: 45 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 60 });

    expect(readStoredLayout()).toMatchObject({
      position: { x: 80, y: 100 },
      visibility: "collapsed",
    });
    expect(store.set).not.toHaveBeenCalled();

    fireEvent.mouseUp(document);

    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith(STORAGE_KEY, {
      activeId: "chat-sim",
      position: { x: 80, y: 100 },
      visibility: "collapsed",
    });
    await waitFor(() =>
      expect(durableValues.get(STORAGE_KEY)).toMatchObject({
        position: { x: 80, y: 100 },
        visibility: "collapsed",
      })
    );

    unmount();
    localStorage.clear();
    render(<DeveloperConsole />);

    expect(screen.queryByText("Developer Console")).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Click to expand/)).not.toBeInTheDocument();
    expect(await screen.findByTitle(/^Click to expand/)).toHaveStyle({
      left: "80px",
      top: "100px",
    });
  });
});
