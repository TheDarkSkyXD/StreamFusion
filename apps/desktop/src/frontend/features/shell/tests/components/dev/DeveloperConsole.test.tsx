import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPortal } from "react-dom";

import { DeveloperConsole } from "@/components/dev/DeveloperConsole";
import { createBrowserElectronApi } from "@/dev-relay/browser-electron-api";

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
// Guards: a delayed browser relay read cannot reset the console to its old position while it is being dragged.
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

  it("lets every popup header button handle a pointer click", () => {
    const toggleDevTools = vi.fn();
    const onCollapse = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { toggleDevTools },
    });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const childDocument = frame.contentDocument;
    if (!childDocument) throw new Error("Missing iframe document");
    const { unmount } = render(
      createPortal(
        <DeveloperConsole targetDocument={childDocument} onCollapse={onCollapse} />,
        childDocument.body
      )
    );

    try {
      const popup = within(childDocument.body);
      const collapse = popup.getByRole("button", { name: "Collapse" });
      const header = collapse.parentElement?.parentElement;
      if (!header) throw new Error("Missing console header");
      const setPointerCapture = vi.fn();
      Object.defineProperty(header, "setPointerCapture", {
        configurable: true,
        value: setPointerCapture,
      });
      fireEvent.pointerDown(popup.getByText("Developer Console"), { pointerId: 2 });
      expect(setPointerCapture).toHaveBeenCalledWith(2);
      setPointerCapture.mockClear();

      for (const name of ["Open Diagnostics", "Open mod page", "Toggle DevTools", "Collapse"]) {
        const button = popup.getByRole("button", { name });
        fireEvent.pointerDown(button, { pointerId: 1 });
        expect(setPointerCapture).not.toHaveBeenCalled();
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.pointerUp(button, { pointerId: 1 });
        fireEvent.mouseUp(button);
        fireEvent.click(button);
        if (name === "Open Diagnostics") {
          expect(window.location.hash).toBe("#/settings?tab=diagnostics");
        } else if (name === "Open mod page") {
          expect(window.location.hash).toBe("#/mod");
        }
      }

      expect(toggleDevTools).toHaveBeenCalledTimes(1);
      expect(onCollapse).toHaveBeenCalledTimes(1);
      expect(readStoredLayout()).toMatchObject({ visibility: "collapsed" });
    } finally {
      unmount();
      frame.remove();
    }
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

  it("drags in the popup document while keeping the owner's stored layout", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activeId: "chat-sim", position: { x: 40, y: 50 }, visibility: "collapsed" })
    );
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const childDocument = frame.contentDocument;
    if (!childDocument) throw new Error("Missing iframe document");
    const { unmount } = render(
      createPortal(<DeveloperConsole targetDocument={childDocument} />, childDocument.body)
    );
    const button = childDocument.querySelector("button");
    if (!button) throw new Error("Missing console button");
    fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(childDocument, { clientX: 35, clientY: 45 });
    expect(readStoredLayout()).toMatchObject({ position: { x: 65, y: 85 } });
    unmount();
    frame.remove();
  });

  it("waits for a positive popup shape before moving the console", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activeId: "chat-sim", position: { x: 40, y: 50 }, visibility: "collapsed" })
    );
    let allowMove: ((allowed: boolean) => void) | undefined;
    const onPrepareMove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          allowMove = resolve;
        })
    );
    render(<DeveloperConsole onPrepareMove={onPrepareMove} />);
    const button = screen.getByTitle(/^Click to expand/);
    fireEvent.mouseDown(button, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 35, clientY: 45 });
    expect(onPrepareMove).toHaveBeenCalledWith({ x: 65, y: 85, width: 48, height: 48 });
    expect(readStoredLayout()).toMatchObject({ position: { x: 40, y: 50 } });
    await act(async () => allowMove?.(true));
    expect(readStoredLayout()).toMatchObject({ position: { x: 65, y: 85 } });
  });

  it("keeps the dragged position when an older browser relay read completes", async () => {
    const durableState = {
      activeId: "chat-sim",
      position: { x: 40, y: 50 },
      visibility: "collapsed",
    };
    const pendingReads: Array<(value: unknown) => void> = [];
    let readCount = 0;
    const api = createBrowserElectronApi({
      call: (path) => {
        if (path.join(".") !== "store.get") return Promise.resolve(undefined);
        readCount += 1;
        if (readCount === 1) return Promise.resolve(durableState);
        return new Promise((resolve) => pendingReads.push(resolve));
      },
      subscribe: () => () => undefined,
    });
    Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

    render(<DeveloperConsole />);
    const minimizedConsole = await screen.findByTitle(/^Click to expand/);
    expect(minimizedConsole).toHaveStyle({ left: "40px", top: "50px" });

    fireEvent.mouseDown(minimizedConsole, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 35, clientY: 45 });
    expect(minimizedConsole).toHaveStyle({ left: "65px", top: "85px" });

    await act(async () => {
      pendingReads.at(-1)?.(durableState);
    });

    expect(minimizedConsole).toHaveStyle({ left: "65px", top: "85px" });
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
