import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StateAwareTimeoutAction } from "./StateAwareTimeoutAction";

/**
 * Compatibility wrapper for older stories and call sites.
 *
 * UserPopout now places the state-aware action beside Moderation history, but
 * retaining this export avoids leaving a second, unsafe renderer mutation
 * implementation behind.
 */
export interface UserPopoutFooterProps {
  userId: string;
  username: string;
  platform: "twitch" | "kick";
  channelId: string;
  channelSlug: string;
  isBroadcaster: boolean;
  latestMessageId: string | null;
  kickChatroomId?: number;
  onActionSuccess?: () => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
}

export function UserPopoutFooter({
  userId,
  username,
  platform,
  channelId,
  channelSlug,
  latestMessageId,
  onActionSuccess,
  onPendingChange,
}: UserPopoutFooterProps) {
  const { t } = useTranslation();
  const externalUrl =
    platform === "twitch" ? `https://twitch.tv/${username}` : `https://kick.com/${username}`;

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="user-popout-footer">
      <StateAwareTimeoutAction
        binding={{
          platform,
          channelId,
          channelSlug,
          targetUserId: userId,
          targetUsername: username,
          ...(latestMessageId ? { selectedMessageId: latestMessageId } : {}),
          action: "timeout",
        }}
        displayName={username}
        onPendingChange={onPendingChange ?? (() => undefined)}
        onSuccess={onActionSuccess ?? (() => undefined)}
      />
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        onClick={() => window.electronAPI.openExternal(externalUrl)}
        aria-label={t("chatModeration.openExternalProfileButton")}
        data-testid="user-popout-footer-external"
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
        {t("chatModeration.open")}
      </button>
    </div>
  );
}
