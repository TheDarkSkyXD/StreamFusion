import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatPlatform } from "@shared/chat-types";
import { buildChannelKey } from "@/store/chat-store";
import {
  reconcileSelectedMessage,
  selectLatestAuthoredMessage,
  selectRecentUserMessages,
} from "@/store/user-popout-chat-context";

function message(
  id: string,
  platform: ChatPlatform,
  channel: string,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id,
    platform,
    channel,
    type: "message",
    userId: "target-id",
    username: "target",
    displayName: "Target",
    color: "#ffffff",
    badges: [],
    content: [{ type: "text", content: id }],
    rawContent: id,
    timestamp: new Date(`2026-07-30T00:00:${id.padStart(2, "0")}Z`),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    ...overrides,
  };
}

// Guards: User Info reads only the canonical current-platform/current-channel bucket.
describe("selectRecentUserMessages", () => {
  it("does not leak the same chatter from another channel or platform bucket", () => {
    const currentKey = buildChannelKey("kick", "xqc");
    const buckets = {
      [currentKey]: [message("01", "kick", "xqc")],
      [buildChannelKey("kick", "other")]: [message("02", "kick", "other")],
      [buildChannelKey("twitch", "xqc")]: [message("03", "twitch", "xqc")],
    };

    expect(
      selectRecentUserMessages(buckets, currentKey, {
        userId: "target-id",
        username: "target",
      }).map((entry) => entry.id)
    ).toEqual(["01"]);
  });

  it("includes replies addressed to the target by id while retaining the reply author", () => {
    const currentKey = buildChannelKey("kick", "xqc");
    const reply = message("02", "kick", "xqc", {
      userId: "reply-author-id",
      username: "reply-author",
      displayName: "Reply Author",
      replyTo: {
        parentMessageId: "01",
        parentUserId: "target-id",
        parentUsername: "stale-target-name",
        parentDisplayName: "Target",
        parentMessageBody: "Original",
      },
    });

    const selected = selectRecentUserMessages({ [currentKey]: [reply] }, currentKey, {
      userId: "target-id",
      username: "target",
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(reply);
    expect(selected[0].displayName).toBe("Reply Author");
  });

  it("falls back to parent username only when the reply parent id is absent", () => {
    const currentKey = buildChannelKey("kick", "xqc");
    const usernameFallback = message("02", "kick", "xqc", {
      userId: "reply-author-id",
      username: "reply-author",
      replyTo: {
        parentMessageId: "01",
        parentUserId: "",
        parentUsername: "TARGET",
        parentDisplayName: "Target",
        parentMessageBody: "Original",
      },
    });
    const conflictingStableId = message("03", "kick", "xqc", {
      userId: "other-author-id",
      username: "other-author",
      replyTo: {
        parentMessageId: "01",
        parentUserId: "different-id",
        parentUsername: "target",
        parentDisplayName: "Target",
        parentMessageBody: "Original",
      },
    });

    expect(
      selectRecentUserMessages(
        { [currentKey]: [usernameFallback, conflictingStableId] },
        currentKey,
        { userId: "target-id", username: "target" }
      )
    ).toEqual([usernameFallback]);
  });

  it("caps the live collection at the newest ten without dropping deleted rows", () => {
    const currentKey = buildChannelKey("kick", "xqc");
    const entries = Array.from({ length: 12 }, (_, index) =>
      message(String(index + 1), "kick", "xqc", {
        isDeleted: index === 2,
      })
    );

    const selected = selectRecentUserMessages({ [currentKey]: entries }, currentKey, {
      userId: "target-id",
      username: "target",
    });

    expect(selected.map((entry) => entry.id)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(selected[0].isDeleted).toBe(true);
  });
});

// Guards: Header badges come only from the target's newest authored message, never a reply author or union.
describe("selectLatestAuthoredMessage", () => {
  it("returns the newest authored snapshot without unioning older or reply-author badges", () => {
    const currentKey = buildChannelKey("kick", "xqc");
    const older = message("01", "kick", "xqc", {
      badges: [{ setId: "older", version: "1", imageUrl: "older.png", title: "Older" }],
    });
    const newest = message("02", "kick", "xqc", {
      badges: [{ setId: "newest", version: "1", imageUrl: "newest.png", title: "Newest" }],
    });
    const reply = message("03", "kick", "xqc", {
      userId: "other-id",
      username: "other",
      badges: [{ setId: "other", version: "1", imageUrl: "other.png", title: "Other" }],
      replyTo: {
        parentMessageId: "02",
        parentUserId: "target-id",
        parentUsername: "target",
        parentDisplayName: "Target",
        parentMessageBody: "Newest",
      },
    });

    expect(
      selectLatestAuthoredMessage({ [currentKey]: [older, newest, reply] }, currentKey, {
        userId: "target-id",
        username: "target",
      })
    ).toBe(newest);
  });
});

// Guards: Live insertion and ten-row pruning cannot silently retarget selected-message actions.
describe("reconcileSelectedMessage", () => {
  it("keeps the exact opening snapshot pinned after it leaves the live collection", () => {
    const opening = message("01", "kick", "xqc");
    const liveCollection = Array.from({ length: 10 }, (_, index) =>
      message(String(index + 2), "kick", "xqc")
    );

    expect(reconcileSelectedMessage(opening, liveCollection)).toBe(opening);
  });

  it("does not reconcile an id collision from another platform, channel, or author", () => {
    const opening = message("01", "kick", "xqc");
    const collision = message("01", "twitch", "other", { userId: "other-id" });

    expect(reconcileSelectedMessage(opening, [collision])).toBe(opening);
  });
});
