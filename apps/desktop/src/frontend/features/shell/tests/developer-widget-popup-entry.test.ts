import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/query-devtools", () => ({
  TanstackQueryDevtools: class {
    constructor(private config: { client: QueryClient; onlineManager: typeof onlineManager }) {}
    mount(root: HTMLElement) {
      const launcher = document.createElement("div");
      launcher.className = "tsqd-open-btn-container";
      const open = document.createElement("button");
      open.className = "tsqd-open-btn";
      open.setAttribute("aria-label", "Open Tanstack query devtools");
      open.onclick = () => {
        root.dataset.queryOpen = "true";
      };
      launcher.append(open);
      root.append(launcher);
      const action = document.createElement("button");
      action.textContent = "Clear owner cache and go offline";
      action.onclick = () => {
        this.config.client.clear();
        this.config.onlineManager.setOnline(false);
      };
      root.append(action);
    }
    unmount() {}
  },
}));

vi.mock("@/global.css", () => ({}));
vi.mock("../components/dev/developer-widget-popup.css", () => ({}));

import { queryClient } from "@/providers/query-provider";

describe("popup query handoff", () => {
  beforeEach(async () => {
    vi.resetModules();
    await import("../components/dev/developer-widget-popup-entry");
  });

  afterEach(() => {
    window.streamfusionDeveloperWidgets?.dispose();
    queryClient.clear();
    onlineManager.setOnline(true);
  });

  it("lets the popup action change the app's original cache and online manager", () => {
    queryClient.setQueryData(["owner"], "live");
    const bridge = window.streamfusionDeveloperWidgets;
    if (!bridge) throw new Error("Popup bridge missing");
    bridge.mountQueryDevtools(queryClient, onlineManager);
    const action = bridge.queryRoot.querySelector<HTMLButtonElement>("button:not(.tsqd-open-btn)");
    if (!action) throw new Error("Popup action missing");
    action.click();
    expect(queryClient.getQueryData(["owner"])).toBeUndefined();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("opens on a pointer click of the launcher button", () => {
    const bridge = window.streamfusionDeveloperWidgets;
    if (!bridge) throw new Error("Popup bridge missing");
    bridge.mountQueryDevtools(queryClient, onlineManager);
    const button = bridge.queryRoot.querySelector<HTMLButtonElement>(".tsqd-open-btn");
    const container = button?.parentElement;
    if (!button || !container) throw new Error("Popup launcher missing");

    let captured: HTMLElement | null = null;
    container.setPointerCapture = (pointerId) => {
      expect(pointerId).toBe(1);
      captured = container;
    };
    button.setPointerCapture = (pointerId) => {
      expect(pointerId).toBe(1);
      captured = button;
    };
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, button: 0 });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    button.dispatchEvent(pointerDown);
    const pointerUp = new MouseEvent("pointerup", { bubbles: true, button: 0 });
    Object.defineProperty(pointerUp, "pointerId", { value: 1 });
    (captured ?? button).dispatchEvent(pointerUp);
    (captured ?? button).click();

    expect(bridge.queryRoot.dataset.queryOpen).toBe("true");
  });

  it("moves the launcher after preflight and does not open it on the drag click", async () => {
    const bridge = window.streamfusionDeveloperWidgets;
    if (!bridge) throw new Error("Popup bridge missing");
    bridge.mountQueryDevtools(queryClient, onlineManager);
    const button = bridge.queryRoot.querySelector<HTMLButtonElement>(".tsqd-open-btn");
    const container = button?.parentElement;
    if (!button || !container) throw new Error("Popup launcher missing");

    let captured: HTMLElement | null = null;
    container.setPointerCapture = () => {
      captured = container;
    };
    button.setPointerCapture = () => {
      captured = button;
    };
    let allowMove = (_allowed: boolean): void => {};
    bridge.prepareRect = () =>
      new Promise<boolean>((resolve) => {
        allowMove = resolve;
      });
    Object.defineProperty(bridge.queryRoot, "getBoundingClientRect", {
      value: () => ({ left: 20, top: 30 }),
    });
    const dispatchPointer = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
      Object.defineProperty(event, "pointerId", { value: 1 });
      (captured ?? button).dispatchEvent(event);
    };
    dispatchPointer("pointerdown", 20, 30);
    dispatchPointer("pointermove", 40, 50);
    expect(bridge.queryRoot.style.left).toBe("");
    allowMove(true);
    await vi.waitFor(() => expect(bridge.queryRoot.style.left).toBe("40px"));
    dispatchPointer("pointerup", 40, 50);
    (captured ?? button).click();

    expect(bridge.queryRoot.dataset.queryOpen).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    button.click();
    expect(bridge.queryRoot.dataset.queryOpen).toBe("true");
  });
});

describe("real TanStack launcher", () => {
  afterEach(() => {
    window.streamfusionDeveloperWidgets?.dispose();
  });

  it("opens the panel from a click on its own button", async () => {
    vi.doUnmock("@tanstack/query-devtools");
    vi.resetModules();
    await import("../components/dev/developer-widget-popup-entry");
    const bridge = window.streamfusionDeveloperWidgets;
    if (!bridge) throw new Error("Popup bridge missing");
    bridge.mountQueryDevtools(queryClient, onlineManager);
    const button = await vi.waitFor(() => {
      const found = bridge.queryRoot.querySelector<HTMLButtonElement>(".tsqd-open-btn");
      if (!found) throw new Error("TanStack launcher missing");
      return found;
    });

    button.click();

    await vi.waitFor(() => {
      expect(bridge.queryRoot.querySelector(".tsqd-main-panel")).not.toBeNull();
    });
  });
});
