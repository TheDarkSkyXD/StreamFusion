import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/chat/kick-chat", () => ({
  kickChatService: { forceShutdown: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/backend/services/chat/twitch-chat", () => ({
  twitchChatService: { forceShutdown: vi.fn().mockResolvedValue(undefined) },
}));

import { kickChatService } from "@/backend/services/chat/kick-chat";
import { twitchChatService } from "@/backend/services/chat/twitch-chat";
import { useAppShutdown } from "@/hooks/use-app-shutdown";
import { useChatStore } from "@/store/chat-store";

let onBeforeQuitCallback: (() => void) | null = null;

beforeEach(() => {
  onBeforeQuitCallback = null;
  // @ts-expect-error -- test-only stub
  window.electronAPI = {
    onBeforeQuit: vi.fn((cb: () => void) => {
      onBeforeQuitCallback = cb;
      return vi.fn();
    }),
  };
  vi.mocked(kickChatService.forceShutdown).mockClear();
  vi.mocked(twitchChatService.forceShutdown).mockClear();
});

afterEach(() => {
  // @ts-expect-error -- clean up
  delete window.electronAPI;
});

describe("useAppShutdown", () => {
  it("registers an onBeforeQuit listener on mount", () => {
    renderHook(() => useAppShutdown());
    expect(window.electronAPI!.onBeforeQuit).toHaveBeenCalledTimes(1);
  });

  it("calls forceShutdown on both chat services when the quit callback fires", () => {
    renderHook(() => useAppShutdown());
    expect(onBeforeQuitCallback).not.toBeNull();
    onBeforeQuitCallback!();
    expect(kickChatService.forceShutdown).toHaveBeenCalledTimes(1);
    expect(twitchChatService.forceShutdown).toHaveBeenCalledTimes(1);
  });

  it("sets window.__shuttingDown to true", () => {
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();
    expect((window as unknown as { __shuttingDown?: boolean }).__shuttingDown).toBe(true);
  });

  it("calls cleanupBatching on the chat store", () => {
    const cleanupSpy = vi.spyOn(useChatStore.getState(), "cleanupBatching");
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    cleanupSpy.mockRestore();
  });

  it("returns the cleanup function from onBeforeQuit", () => {
    const unsub = vi.fn();
    window.electronAPI!.onBeforeQuit = vi.fn(() => unsub);
    const { unmount } = renderHook(() => useAppShutdown());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
