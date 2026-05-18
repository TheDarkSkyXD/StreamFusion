import { describe, expect, it } from "vitest";

import { kickPinToNormalized } from "@/backend/services/chat/kick-chat";
import type { KickPinnedMessage } from "@/shared/chat-types";

function makeRawPin(overrides: Partial<KickPinnedMessage> = {}): KickPinnedMessage {
  return {
    message: {
      id: "msg-1",
      content: "check the bracket",
      created_at: "2026-05-17T12:00:00.000Z",
      sender: {
        username: "fitzbro",
        identity: { color: "#53FC18" },
      },
    },
    pinned_by: {
      username: "modbot",
      identity: { color: "#FF6F61" },
    },
    finish_at: "2026-05-17T13:00:00.000Z",
    ...overrides,
  };
}

describe("kickPinToNormalized", () => {
  it("converts a representative Kick pin payload to the normalized shape", () => {
    const normalized = kickPinToNormalized(makeRawPin());
    expect(normalized).toEqual({
      platform: "kick",
      messageId: "msg-1",
      pinRecordId: "msg-1",
      author: {
        username: "fitzbro",
        displayName: "fitzbro",
        color: "#53FC18",
        badges: [],
      },
      content: [{ type: "text", content: "check the bracket" }],
      pinnedBy: { username: "modbot", color: "#FF6F61", badges: [] },
      pinnedAt: "2026-05-17T12:00:00.000Z",
      sentAt: "2026-05-17T12:00:00.000Z",
      expiresAt: "2026-05-17T13:00:00.000Z",
    });
  });

  it("maps missing finish_at to expiresAt: null", () => {
    const normalized = kickPinToNormalized(makeRawPin({ finish_at: undefined }));
    expect(normalized.expiresAt).toBeNull();
  });

  it("maps sender.identity.badges + pinned_by.identity.badges into ChatBadge[]", () => {
    // Real-world case: ac7ionman channel — sender has VIP + subscriber, the
    // moderator who pinned has the broadcaster badge. The adapter should run
    // both through parseKickBadges() so the shared PinnedMessageBanner can
    // render them inline next to the username (matching Twitch parity).
    const normalized = kickPinToNormalized(
      makeRawPin({
        message: {
          id: "msg-badged",
          content: "test",
          created_at: "2026-05-17T12:00:00.000Z",
          sender: {
            username: "viewer",
            identity: {
              color: "#FF7F50",
              badges: [
                { type: "vip", text: "VIP" },
                { type: "subscriber", text: "Subscriber", count: 12 },
              ],
            },
          },
        },
        pinned_by: {
          username: "ac7ionman",
          identity: {
            color: "#53FC18",
            badges: [{ type: "broadcaster", text: "Broadcaster" }],
          },
        },
      }),
    );

    expect(normalized.author.badges.map((b) => b.setId)).toEqual(["vip", "subscriber"]);
    expect(normalized.pinnedBy?.badges.map((b) => b.setId)).toEqual(["broadcaster"]);
    // Each badge carries the parsed title and a non-empty image URL (bundled).
    expect(normalized.author.badges[0].title).toBe("VIP");
    expect(normalized.author.badges[1].version).toBe("12"); // count → version
    expect(normalized.pinnedBy?.badges[0].title).toBe("Broadcaster");
  });

  it("handles missing badges arrays defensively (older pin payloads)", () => {
    // Older Kick pin events may omit `identity.badges` entirely — the
    // adapter should treat that as an empty array, not crash.
    const normalized = kickPinToNormalized(makeRawPin());
    expect(normalized.author.badges).toEqual([]);
    expect(normalized.pinnedBy?.badges).toEqual([]);
  });

  it("maps a falsy pinned_by to pinnedBy: null", () => {
    // The Kick history endpoint occasionally returns pins without a pinned_by
    // actor; the adapter should accept that without throwing.
    const normalized = kickPinToNormalized(
      makeRawPin({ pinned_by: undefined as unknown as KickPinnedMessage["pinned_by"] }),
    );
    expect(normalized.pinnedBy).toBeNull();
  });

  it("emits content as a single text fragment carrying the raw body", () => {
    const normalized = kickPinToNormalized(
      makeRawPin({
        message: {
          id: "msg-2",
          content: "https://youtube.com/@CoHBro",
          created_at: "2026-05-17T12:00:00.000Z",
          sender: { username: "fitzbro", identity: { color: "#53FC18" } },
        },
      }),
    );
    expect(normalized.content).toEqual([
      { type: "text", content: "https://youtube.com/@CoHBro" },
    ]);
  });
});
