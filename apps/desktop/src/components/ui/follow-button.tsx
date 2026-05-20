import { type MouseEvent, useState } from "react";
import { LuHeart, LuHeartCrack } from "react-icons/lu";
import { toast } from "sonner";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { Button } from "@/components/ui/button";
import { useOpenExternal } from "@/hooks/useElectron";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
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

export function FollowButton({ channel, className, size = "sm" }: FollowButtonProps) {
  const { isFollowing: isFollowingStore, toggleFollow, getFollowSource } = useFollowStore();
  const isFollowing = isFollowingStore(channel);
  const followSource = isFollowing ? getFollowSource(channel) : null;
  const openExternal = useOpenExternal();
  const [isHovering, setIsHovering] = useState(false);

  const platform = channel.platform as Platform;
  // Twitch removed the third-party follow/unfollow Helix endpoints in 2023,
  // so account-source rows on Twitch can't be mutated from this app. Route
  // the user to twitch.tv instead of silently dropping the local row
  // (next post-login sync would just re-add it and the heart would bounce
  // back, which reads as a broken toggle).
  const isManagedByTwitch = platform === "twitch" && followSource === "account";

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
