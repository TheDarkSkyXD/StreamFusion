import { LuRefreshCw, LuShieldCheck } from "react-icons/lu";

import type { AdBlockStatus } from "@/shared/adblock-types";

import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { PlayerControls, type PlayerControlsProps } from "../player-controls";

import { TwitchProgressBar } from "./twitch-progress-bar";

interface TwitchLivePlayerControlsProps extends PlayerControlsProps {
  showVideoStats?: boolean;
  onToggleVideoStats?: () => void;
  adBlockStatus?: AdBlockStatus | null;
  onRefresh?: () => void;
}

export function TwitchLivePlayerControls(props: TwitchLivePlayerControlsProps) {
  const { adBlockStatus, onRefresh, onSeek, ...controlsProps } = props;

  const adBlockStatusButton = adBlockStatus?.isActive ? (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={adBlockStatus.isShowingAd ? "Blocking ads" : "Ad-block active"}
          className={
            adBlockStatus.isShowingAd
              ? "text-green-500 animate-pulse hover:text-green-400 hover:bg-green-500/10 ml-1"
              : "text-white/70 hover:text-white hover:bg-white/20 ml-1"
          }
        >
          <LuShieldCheck className="w-6 h-6" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{adBlockStatus.isShowingAd ? "Blocking Ads..." : "Ad-Block Active"}</p>
      </TooltipContent>
    </Tooltip>
  ) : null;

  const refreshButton = onRefresh ? (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20 cursor-pointer"
          onClick={onRefresh}
        >
          <LuRefreshCw className="w-6 h-6" strokeWidth={3} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Refresh stream</p>
      </TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <PlayerControls
      {...controlsProps}
      onSeek={onSeek}
      duration={0}
      leftAddon={adBlockStatusButton}
      rightAddon={refreshButton}
      progressBar={
        <TwitchProgressBar currentTime={0} duration={0} onSeek={onSeek ?? (() => {})} isLive />
      }
    />
  );
}
