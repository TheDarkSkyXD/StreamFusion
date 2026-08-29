import { type MouseEvent, useState } from "react";
import { LuHeart, LuHeartCrack } from "react-icons/lu";
import { toast } from "sonner";

import type { UnifiedChannel } from "@shared/platform-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

interface FollowButtonProps {
  channel: UnifiedChannel;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

export function FollowButton({ channel, className, size = "sm" }: FollowButtonProps) {
  const {
    isFollowing: isFollowingStore,
    toggleFollow,
    getFollowSource,
    getPendingAccountAction,
  } = useFollowStore();
  const isFollowing = isFollowingStore(channel);
  const followSource = isFollowing ? getFollowSource(channel) : null;
  const accountPendingAction = getPendingAccountAction?.(channel) ?? null;
  const kickConnected = useAuthStore((state) => state.kickConnected);
  const twitchConnected = useAuthStore((state) => state.twitchConnected);
  const [isHovering, setIsHovering] = useState(false);
  const [localPendingAction, setLocalPendingAction] = useState<"follow" | "unfollow" | null>(null);
  const pendingAction = accountPendingAction ?? localPendingAction;
  const isPending = pendingAction !== null;
  const pendingLabel = pendingAction === "unfollow" ? "Unfollowing..." : "Following...";

  const platform = channel.platform;
  // Account rows must use the authenticated write path because a local-only
  // removal would be restored by the next platform sync.
  const isManagedByTwitch = platform === "twitch" && followSource === platform;
  const isManagedByKick = platform === "kick" && followSource === platform;
  const isManagedByAccount = isManagedByTwitch || isManagedByKick;

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isPending) return;

    setLocalPendingAction(isFollowing ? "unfollow" : "follow");
    try {
      const accountPlatform =
        !isFollowing &&
        ((platform === "kick" && kickConnected) || (platform === "twitch" && twitchConnected))
          ? platform
          : undefined;
      await toggleFollow(channel, accountPlatform ? { accountPlatform } : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (platform === "twitch" && /(reconnect|authorize)/i.test(message)) {
        toast("Reconnect Twitch follow access", {
          description: message,
        });
      } else if (platform === "twitch") {
        toast("Twitch couldn't confirm the follow change", {
          description: "Your Twitch follow is unchanged. Try again.",
        });
      } else {
        toast("Couldn't update follow", {
          description: `Your follow list was restored. Try ${channel.displayName || channel.username} again.`,
        });
      }
    } finally {
      setLocalPendingAction(null);
    }
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

  let title = "Follow";
  if (isPending) title = pendingLabel;
  else if (isManagedByAccount || isFollowing) title = "Unfollow";
  else if (platform === "twitch" && twitchConnected) {
    title = "Follow with your Twitch account";
  } else if (platform === "kick" && kickConnected) {
    title = "Follow with your Kick account";
  }

  return (
    <Button
      className={cn(
        "rounded-full font-bold transition-all gap-2 shadow-sm",
        isFollowing && !isPending && !isManagedByAccount ? "w-10 h-10 p-0" : "min-w-[100px] px-4",
        getButtonStyles(),
        className
      )}
      size={size}
      onClick={handleClick}
      disabled={isPending}
      aria-busy={isPending}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      title={title}
    >
      {isPending ? (
        <span>{pendingLabel}</span>
      ) : isManagedByAccount ? (
        <>
          <LuHeartCrack className="w-4 h-4" strokeWidth={3} />
          <span>Unfollow</span>
        </>
      ) : isFollowing ? (
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
