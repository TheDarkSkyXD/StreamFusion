import type React from "react";
import { memo } from "react";
import type { DeletedMessageDisplayMode, ModerationHighlightStyle } from "../../shared/auth-types";
import type { ChatMessage, ChatPlatform, ChatUserPresentation } from "../../shared/chat-types";
import { ChatBadge } from "./ChatBadge";
import { DeletedMessageHighlightCompact } from "./DeletedMessageHighlightCompact";
import { DeletedMessageHighlightCozy } from "./DeletedMessageHighlightCozy";
import { Username, type UsernameChannelContext } from "./Username";

interface DeletedMessageHighlightProps {
  badges: ChatMessage["badges"];
  children: React.ReactNode;
  currentChannelContext?: UsernameChannelContext;
  deletedAt?: Date | number;
  highlightStyle: ModerationHighlightStyle;
  mode: Exclude<DeletedMessageDisplayMode, "tombstone">;
  message: ChatMessage;
  moderatorUser?: ChatUserPresentation;
  moderatorUsername?: string;
  style?: React.CSSProperties;
}

function platformLabel(platform: ChatPlatform): string {
  return platform === "kick" ? "Kick" : "Twitch";
}

function formatDeletedAt(timestamp: Date | number | undefined): string {
  if (!timestamp) return "time unknown";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderUserBadges(badges: ChatUserPresentation["badges"], platform: ChatPlatform) {
  if (badges.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-end gap-1 align-bottom [&_img]:!mr-0 [&_img]:align-bottom">
      {badges.map((badge, index) => (
        <ChatBadge
          key={`${badge.setId}-${badge.version}-${index}`}
          badge={badge}
          platform={platform}
        />
      ))}
    </span>
  );
}

function UserAttribution({
  currentChannelContext,
  platform,
  user,
}: {
  currentChannelContext?: UsernameChannelContext;
  platform: ChatPlatform;
  user: ChatUserPresentation;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-end gap-1 align-bottom">
      {renderUserBadges(user.badges, platform)}
      <Username
        userId={user.userId}
        username={user.username}
        displayName={user.displayName}
        color={user.color}
        platform={platform}
        className="align-bottom"
        currentChannelContext={currentChannelContext}
      />
    </span>
  );
}

export const DeletedMessageHighlight: React.FC<DeletedMessageHighlightProps> = memo(
  ({
    badges,
    children,
    currentChannelContext,
    deletedAt,
    highlightStyle,
    mode,
    message,
    moderatorUser,
    moderatorUsername,
    style,
  }) => {
    const fallbackModeratorUsername = moderatorUsername?.trim();
    const moderator =
      moderatorUser ??
      (fallbackModeratorUsername
        ? {
            userId: fallbackModeratorUsername,
            username: fallbackModeratorUsername,
            displayName: fallbackModeratorUsername,
            badges: [],
          }
        : undefined);
    const deletedTime = formatDeletedAt(deletedAt);

    const sender = (
      <span className="inline-flex min-w-0 max-w-full items-end gap-1 align-bottom">
        {badges.length > 0 && (
          <span className="inline-flex shrink-0 items-end gap-1 align-bottom [&_img]:!mr-0 [&_img]:align-bottom">
            {badges.map((badge, index) => (
              <ChatBadge
                key={`${badge.setId}-${badge.version}-${index}`}
                badge={badge}
                platform={message.platform}
              />
            ))}
          </span>
        )}
        <Username
          userId={message.userId}
          username={message.username}
          displayName={message.displayName}
          color={message.color}
          platform={message.platform}
          className="align-bottom"
          currentChannelContext={currentChannelContext}
          keepSuffixAttached
          suffix={<span className="align-bottom text-white">:</span>}
        />
      </span>
    );
    const moderatorNode = moderator ? (
      <UserAttribution
        currentChannelContext={currentChannelContext}
        platform={message.platform}
        user={moderator}
      />
    ) : (
      <span>unknown moderator</span>
    );
    const auditDetail =
      mode === "audit" ? (
        <>
          {" "}
          - {platformLabel(message.platform)} - id {message.id}
        </>
      ) : undefined;
    const sharedProps = {
      auditDetail,
      content: children,
      deletedTime,
      mode,
      moderator: moderatorNode,
      sender,
      style,
    };

    return highlightStyle === "cozy" ? (
      <DeletedMessageHighlightCozy {...sharedProps} />
    ) : (
      <DeletedMessageHighlightCompact {...sharedProps} platform={message.platform} />
    );
  }
);

DeletedMessageHighlight.displayName = "DeletedMessageHighlight";
