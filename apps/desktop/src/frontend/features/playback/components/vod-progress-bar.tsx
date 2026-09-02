import type { Platform } from "@shared/auth-types";
import { useTranslation } from "react-i18next";
import { usePlaybackPositionStore } from "@/store/playback-position-store";

interface VodProgressBarProps {
  platform: Platform;
  videoId: string;
}

export function VodProgressBar({ platform, videoId }: VodProgressBarProps) {
  const { t } = useTranslation();
  const savedPosition = usePlaybackPositionStore(
    (state) => state.positions[`${platform}-${videoId}`]
  );

  if (!savedPosition || savedPosition.duration <= 0) return null;

  const watchedRatio = savedPosition.position / savedPosition.duration;
  const percent = watchedRatio >= 0.95 ? 100 : Math.min(100, Math.max(0, watchedRatio * 100));

  return (
    <div
      role="progressbar"
      aria-label={t("playback.watchProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/60"
    >
      <div className="h-full bg-[var(--color-primary)]" style={{ width: `${percent}%` }} />
    </div>
  );
}
