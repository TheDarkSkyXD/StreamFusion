import { readFileSync } from "node:fs";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, renderWithProviders, screen, userEvent, waitFor } from "../../../../test-utils";

import { ModWorkspace, type ModWidget } from "@/pages/Mod/channel/workspace/ModWorkspace";

const workspaceStyles = readFileSync(
  "src/frontend/pages/Mod/channel/workspace/mod-workspace.css",
  "utf8"
);

// Guards: pointer and keyboard moves preserve mounted live panels while changing only valid geometry.
// Guards: Mod Actions stays horizontally paired with the platform's pinned lower widget.
// Guards: pinned widgets, cancellation, locking, reset, and persistence preserve a valid workspace.
describe("ModWorkspace", () => {
  const storageKey = "mod-workspace-test";
  const mounts = vi.fn();
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  let captureDescriptor: PropertyDescriptor | undefined;
  let releaseDescriptor: PropertyDescriptor | undefined;

  function StablePanel({ id }: { id: string }) {
    useEffect(() => {
      mounts(id);
    }, [id]);
    return <output data-testid={`${id}-content`}>{id}</output>;
  }

  function widgets(platform: "twitch" | "kick"): ModWidget[] {
    const anchor = platform === "twitch" ? "automod" : "retention";
    const anchorTitle = platform === "twitch" ? "AutoMod Queue" : "Retention";
    return [
      { id: "video", title: "Video", icon: <span>V</span>, content: <StablePanel id="video" /> },
      { id: "chat", title: "Chat", icon: <span>C</span>, content: <StablePanel id="chat" /> },
      {
        id: "mod-log",
        title: "Mod Actions",
        icon: <span>L</span>,
        content: <StablePanel id="mod-log" />,
      },
      {
        id: anchor,
        title: anchorTitle,
        icon: <span>P</span>,
        content: <StablePanel id={anchor} />,
      },
    ];
  }

  function renderWorkspace(platform: "twitch" | "kick" = "twitch") {
    return renderWithProviders(
      <ModWorkspace platform={platform} storageKey={storageKey} widgets={widgets(platform)} />
    );
  }

  function getCanvas(): HTMLDivElement {
    const canvas = document.querySelector(".mod-workspace-canvas");
    if (!(canvas instanceof HTMLDivElement)) throw new Error("Workspace canvas was not rendered");
    return canvas;
  }

  function getWidget(title: string): HTMLElement {
    return screen.getByLabelText(title, { selector: "section" });
  }

  function preparePointerDrag(sourceTitle: string) {
    const canvas = getCanvas();
    const source = getWidget(sourceTitle);
    const handle = source.querySelector('[data-drag-handle="true"]');
    if (!(handle instanceof HTMLDivElement)) throw new Error(`${sourceTitle} is not draggable`);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
    return { canvas, source, handle };
  }

  function numericStyle(element: HTMLElement, property: "left" | "top" | "width" | "height") {
    return Number.parseFloat(element.style[property]);
  }

  beforeEach(() => {
    localStorage.clear();
    mounts.mockClear();
    setPointerCapture.mockClear();
    releasePointerCapture.mockClear();
    class FixedResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FixedResizeObserver);
    class MockPointerEvent extends MouseEvent {
      pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", MockPointerEvent);
    captureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "setPointerCapture");
    releaseDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "releasePointerCapture"
    );
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: releasePointerCapture,
    });
  });

  afterEach(() => {
    if (captureDescriptor)
      Object.defineProperty(HTMLElement.prototype, "setPointerCapture", captureDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
    if (releaseDescriptor)
      Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", releaseDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture");
    vi.unstubAllGlobals();
  });

  it.each([
    ["twitch", "AutoMod Queue"],
    ["kick", "Retention"],
  ] as const)(
    "renders the %s lower pair pinned with full-height chat at the right",
    async (platform, anchorTitle) => {
      renderWorkspace(platform);
      await screen.findAllByRole("separator");
      const video = getWidget("Video");
      const chat = getWidget("Chat");
      const modActions = getWidget("Mod Actions");
      const anchor = getWidget(anchorTitle);

      expect(numericStyle(chat, "left")).toBeGreaterThan(numericStyle(video, "left"));
      expect(numericStyle(chat, "top")).toBe(0);
      expect(numericStyle(chat, "height")).toBe(800);
      expect(numericStyle(modActions, "top")).toBe(numericStyle(anchor, "top"));
      expect(numericStyle(modActions, "height")).toBe(numericStyle(anchor, "height"));
      expect(anchor.querySelector('[data-drag-handle="true"]')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(`${anchorTitle} panel options`)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(`Hide ${anchorTitle}`)).not.toBeInTheDocument();
    }
  );

  it("captures on the canvas, shows a green Kick edge preview, and preserves live nodes", async () => {
    renderWorkspace("kick");
    await screen.findAllByRole("separator");
    const videoContent = screen.getByTestId("video-content");
    const chatContent = screen.getByTestId("chat-content");
    const video = getWidget("Video");
    const { canvas, source: chat, handle } = preparePointerDrag("Chat");

    fireEvent.pointerDown(handle, { button: 0, clientX: 1050, clientY: 400, pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(setPointerCapture.mock.contexts[0]).toBe(canvas);
    fireEvent.pointerMove(canvas, { clientX: 3, clientY: 400, pointerId: 7 });

    await waitFor(() =>
      expect(canvas.querySelector(".mod-workspace-drop-preview")).toBeInTheDocument()
    );
    expect(chat).toHaveStyle({ opacity: "0", pointerEvents: "none" });
    expect(screen.getByTestId("mod-workspace")).toHaveAttribute("data-platform", "kick");
    expect(workspaceStyles).toContain('.mod-workspace[data-platform="kick"]');
    expect(workspaceStyles).toContain("--mod-accent-soft: #53fc1833");
    fireEvent.pointerUp(canvas, { clientX: 3, clientY: 400, pointerId: 7 });

    await waitFor(() => expect(numericStyle(chat, "left")).toBe(0));
    expect(numericStyle(video, "left")).toBeGreaterThan(0);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture.mock.contexts[0]).toBe(canvas);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}").root).toMatchObject({
      kind: "split",
      axis: "row",
      first: { kind: "leaf", id: "chat" },
    });
    expect(screen.getByTestId("video-content")).toBe(videoContent);
    expect(screen.getByTestId("chat-content")).toBe(chatContent);
    expect(mounts.mock.calls.filter(([id]) => id === "video")).toHaveLength(1);
    expect(mounts.mock.calls.filter(([id]) => id === "chat")).toHaveLength(1);
  });

  it("rejects a top drop for Mod Actions without changing content, geometry, or persistence", async () => {
    renderWorkspace("kick");
    await screen.findAllByRole("separator");
    const content = screen.getByTestId("mod-log-content");
    const { canvas, source, handle } = preparePointerDrag("Mod Actions");
    const initialStyle = source.getAttribute("style");

    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 650, pointerId: 8 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 530, pointerId: 8 });
    await waitFor(() => expect(source).toHaveStyle({ opacity: "0" }));
    expect(canvas.querySelector(".mod-workspace-drop-preview")).not.toBeInTheDocument();
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 530, pointerId: 8 });

    await waitFor(() => expect(source.getAttribute("style")).toBe(initialStyle));
    expect(screen.getByTestId("mod-log-content")).toBe(content);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("cancels a valid pointer drag with Escape without persisting", async () => {
    renderWorkspace();
    await screen.findAllByRole("separator");
    const { canvas, source, handle } = preparePointerDrag("Chat");
    const initialStyle = source.getAttribute("style");

    fireEvent.pointerDown(handle, { button: 0, clientX: 1050, clientY: 400, pointerId: 9 });
    fireEvent.pointerMove(canvas, { clientX: 3, clientY: 400, pointerId: 9 });
    await waitFor(() =>
      expect(canvas.querySelector(".mod-workspace-drop-preview")).toBeInTheDocument()
    );
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(canvas.querySelector(".mod-workspace-drop-preview")).not.toBeInTheDocument()
    );
    expect(source.getAttribute("style")).toBe(initialStyle);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it.each([
    ["twitch", "AutoMod Queue"],
    ["kick", "Retention"],
  ] as const)(
    "restores hidden %s Mod Actions immediately left of its pinned partner",
    async (platform, anchorTitle) => {
      renderWorkspace(platform);
      await screen.findAllByRole("separator");
      fireEvent.click(screen.getByLabelText("Hide Mod Actions"));
      expect(screen.queryByTestId("mod-log-content")).not.toBeInTheDocument();
      expect(localStorage.getItem(storageKey)).not.toContain("mod-log");

      fireEvent.click(screen.getByRole("button", { name: "Mod Actions" }));
      const modActions = await screen.findByLabelText("Mod Actions", { selector: "section" });
      const anchor = getWidget(anchorTitle);
      await waitFor(() =>
        expect(numericStyle(modActions, "top")).toBe(numericStyle(anchor, "top"))
      );
      expect(numericStyle(modActions, "left")).toBeLessThan(numericStyle(anchor, "left"));
      expect(numericStyle(modActions, "height")).toBe(numericStyle(anchor, "height"));
      expect(numericStyle(modActions, "left") + numericStyle(modActions, "width") + 8).toBeCloseTo(
        numericStyle(anchor, "left")
      );
      expect(localStorage.getItem(storageKey)).toContain("mod-log");
    }
  );

  it("moves a panel from its options menu using only the keyboard", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findAllByRole("separator");
    const trigger = screen.getByRole("button", { name: "Video panel options" });
    trigger.focus();

    await user.keyboard("{Enter}");
    const workspaceEdge = await screen.findByRole("menuitem", { name: "Workspace edge" });
    workspaceEdge.focus();
    await user.keyboard("{ArrowRight}");
    const right = await screen.findByRole("menuitem", { name: "Right" });
    right.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}").root).toMatchObject({
        kind: "split",
        axis: "row",
        second: { kind: "leaf", id: "video" },
      })
    );
  });

  it("persists locking and reset restores the platform default", async () => {
    renderWorkspace();
    await screen.findAllByRole("separator");
    fireEvent.click(screen.getByRole("button", { name: "Lock layout" }));
    expect(screen.queryByLabelText("Hide Mod Actions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset layout" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toMatchObject({ locked: true });

    fireEvent.click(screen.getByRole("button", { name: "Unlock layout" }));
    fireEvent.click(screen.getByLabelText("Hide Mod Actions"));
    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    const modActions = await screen.findByLabelText("Mod Actions", { selector: "section" });
    const anchor = getWidget("AutoMod Queue");
    await waitFor(() => expect(numericStyle(modActions, "top")).toBe(numericStyle(anchor, "top")));
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toMatchObject({
      version: 1,
      locked: false,
    });
  });

  it("loads a valid pinned layout and persists keyboard splitter resizing", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        locked: false,
        root: {
          kind: "split",
          axis: "row",
          ratio: 0.2,
          first: {
            kind: "split",
            axis: "column",
            ratio: 0.65,
            first: { kind: "leaf", id: "video" },
            second: {
              kind: "split",
              axis: "row",
              ratio: 0.5,
              first: { kind: "leaf", id: "mod-log" },
              second: { kind: "leaf", id: "automod" },
            },
          },
          second: { kind: "leaf", id: "chat" },
        },
      })
    );
    renderWorkspace();
    const splitters = await screen.findAllByRole("separator", { name: "Resize panels" });
    const rootSplitter = splitters.find(
      (splitter) =>
        splitter.getAttribute("aria-orientation") === "vertical" &&
        splitter.getAttribute("aria-valuenow") === "20"
    );
    if (!rootSplitter) throw new Error("Persisted root splitter was not rendered");

    fireEvent.keyDown(rootSplitter, { key: "End" });
    await waitFor(() => expect(rootSplitter).toHaveAttribute("aria-valuenow", "80"));
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}").root.ratio).toBe(0.8);
  });
});
