import { expect, it } from "vitest";
import type { ChatEmote } from "../capabilities/chat-interactions";
import { selectQuickEmotes } from "../domain/quick-emotes";

const emote = (
  provider: ChatEmote["provider"],
  id: string,
  isGlobal = false,
): ChatEmote => ({
  provider,
  id,
  name: id,
  insertion: id,
  imageUrl: `https://example.test/${id}`,
  isGlobal,
});

it("prioritizes current recent emotes, then native and third-party globals, at nine unique choices", () => {
  const inventory = [
    emote("7tv", "channel"),
    emote("ffz", "ffz-global", true),
    emote("twitch", "native-global", true),
    ...Array.from({ length: 10 }, (_, index) =>
      emote("7tv", `global-${index}`, true),
    ),
    emote("kick", "other-platform", true),
  ];
  expect(
    selectQuickEmotes("twitch", inventory, [
      { provider: "7tv", id: "channel" },
      { provider: "7tv", id: "channel" },
      { provider: "kick", id: "other-platform" },
      { provider: "7tv", id: "missing" },
    ]).map((choice) => `${choice.provider}:${choice.id}`),
  ).toEqual([
    "7tv:channel",
    "twitch:native-global",
    "7tv:global-0",
    "7tv:global-1",
    "7tv:global-2",
    "7tv:global-3",
    "7tv:global-4",
    "7tv:global-5",
    "7tv:global-6",
  ]);
  expect(
    selectQuickEmotes("kick", inventory, []).map((choice) => choice.id),
  ).toEqual([
    "other-platform",
    "global-0",
    "global-1",
    "global-2",
    "global-3",
    "global-4",
    "global-5",
    "global-6",
    "global-7",
  ]);
});
