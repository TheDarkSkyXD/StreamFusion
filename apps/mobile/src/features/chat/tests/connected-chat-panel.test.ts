// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  WatchChatSession,
  WatchChatAvailability,
} from "../capabilities/watch-chat";
import type { ChatInteractions } from "../capabilities/chat-interactions";
import { ConnectedChatPanel } from "../components/connected-chat-panel";

const lifecycle = vi.hoisted(() => ({
  currentState: "active",
  listener: null as null | ((state: string) => void),
  removed: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return lifecycle.currentState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      lifecycle.listener = listener;
      return { remove: lifecycle.removed };
    },
  },
  Text: "span",
}));
vi.mock("../components/chat-panel", () => ({
  ChatPanel: ({ target }: { target: { channelName: string } }) =>
    createElement("span", null, target.channelName),
}));

describe("moderation live chat lifecycle", () => {
  it("reconnects the selected real chat on foreground and releases it on unmount", async () => {
    const availability: WatchChatAvailability = {
      kind: "empty",
      detail: "Connected",
    };
    const chat: WatchChatSession = {
      attach: vi.fn(),
      dispose: vi.fn(),
      retry: vi.fn(),
      snapshot: () => availability,
      subscribe: () => () => undefined,
    };
    const interactions: ChatInteractions = {
      attach: vi.fn(),
      dispose: vi.fn(),
      subscribe: () => () => undefined,
      snapshot: () => ({
        access: "blocked",
        detail: "Sign in",
        sending: false,
        emotes: [],
        emoteStatus: "ready",
        emoteDetail: "",
      }),
      send: async () => ({ kind: "blocked", detail: "Sign in" }),
      userAction: async () => ({ kind: "blocked", detail: "Sign in" }),
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const target = {
      channelId: "101",
      channelName: "alpha",
      platform: "twitch" as const,
    };
    await act(async () =>
      root.render(
        createElement(ConnectedChatPanel, {
          runtime: { chat, interactions },
          target,
        }),
      ),
    );
    expect(chat.attach).toHaveBeenLastCalledWith(target);
    expect(container.textContent).toBe("alpha");
    await act(async () => lifecycle.listener?.("background"));
    expect(chat.dispose).toHaveBeenCalledOnce();
    expect(interactions.dispose).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("reconnects");
    await act(async () => lifecycle.listener?.("active"));
    expect(chat.attach).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("alpha");
    await act(async () => root.unmount());
    expect(chat.dispose).toHaveBeenCalledTimes(2);
    expect(interactions.dispose).toHaveBeenCalledTimes(2);
    expect(lifecycle.removed).toHaveBeenCalledOnce();
  });
});
