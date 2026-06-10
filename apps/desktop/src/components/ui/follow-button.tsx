import { type MouseEvent, useState } from "react";
import { LuHeart, LuHeartCrack } from "react-icons/lu";
import { toast } from "sonner";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { Button } from "@/components/ui/button";
import { useOpenExternal } from "@/hooks/useElectron";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

interface FollowButtonProps {
  channel: UnifiedChannel;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

function buildTwitchChannelUrl(username: string): string {
  // Twitch logins are case-insensitive and ASCII-only; lowercase keeps URLs
  // canonical and matches the redirect twitch.tv would do anyway.
  return `https://www.twitch.tv/${encodeURIComponent(username.toLowerCase())}`;
}

function buildKickChannelUrl(username: string): string {
  // Kick slugs are case-insensitive and ASCII-only; lowercase matches kick.com's
  // canonical URL form.
  return `https://kick.com/${encodeURIComponent(username.toLowerCase())}`;
}

export function FollowButton({ channel, className, size = "sm" }: FollowButtonProps) {
  const { isFollowing: isFollowingStore, toggleFollow, getFollowSource } = useFollowStore();
  const isFollowing = isFollowingStore(channel);
  const followSource = isFollowing ? getFollowSource(channel) : null;
  const openExternal = useOpenExternal();
  const kickConnected = useAuthStore((state) => state.kickConnected);
  const [isHovering, setIsHovering] = useState(false);

  const platform = channel.platform as Platform;
  // Platform-tagged rows (source = "kick" or "twitch") represent follows
  // the user has expressed while signed in to that platform — either
  // sync-imported from the account's follow list or clicked in-app. A
  // local unfollow on such a row would just bounce back on the next sync
  // (which re-adopts platform-side rows unless a pending-unfollow tombstone
  // blocks it). Route the user to the platform's website instead so the
  // canonical unfollow happens there and the sync reconciles cleanly.
  const isManagedByTwitch = platform === "twitch" && followSource === platform;
  const isManagedByKick = platform === "kick" && followSource === platform;

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isManagedByTwitch && channel.username) {
      const url = buildTwitchChannelUrl(channel.username);
      toast("Manage this follow on Twitch", {
        description: `Open ${channel.displayName || channel.username} on twitch.tv to unfollow.`,
        action: {
          label: "Open Twitch",
          onClick: () => openExternal(url),
        },
      });
      return;
    }

    if (isManagedByKick && channel.username) {
      const url = buildKickChannelUrl(channel.username);
      toast("Manage this follow on Kick", {
        description: `Open ${channel.displayName || channel.username} on kick.com to unfollow.`,
        action: {
          label: "Open Kick",
          onClick: () => openExternal(url),
        },
      });
      return;
    }

    if (!isFollowing && platform === "kick" && kickConnected && channel.username) {
      const url = buildKickChannelUrl(channel.username);
      toast("Follow this channel on Kick", {
        description: `Open ${channel.displayName || channel.username} on kick.com so the follow is saved to your Kick account.`,
        action: {
          label: "Open Kick",
          onClick: () => openExternal(url),
        },
      });
      return;
    }

    toggleFollow(channel);
  };

  const getButtonStyles = () => {
    if (isFollowing) {
      return "bg-neutral-800 hover:bg-neutral-700 border-transparent border text-white";
    }
    if (platform === "twitch")
      return "bg-[#9146FF] hover:bg-[#9146FF]/90 text-white border-transparent";
    if (platform === "kick")
      return "bg-[#53FC18] hover:bg-[#53FC18]/90 text-black border-transparent";
    return "bg-primary text-primary-foreground";
  };

  return (
    <Button
      className={cn(
        "rounded-full font-bold transition-all gap-2 shadow-sm",
        isFollowing ? "w-10 h-10 p-0" : "min-w-[100px] px-4",
        getButtonStyles(),
        className
      )}
      size={size}
      onClick={handleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      title={
        isManagedByTwitch
          ? "Followed via your Twitch account — click to manage on twitch.tv"
          : isManagedByKick
            ? "Followed via your Kick account — click to manage on kick.com"
            : !isFollowing && platform === "kick" && kickConnected
              ? "Open on kick.com to follow with your Kick account"
              : isFollowing
                ? "Unfollow"
                : "Follow"
      }
    >
      {isFollowing ? (
        isHovering ? (
          <LuHeartCrack className="w-5 h-5 text-red-500" strokeWidth={3} />
        ) : (
          <LuHeart className="w-5 h-5 fill-current text-white" strokeWidth={3} />
        )
      ) : (
        <>
          <LuHeart className={cn("w-4 h-4", isHovering ? "fill-current" : "")} strokeWidth={3} />
          <span>Follow</span>
        </>
      )}
    </Button>
  );
}
