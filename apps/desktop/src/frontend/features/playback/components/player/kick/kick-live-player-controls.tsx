import type React from "react";
import { useTranslation } from "react-i18next";
import { LuRadio } from "react-icons/lu";

import { useRenderCount } from "../../../../../components/dev/use-render-count";
import { Button } from "../../../../../components/ui/button";
import { PlayerControls, type PlayerControlsProps } from "../player-controls";

import { KickProgressBar, type KickProgressBarHandle } from "./kick-progress-bar";

interface KickLivePlayerControlsProps extends PlayerControlsProps {
  onGoLive?: () => void;
  /** Imperative handle the parent forwards to `UptimeReadout` for DOM updates. */
  progressBarRef?: React.Ref<KickProgressBarHandle>;
}

const KICK_GREEN = "#53fc18";

export function KickLivePlayerControls(props: KickLivePlayerControlsProps) {
  const { t } = useTranslation();
  useRenderCount("KickLivePlayerControls");

  const { onSeek, onGoLive, progressBarRef, ...controlsProps } = props;
  const isAtLiveEdge = true;
  const isBehindLive = false;

  const liveBadge = (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/60 ml-2 select-none">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: KICK_GREEN }} />
      <span className="text-white text-sm font-bold uppercase tracking-wider">
        {t("playback.live")}
      </span>
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
        {t("playback.goLive")}
      </Button>
    ) : null;

  return (
    <PlayerControls
      {...controlsProps}
      onSeek={onSeek}
      duration={0}
      theaterActiveColor={KICK_GREEN}
      liveBadge={liveBadge}
      leftAddon={goLiveButton}
      progressBar={
        onSeek ? (
          <KickProgressBar ref={progressBarRef} onSeek={onSeek} isLive={isAtLiveEdge} />
        ) : null
      }
    />
  );
}
