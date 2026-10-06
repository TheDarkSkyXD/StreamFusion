import { afterEach, expect, it, vi } from "vitest";
import { createChatInteractions } from "../domain/chat-interactions";
import { defaultChatDisplaySettingsView } from "@mobile/features/settings/domain/chat-display-preferences";
import type {
  ChatCommands,
  ChatCosmeticsReader,
} from "../capabilities/chat-interactions";

const target = {
  channelId: "1",
  channelName: "channel",
  platform: "twitch",
} as const;
const commands: ChatCommands = {
  access: async () => ({ allowed: false, detail: "Log in to chat" }),
  subscribe: () => () => undefined,
  send: async () => ({ kind: "sent", messageId: "sent" }),
  userAction: async () => ({ kind: "completed" }),
};
const emotes = { read: async () => ({ emotes: [], failures: [] }) };
afterEach(() => vi.useRealTimers());

it("does not retry users after the visible chat list becomes empty", async () => {
  vi.useFakeTimers();
  const read = vi
    .fn<ChatCosmeticsReader["read"]>()
    .mockResolvedValue({ byUserId: new Map(), failures: ["7TV"] });
  const session = createChatInteractions(commands, emotes, undefined, { read });
  session.attach(target, false);
  session.loadCosmetics?.(["42"]);
  await vi.advanceTimersByTimeAsync(100);
  session.loadCosmetics?.([]);
  await vi.advanceTimersByTimeAsync(30_200);
  expect(read).toHaveBeenCalledTimes(1);
  session.dispose();
});

it("retries a failed cosmetic provider for visible users and cancels retries on disposal", async () => {
  vi.useFakeTimers();
  const read = vi
    .fn<ChatCosmeticsReader["read"]>()
    .mockResolvedValueOnce({
      byUserId: new Map([["42", { badges: [] }]]),
      failures: ["7TV"],
    })
    .mockResolvedValue({
      byUserId: new Map([
        [
          "42",
          {
            badges: [
              {
                id: "badge",
                title: "Supporter",
                provider: "7tv",
                imageUrl: "https://example.com/badge.png",
              },
            ],
          },
        ],
      ]),
      failures: [],
    });
  const session = createChatInteractions(commands, emotes, undefined, { read });
  session.attach(target, false);
  session.loadCosmetics?.(["42"]);
  await vi.advanceTimersByTimeAsync(100);
  expect(session.snapshot().cosmeticsDetail).toBe(
    "Unavailable cosmetics: 7TV.",
  );
  session.loadCosmetics?.(["42"]);
  await vi.advanceTimersByTimeAsync(29_900);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(200);
  expect(read).toHaveBeenCalledTimes(2);
  expect(session.snapshot().cosmetics?.get("42")?.badges[0]?.title).toBe(
    "Supporter",
  );
  expect(session.snapshot().cosmeticsDetail).toBe("");
  session.dispose();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("discards old cosmetic errors after a preference change without interrupting chat access", async () => {
  vi.useFakeTimers();
  let view = defaultChatDisplaySettingsView();
  let changed = () => undefined;
  let rejectOld: ((reason: Error) => void) | undefined;
  const old = new Promise<Awaited<ReturnType<ChatCosmeticsReader["read"]>>>(
    (_, reject) => {
      rejectOld = reject;
    },
  );
  const read = vi
    .fn<ChatCosmeticsReader["read"]>()
    .mockReturnValueOnce(old)
    .mockResolvedValue({ byUserId: new Map(), failures: [] });
  const session = createChatInteractions(
    commands,
    emotes,
    {
      load: async () => view,
      peek: () => view,
      subscribe: (listener) => {
        changed = listener;
        return () => undefined;
      },
    },
    { read },
  );
  session.attach(target, false);
  session.loadCosmetics?.(["42"]);
  await vi.advanceTimersByTimeAsync(100);
  view = {
    ...view,
    preferences: { ...view.preferences, enable7tvBadges: false },
  };
  changed();
  rejectOld?.(new Error("Old request failed"));
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledTimes(2);
  expect(session.snapshot().cosmeticsDetail).toBe("");
  expect(session.snapshot().displayPreferences?.enable7tvBadges).toBe(false);
  expect(session.snapshot().access).toBe("blocked");
  session.dispose();
});

it("bounds requests to 120 users and drains remaining visible users instead of marking them loaded", async () => {
  vi.useFakeTimers();
  const read = vi.fn<ChatCosmeticsReader["read"]>(async (_, ids) => ({
    byUserId: new Map(ids.map((id) => [id, { badges: [] }])),
    failures: [],
  }));
  const session = createChatInteractions(commands, emotes, undefined, { read });
  session.attach(target, false);
  const users = Array.from({ length: 150 }, (_, index) => String(index + 1));
  session.loadCosmetics?.(users);
  await vi.advanceTimersByTimeAsync(200);
  expect(read.mock.calls.map((call) => call[1].length)).toEqual([120, 30]);
  expect(session.snapshot().cosmetics?.size).toBe(150);
  session.loadCosmetics?.(users);
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledTimes(2);
  session.dispose();
});
