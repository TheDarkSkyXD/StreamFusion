import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { VisuallyHidden } from "@/components/ui/visually-hidden";
import {
  THROUGHPUT_RING_CAPACITY,
  type ThroughputSeries,
  useDownloadThroughputStore,
} from "@/features/media-library/components/state/download-throughput-store";
import type { DownloadJob } from "@shared/download-types";

import {
  THROUGHPUT_WAVE_BASELINE,
  THROUGHPUT_WAVE_WIDTH,
  throughputWavePaths,
} from "./throughput-wave-paths";

const EM_DASH = "—";
const NON_BREAKING_SPACE = " ";
const RATE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

function formatBytesPerSecond(bytesPerSecond: number): string {
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < RATE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex <= 1 ? 0 : unitIndex === 2 ? 1 : 2;
  return `${value.toFixed(precision)}${NON_BREAKING_SPACE}${RATE_UNITS[unitIndex]}`;
}

function lastMeasuredRate(series: ThroughputSeries | undefined) {
  const last = series?.samples.at(-1);
  return last === undefined ? null : last.bytesPerSecond;
}

export interface DownloadThroughputMeterProps {
  job: DownloadJob;
  sharedMaximum: number;
  statusTextClassName: string;
}

export function DownloadThroughputMeter({
  job,
  sharedMaximum,
  statusTextClassName,
}: DownloadThroughputMeterProps) {
  const { t } = useTranslation();
  const gradientId = useId();
  const waveRef = useRef<SVGPathElement | null>(null);
  const series = useDownloadThroughputStore((state) => state.seriesByJobId[job.id]);
  const phase = series?.phase ?? "idle";
  const samples = series?.samples;

  const wave = useMemo(
    () =>
      samples === undefined
        ? null
        : throughputWavePaths({
            samples,
            maximum: sharedMaximum,
            capacity: THROUGHPUT_RING_CAPACITY,
          }),
    [samples, sharedMaximum]
  );

  useLayoutEffect(() => {
    if (wave) waveRef.current?.setAttribute("d", wave.area);
  }, [wave]);

  const rateLabel =
    job.byteSource === "output-file"
      ? t("mediaLibrary.downloadWriteRateLabel")
      : t("mediaLibrary.downloadRateLabel");
  const title = phase === "stalled" ? t("mediaLibrary.downloadRateStalled") : rateLabel;

  const isComplete = phase === "complete";
  const rate = isComplete ? (series?.averageBytesPerSecond ?? null) : lastMeasuredRate(series);
  const rateText =
    rate === null || rate <= 0
      ? EM_DASH
      : t("mediaLibrary.transferSpeed", { value: formatBytesPerSecond(rate) });
  const value =
    isComplete && rateText !== EM_DASH
      ? t("mediaLibrary.downloadRateAverage", { value: rateText })
      : rateText;

  return (
    <span className="flex shrink-0 items-center gap-2">
      <VisuallyHidden>{rateLabel}</VisuallyHidden>
      <span
        title={title}
        className={`shrink-0 tabular-nums ${
          phase === "idle" ? "text-[var(--color-foreground-muted)]" : statusTextClassName
        }`}
      >
        {value}
      </span>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${THROUGHPUT_WAVE_WIDTH} ${THROUGHPUT_WAVE_BASELINE}`}
        preserveAspectRatio="none"
        className={`h-7 w-[140px] shrink-0 ${statusTextClassName} ${
          phase === "complete" ? "opacity-50" : ""
        }`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {wave ? (
          <path ref={waveRef} fill={`url(#${gradientId})`} />
        ) : (
          <line
            x1="0"
            y1={THROUGHPUT_WAVE_BASELINE - 1}
            x2={THROUGHPUT_WAVE_WIDTH}
            y2={THROUGHPUT_WAVE_BASELINE - 1}
            // A download measured and not moving must not look like one that never started, so the
            // track carries the row status whenever the phase is more than idle.
            stroke={phase === "idle" ? "var(--color-border)" : "currentColor"}
            strokeOpacity={phase === "idle" ? 1 : 0.45}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  );
}
