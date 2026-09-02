import { LuArrowRight, LuClock3 } from "react-icons/lu";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { RaidHandoffPopupModel } from "@/features/playback/data/use-raid-handoff";

export interface RaidHandoffPopupProps {
  model: RaidHandoffPopupModel;
  compact?: boolean;
}

export function RaidHandoffPopup({ model, compact = false }: RaidHandoffPopupProps) {
  const { t } = useTranslation();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { offer, participation } = model;
  const isCompact = compact || participation === "staying";
  const isTimed = model.progressPercent !== undefined;
  const remainingSeconds =
    model.remainingMs === undefined ? undefined : Math.max(0, Math.ceil(model.remainingMs / 1000));

  return (
    <section
      className={cn(
        "absolute bottom-4 left-1/2 z-50 w-[min(31rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-[#1a1a1a]/95 text-white shadow-2xl backdrop-blur-md",
        isCompact && "bottom-2 w-[min(27rem,calc(100%-1rem))]"
      )}
      role="region"
      aria-label={t("playback.raidInvitationTo", { target: offer.target.displayName })}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={cn("h-1 w-full", offer.platform === "twitch" ? "bg-[#9146ff]" : "bg-[#53fc18]")}
      />
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {participation === "joining"
          ? t("playback.joiningRaidTo", { target: offer.target.displayName })
          : t("playback.stayingCurrentStreamJoinTarget", {
              target: offer.target.displayName,
            })}
      </span>
      <div className={cn("flex items-center gap-3 p-4", isCompact && "p-3")}>
        <PlatformAvatar
          src={offer.target.avatarUrl}
          alt={offer.target.displayName}
          platform={offer.platform}
          size={isCompact ? "w-10 h-10" : "w-12 h-12"}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
            <LuArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            {t("playback.raidHandoff")}
          </div>
          <p className="truncate text-sm font-bold text-white">
            {t("playback.raiding", { target: offer.target.displayName })}
          </p>
          <p className="truncate text-xs text-white/65">
            {model.audienceText ??
              (offer.launchAuthority.kind === "provider-go"
                ? t("playback.waitingForTwitchToLaunchTheRaid")
                : t("playback.youWillMoveWhenTheCountdownEnds"))}
          </p>
        </div>

        {participation === "joining" ? (
          <Button size="sm" variant="secondary" onClick={model.stayHere}>
            {t("playback.stayHere")}
          </Button>
        ) : (
          <Button size="sm" variant={offer.platform} onClick={model.joinRaid}>
            {t("playback.joinRaid")}
          </Button>
        )}
      </div>

      {isTimed ? (
        <div
          className="h-1.5 w-full bg-white/10"
          role="progressbar"
          aria-label={t("playback.timeUntilRaidHandoff")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(model.progressPercent ?? 0)}
          aria-valuetext={t("playback.secondsRemaining", { count: remainingSeconds ?? 0 })}
        >
          <div
            className={cn(
              "h-full origin-left",
              offer.platform === "twitch" ? "bg-[#9146ff]" : "bg-[#53fc18]",
              !reduceMotion && "transition-[width] duration-100 ease-linear"
            )}
            style={{ width: `${model.progressPercent ?? 0}%` }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2 text-[11px] text-white/55">
          <LuClock3
            aria-hidden="true"
            className={cn("h-3.5 w-3.5", !reduceMotion && "animate-pulse")}
          />
          {t("playback.twitchWillSignalWhenTheRaidStarts")}
        </div>
      )}
    </section>
  );
}
