import { useMemo } from "react";

import { selectedModerationDevelopmentFixture } from "@/dev-relay/moderation-browser-fixtures";
import type { ChatBadge, ChatMessage } from "@/shared/chat-types";
import { useChatStore } from "@/store/chat-store";

import { useOpenUserPopout } from "../mod/UserPopout/UserPopoutProvider";

const BADGE_COLORS = ["#00ad03", "#9146ff", "#0e9bd8", "#c98b2e", "#e91916", "#6f42c1"];

const FIXTURE_BADGES: ChatBadge[] = BADGE_COLORS.map((color, index) => ({
  setId: `fixture-${index + 1}`,
  version: "1",
  title: `Fixture badge ${index + 1}`,
  imageUrl: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="${color}"/><text x="9" y="13" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="white">${index + 1}</text></svg>`
  )}`,
}));

interface ModerationFixtureLauncherProps {
  channel: string;
  channelId?: string;
}

export function ModerationFixtureLauncher({ channel, channelId }: ModerationFixtureLauncherProps) {
  const openUserPopout = useOpenUserPopout();
  const fixture = selectedModerationDevelopmentFixture(window.location.search);
  const openingMessage = useMemo<ChatMessage>(
    () => ({
      id: "moderation-browser-fixture-message",
      platform: "twitch",
      type: "message",
      channel,
      userId: "fixture-user",
      username: "fixtureuser",
      displayName: "FixtureUser",
      color: "#c084fc",
      badges: FIXTURE_BADGES,
      content: [{ type: "text", content: "Open the deterministic moderation dialog." }],
      rawContent: "Open the deterministic moderation dialog.",
      timestamp: new Date("2026-07-30T12:00:00Z"),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    }),
    [channel]
  );

  if (!fixture) return null;

  return (
    <div
      className="shrink-0 border-b border-purple-300/20 bg-purple-400/10 px-4 py-2 text-sm text-white"
      data-testid="moderation-fixture-launcher"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-purple-200">
        Development fixture · {fixture}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        {FIXTURE_BADGES.slice(0, 4).map((badge) => (
          <img
            key={badge.setId}
            className="h-4 w-4 shrink-0"
            src={badge.imageUrl}
            alt={badge.title}
          />
        ))}
        <button
          type="button"
          className="ml-1 shrink-0 font-semibold text-purple-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Open FixtureUser profile"
          onClick={() => {
            useChatStore.getState().addMessage(openingMessage);
            openUserPopout({
              userId: openingMessage.userId,
              username: openingMessage.username,
              displayName: openingMessage.displayName,
              platform: "twitch",
              channelId: channelId ?? "fixture-channel",
              channelSlug: channel,
              openingMessage,
            });
          }}
        >
          FixtureUser
        </button>
        <span className="truncate text-neutral-300">
          : Open the deterministic moderation dialog.
        </span>
      </div>
    </div>
  );
}
