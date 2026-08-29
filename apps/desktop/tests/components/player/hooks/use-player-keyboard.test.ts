import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerKeyboard } from "@/features/playback/components/player/hooks/use-player-keyboard";

function fireKey(key: string, target?: HTMLElement) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  if (target) {
    Object.defineProperty(event, "target", { value: target, writable: false });
  }
  window.dispatchEvent(event);
  return event;
}

// Guards: finite-media players can bind platform-neutral backward and forward seek actions.
// Guards: seek shortcuts cannot fire while an interactive control owns the keyboard event.
// Guards: disabled players cannot respond to configured seek shortcuts.
// Guards: unconfigured seek directions remain available to live players and global navigation.
describe("usePlayerKeyboard", () => {
  const callbacks = {
    onTogglePlay: vi.fn(),
    onToggleMute: vi.fn(),
    onVolumeUp: vi.fn(),
    onVolumeDown: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onToggleTheater: vi.fn(),
    onSeekBackward: vi.fn(),
    onSeekForward: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles play on Space key", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey(" ");
    expect(callbacks.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("toggles play on K key", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("k");
    expect(callbacks.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("toggles mute on M key", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("m");
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("toggles fullscreen on F key", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("f");
    expect(callbacks.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("toggles theater mode on T key", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("t");
    expect(callbacks.onToggleTheater).toHaveBeenCalledTimes(1);
  });

  it("volume up on ArrowUp", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("ArrowUp");
    expect(callbacks.onVolumeUp).toHaveBeenCalledTimes(1);
  });

  it("volume down on ArrowDown", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("ArrowDown");
    expect(callbacks.onVolumeDown).toHaveBeenCalledTimes(1);
  });

  it("seeks backward on ArrowLeft when the player provides that action", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("ArrowLeft");
    expect(callbacks.onSeekBackward).toHaveBeenCalledTimes(1);
  });

  it("seeks forward on ArrowRight when the player provides that action", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("ArrowRight");
    expect(callbacks.onSeekForward).toHaveBeenCalledTimes(1);
  });

  it("leaves seek arrows with an interactive control", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    const button = document.createElement("button");

    const backwardEvent = fireKey("ArrowLeft", button);
    const forwardEvent = fireKey("ArrowRight", button);

    expect(callbacks.onSeekBackward).not.toHaveBeenCalled();
    expect(callbacks.onSeekForward).not.toHaveBeenCalled();
    expect(backwardEvent.defaultPrevented).toBe(false);
    expect(forwardEvent.defaultPrevented).toBe(false);
  });

  it("does not seek when keyboard shortcuts are disabled", () => {
    renderHook(() => usePlayerKeyboard({ ...callbacks, disabled: true }));

    const backwardEvent = fireKey("ArrowLeft");
    const forwardEvent = fireKey("ArrowRight");

    expect(callbacks.onSeekBackward).not.toHaveBeenCalled();
    expect(callbacks.onSeekForward).not.toHaveBeenCalled();
    expect(backwardEvent.defaultPrevented).toBe(false);
    expect(forwardEvent.defaultPrevented).toBe(false);
  });

  it("consumes only ArrowLeft when only backward seek is configured", () => {
    const { onSeekForward: _onSeekForward, ...backwardOnlyCallbacks } = callbacks;
    renderHook(() => usePlayerKeyboard(backwardOnlyCallbacks));

    const backwardEvent = fireKey("ArrowLeft");
    const forwardEvent = fireKey("ArrowRight");

    expect(backwardEvent.defaultPrevented).toBe(true);
    expect(forwardEvent.defaultPrevented).toBe(false);
  });

  it("consumes only ArrowRight when only forward seek is configured", () => {
    const { onSeekBackward: _onSeekBackward, ...forwardOnlyCallbacks } = callbacks;
    renderHook(() => usePlayerKeyboard(forwardOnlyCallbacks));

    const backwardEvent = fireKey("ArrowLeft");
    const forwardEvent = fireKey("ArrowRight");

    expect(backwardEvent.defaultPrevented).toBe(false);
    expect(forwardEvent.defaultPrevented).toBe(true);
  });

  it("does not fire when disabled", () => {
    renderHook(() => usePlayerKeyboard({ ...callbacks, disabled: true }));
    fireKey("k");
    fireKey("m");
    fireKey("f");
    expect(callbacks.onTogglePlay).not.toHaveBeenCalled();
    expect(callbacks.onToggleMute).not.toHaveBeenCalled();
    expect(callbacks.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it("ignores key events when target is an input element", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    const input = document.createElement("input");
    fireKey("k", input);
    expect(callbacks.onTogglePlay).not.toHaveBeenCalled();
  });

  it("ignores key events when target is a textarea", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    const textarea = document.createElement("textarea");
    fireKey("m", textarea);
    expect(callbacks.onToggleMute).not.toHaveBeenCalled();
  });

  it("ignores key events when target is a select", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    const select = document.createElement("select");
    fireKey("f", select);
    expect(callbacks.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it.each([
    [
      "link",
      () => {
        const link = document.createElement("a");
        link.href = "https://example.test";
        return link;
      },
    ],
    [
      "button role",
      () => {
        const control = document.createElement("div");
        control.setAttribute("role", "button");
        return control;
      },
    ],
    [
      "link role",
      () => {
        const control = document.createElement("div");
        control.setAttribute("role", "link");
        return control;
      },
    ],
  ])("ignores key events from an interactive %s", (_name, createTarget) => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("k", createTarget());
    expect(callbacks.onTogglePlay).not.toHaveBeenCalled();
  });

  it("ignores key events when target is contentEditable", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    const div = document.createElement("div");
    div.contentEditable = "true";
    // jsdom does not implement isContentEditable; stub it
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });
    fireKey("k", div);
    expect(callbacks.onTogglePlay).not.toHaveBeenCalled();
  });

  it("does not call onToggleTheater when it is not provided", () => {
    const { onToggleTheater, ...rest } = callbacks;
    renderHook(() => usePlayerKeyboard(rest));
    fireKey("t");
    // Should not throw and no callback
  });

  it("removes event listener on unmount", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => usePlayerKeyboard(callbacks));
    unmount();
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
    spy.mockRestore();
  });

  it("handles uppercase key same as lowercase", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("K");
    expect(callbacks.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("ignores unbound keys", () => {
    renderHook(() => usePlayerKeyboard(callbacks));
    fireKey("a");
    fireKey("b");
    fireKey("Escape");
    expect(callbacks.onTogglePlay).not.toHaveBeenCalled();
    expect(callbacks.onToggleMute).not.toHaveBeenCalled();
    expect(callbacks.onToggleFullscreen).not.toHaveBeenCalled();
    expect(callbacks.onVolumeUp).not.toHaveBeenCalled();
    expect(callbacks.onVolumeDown).not.toHaveBeenCalled();
  });
});
