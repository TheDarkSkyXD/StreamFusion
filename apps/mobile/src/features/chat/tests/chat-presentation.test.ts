import { describe, expect, it } from "vitest";
import type { ChannelPageOutcome } from "@mobile/features/discovery/capabilities/platform-reads";
import { createChatRuntime } from "../composition/chat-runtime";

const channel = {
  id: "42",
  platform: "kick" as const,
  username: "ada",
  displayName: "Ada",
  avatarUrl: "https://example.test/ada.png",
  isLive: true,
  isPartner: true,
  isVerified: true,
};

function runtime(page: ChannelPageOutcome) {
  return createChatRuntime({
    access: {
      read: async () => ({
        kind: "blocked",
        reason: "sign-in",
        detail: "Sign in.",
      }),
      subscribe: () => () => undefined,
    },
    fetch: globalThis.fetch,
    openUrl: async () => undefined,
    discovery: { readChannel: async () => page },
    copyText: async () => undefined,
  });
}

describe("chat profile presentation", () => {
  it("shows a live ring only for a complete, fresh channel read", async () => {
    const page: ChannelPageOutcome = {
      platform: "kick",
      path: { kind: "guest", platform: "kick" },
      status: "complete",
      channel,
      live: null,
      cache: { kind: "miss" },
    };
    const identity = { platform: "kick" as const, id: "42", username: "ada" };
    const signal = new AbortController().signal;

    expect(
      (await runtime(page).presentation.readChannel?.(identity, signal))
        ?.isLive,
    ).toBe(true);
    expect(
      (
        await runtime({
          ...page,
          cache: { kind: "hit", stale: true, ageMilliseconds: 60_000 },
        }).presentation.readChannel?.(identity, signal)
      )?.isLive,
    ).toBe(false);
    expect(
      (
        await runtime({
          ...page,
          status: "partial",
        }).presentation.readChannel?.(identity, signal)
      )?.isLive,
    ).toBe(false);
  });
});
