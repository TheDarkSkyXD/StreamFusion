import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useAdElementObserver } from "@/features/playback/data/use-ad-element-observer";

let observeSpy: ReturnType<typeof vi.fn>;
let disconnectSpy: ReturnType<typeof vi.fn>;
let mockCallback: MutationCallback;

beforeEach(() => {
  observeSpy = vi.fn();
  disconnectSpy = vi.fn();

  // @ts-expect-error -- simplified MutationObserver mock
  globalThis.MutationObserver = class {
    constructor(cb: MutationCallback) {
      mockCallback = cb;
    }
    observe = observeSpy;
    disconnect = disconnectSpy;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAdElementObserver", () => {
  it("starts observing when enabled", () => {
    renderHook(() => useAdElementObserver(true));
    expect(observeSpy).toHaveBeenCalledWith(document.body, {
      childList: true,
      subtree: true,
    });
  });

  it("does not observe when disabled", () => {
    renderHook(() => useAdElementObserver(false));
    expect(observeSpy).not.toHaveBeenCalled();
  });

  it("disconnects on unmount", () => {
    const { unmount } = renderHook(() => useAdElementObserver(true));
    unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("hides existing ad elements on mount", () => {
    const adEl = document.createElement("div");
    adEl.setAttribute("data-test-selector", "ad-banner-default-text");
    document.body.appendChild(adEl);

    renderHook(() => useAdElementObserver(true));
    expect(adEl.style.display).toBe("none");
    expect(adEl.style.visibility).toBe("hidden");

    document.body.removeChild(adEl);
  });

  it("hides dynamically added ad elements via MutationObserver", () => {
    renderHook(() => useAdElementObserver(true));

    const adEl = document.createElement("div");
    adEl.classList.add("player-ad-overlay");
    document.body.appendChild(adEl);

    mockCallback(
      [{
        addedNodes: document.body.childNodes,
        removedNodes: document.createDocumentFragment().childNodes,
        type: "childList", attributeName: null, attributeNamespace: null,
        nextSibling: null, previousSibling: null, oldValue: null, target: document.body,
      } satisfies MutationRecord],
      {} as MutationObserver
    );

    expect(adEl.style.display).toBe("none");
    document.body.removeChild(adEl);
  });

  it("disconnects when toggling from enabled to disabled", () => {
    const { rerender } = renderHook(({ enabled }) => useAdElementObserver(enabled), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
