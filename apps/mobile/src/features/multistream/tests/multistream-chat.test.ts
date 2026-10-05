import { describe, expect, it, vi } from "vitest";
import type {
  WatchChatAvailability,
  WatchChatSession,
} from "@mobile/features/chat/capabilities/watch-chat";
import { createMultistreamChat } from "../domain/multistream-chat";

function feed() {
  let view: WatchChatAvailability = { kind: "empty", detail: "Connected." };
  const listeners = new Set<() => void>();
  const session: WatchChatSession = {
    attach: vi.fn(),
    dispose: vi.fn(),
    retry: vi.fn(),
    snapshot: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    session,
    push(id: string) {
      view = {
        kind: "live",
        detail: "Connected.",
        messages: [{ id, displayName: "Viewer", text: "Hello", badges: [] }],
      };
      for (const listener of listeners) listener();
    },
  };
}
const tiles = [
  {
    id: "a",
    target: {
      platform: "twitch" as const,
      channelId: "1",
      channelName: "alpha",
    },
    state: "playing" as const,
    detail: null,
  },
  {
    id: "b",
    target: { platform: "kick" as const, channelId: "2", channelName: "beta" },
    state: "playing" as const,
    detail: null,
  },
];
describe("multistream chat", () => {
  it("connects one feed per channel and merges messages with channel identities", () => {
    const a = feed();
    const b = feed();
    const sessions = [a.session, b.session];
    const create = vi.fn(() => sessions.shift()!);
    const chat = createMultistreamChat(create);
    chat.attach(tiles);
    chat.attach(tiles);
    a.push("same-message-id");
    b.push("same-message-id");
    a.push("same-message-id");
    expect(create).toHaveBeenCalledTimes(2);
    expect(chat.snapshot(null)).toMatchObject({
      kind: "live",
      messages: [
        { id: "a:same-message-id", displayName: "[alpha] Viewer" },
        { id: "b:same-message-id", displayName: "[beta] Viewer" },
      ],
    });
    expect(chat.snapshot("a")).toMatchObject({
      kind: "live",
      messages: [{ id: "same-message-id", displayName: "Viewer" }],
    });
    chat.attach([tiles[1]!]);
    expect(a.session.dispose).toHaveBeenCalledOnce();
    expect(chat.snapshot(null)).toMatchObject({
      kind: "live",
      messages: [{ id: "b:same-message-id" }],
    });
    chat.dispose();
    expect(b.session.dispose).toHaveBeenCalledOnce();
    expect(chat.snapshot(null)).toMatchObject({ kind: "empty" });
  });
});
