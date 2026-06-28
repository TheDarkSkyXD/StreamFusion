import type React from "react";
import { LuRadio, LuRefreshCw } from "react-icons/lu";

import { useRenderCount } from "../../dev/use-render-count";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { PlayerControls, type PlayerControlsProps } from "../player-controls";

import { KickProgressBar, type KickProgressBarHandle } from "./kick-progress-bar";

interface KickLivePlayerControlsProps extends PlayerControlsProps {
  onGoLive?: () => void;
  /** Imperative handle the parent forwards to `UptimeReadout` for DOM updates. */
  progressBarRef?: React.Ref<KickProgressBarHandle>;
  onRefresh?: () => void;
}

const KICK_GREEN = "#53fc18";

export function KickLivePlayerControls(props: KickLivePlayerControlsProps) {
  useRenderCount("KickLivePlayerControls");

  const { onSeek, onGoLive, progressBarRef, onRefresh, ...controlsProps } = props;
  const isAtLiveEdge = true;
  const isBehindLive = false;

  const liveBadge = (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/60 ml-2 select-none">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: KICK_GREEN }} />
      <span className="text-white text-sm font-bold uppercase tracking-wider">LIVE</span>
    </div>
  );

  const goLiveButton =
    isBehindLive && onGoLive ? (
      <Button
        variant="ghost"
        size="sm"
        className="ml-2 text-black font-bold text-xs uppercase tracking-wider px-3 py-1 rounded hover:opacity-90 cursor-pointer"
        style={{ backgroundColor: KICK_GREEN }}
        onClick={(event) => {
          event.stopPropagation();
          onGoLive();
        }}
      >
        <LuRadio className="w-4 h-4 mr-1" />
        Go Live
      </Button>
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
      theaterActiveColor={KICK_GREEN}
      liveBadge={liveBadge}
      leftAddon={goLiveButton}
      rightAddon={refreshButton}
      progressBar={
        onSeek ? (
          <KickProgressBar ref={progressBarRef} onSeek={onSeek} isLive={isAtLiveEdge} />
        ) : null
      }
    />
  );
}
