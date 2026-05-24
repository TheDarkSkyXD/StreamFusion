/**
 * Viewer-side prediction widget — a read-only mirror of Twitch's community-
 * highlight prediction card. Captured live from https://www.twitch.tv/adinross
 * (2026-05-24):
 *   - "Predict with Channel Points" subtitle: 12px / 400 / #efeff1
 *   - bold title: 18px / 500 / -0.18px tracking / #efeff1 (wraps when expanded)
 *   - purple "See Details" pill (14px / 600 / #9147ff) + vertical-dots overflow
 *   - numbered outcome rows: "1. Title … [icon] amount" at 14px / #efeff1, with
 *     NO per-row percentage and NO leader badge (Twitch's compact card shows
 *     amounts only)
 *   - a slim purple time-remaining bar that counts down to the lock time
 *     (createdAt + predictionWindowSeconds)
 *
 * Read-only by design: in-app voting is intentionally not offered (the platform
 * vote APIs aren't wired for viewers), so the expanded panel shows the same
 * information Twitch does without any vote affordance. The server-provided
 * `viewerOutcomeId` still highlights the outcome the viewer picked on-platform.
 *
 * Three style variants picked from useAuthStore.preferences.predictions.style ×
 * prediction.platform: twitch-native | kick-native | unified.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { UnifiedPrediction, UnifiedPredictionOutcome } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

const ENDED_AUTO_DISMISS_MS = 60_000;

// Twitch palette captured from live computed styles on twitch.tv (adinross, 2026-05-24).
const TW_PURPLE = "#9147ff";
const TW_PURPLE_LIGHT = "#a970ff";
const TW_TRACK = "rgba(83, 83, 95, 0.55)";

type Style = "twitch-native" | "kick-native" | "unified";

interface PredictionBannerProps {
  prediction: UnifiedPrediction;
  onAutoDismiss?: () => void;
  onDismiss?: () => void;
}

export const PredictionBanner: React.FC<PredictionBannerProps> = ({
  prediction,
  onAutoDismiss,
  onDismiss,
}) => {
  const styleSetting = useAuthStore((s) => s.preferences?.predictions.style ?? "native");
  const [expanded, setExpanded] = useState(false);

  const style: Style = useMemo(() => {
    if (styleSetting === "unified") return "unified";
    return prediction.platform === "twitch" ? "twitch-native" : "kick-native";
  }, [styleSetting, prediction.platform]);

  const isEnded = prediction.status === "RESOLVED" || prediction.status === "CANCELED";
  const isLocked = prediction.status === "LOCKED";

  const onAutoDismissRef = useRef(onAutoDismiss);
  useEffect(() => {
    onAutoDismissRef.current = onAutoDismiss;
  }, [onAutoDismiss]);

  useEffect(() => {
    if (!isEnded) return;
    const t = setTimeout(() => {
      onAutoDismissRef.current?.();
    }, ENDED_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [isEnded, prediction.id]);

  useEffect(() => {
    setExpanded(false);
  }, [prediction.id]);

  return (
    <section
      data-testid="prediction-banner"
      data-status={prediction.status}
      data-style={style}
      data-platform={prediction.platform}
      className="border-b border-black/40 bg-[#1f1f23]"
    >
      {!expanded ? (
        <CollapsedView
          prediction={prediction}
          style={style}
          isEnded={isEnded}
          isLocked={isLocked}
          onExpand={() => setExpanded(true)}
          onDismiss={onDismiss}
        />
      ) : isEnded ? (
        <EndedPanel
          prediction={prediction}
          style={style}
          onCollapse={() => setExpanded(false)}
          onDismiss={onDismiss}
        />
      ) : (
        <ActivePanel
          prediction={prediction}
          style={style}
          isLocked={isLocked}
          onCollapse={() => setExpanded(false)}
          onDismiss={onDismiss}
        />
      )}
    </section>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// COLLAPSED
// ────────────────────────────────────────────────────────────────────────────

interface CollapsedProps {
  prediction: UnifiedPrediction;
  style: Style;
  isEnded: boolean;
  isLocked: boolean;
  onExpand: () => void;
  onDismiss?: () => void;
}

const CollapsedView: React.FC<CollapsedProps> = ({
  prediction,
  style,
  isEnded,
  isLocked,
  onExpand,
  onDismiss,
}) => {
  const totalAmount = sumAmount(prediction);
  const leader = topOutcome(prediction);
  const { locksAtMs, windowMs } = predictionCountdown(prediction);
  const ctaLabel = isEnded ? "View Result" : prediction.platform === "twitch" ? "See Details" : "Predict";

  // Twitch shows two header layouts:
  //   1. Fresh / no top predictors → "Predict with Channel Points" / bold title
  //   2. Once top predictors exist → "Predict with Channel Points" / [icon]
  //      "{amount} go to {user} and {N} others"
  // We render the same two-row layout for kick-native and unified, just with
  // their own platform-themed subtitle copy and icon color.
  return (
    <div className="px-2.5 pt-2 pb-1.5">
      <div className="flex items-start gap-2">
        <CollapsedHeaderText
          prediction={prediction}
          style={style}
          isEnded={isEnded}
          totalAmount={totalAmount}
          leader={leader}
        />
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onExpand}
            aria-label={ctaLabel}
            className={ctaPillClass(style)}
          >
            {ctaLabel}
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss prediction"
              title="Dismiss"
              className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-white/10"
              data-testid="prediction-dismiss"
            >
              {VerticalDotsIcon}
            </button>
          )}
        </div>
      </div>
      {!isEnded && (
        <TimeRemainingBar
          style={style}
          isLocked={isLocked}
          thick
          locksAtMs={locksAtMs}
          windowMs={windowMs}
        />
      )}
      {isLocked && <span className="sr-only">Locked</span>}
    </div>
  );
};

const CollapsedHeaderText: React.FC<{
  prediction: UnifiedPrediction;
  style: Style;
  isEnded: boolean;
  totalAmount: number;
  leader: UnifiedPredictionOutcome | null;
}> = ({ prediction, style, isEnded, totalAmount, leader }) => {
  const subtitle = headerSubtitle(prediction, style);
  const detail = isEnded
    ? endedTeaser(prediction, totalAmount)
    : detailTeaser(prediction, totalAmount, leader, style);

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <p className="truncate text-[12px] leading-[1.4] text-[#efeff1]">
        {subtitle}
      </p>
      <div
        className="mt-0.5 truncate text-[18px] font-medium leading-[1.1] tracking-[-0.18px] text-[#efeff1]"
        title={prediction.title}
      >
        {prediction.title}
      </div>
      {detail && (
        <div className="mt-1 truncate text-[12px] leading-tight text-[#adadb8]">
          {detail}
        </div>
      )}
    </div>
  );
};

function headerSubtitle(prediction: UnifiedPrediction, style: Style): string {
  if (prediction.status === "CANCELED") return "Refunded";
  if (prediction.status === "RESOLVED") return "Result";
  if (prediction.status === "LOCKED") {
    return style === "kick-native" ? "Predictions locked" : "Submissions closed";
  }
  if (style === "kick-native") return "Predict with KCP";
  if (style === "unified") return "Open prediction";
  return "Predict with Channel Points";
}

function detailTeaser(
  prediction: UnifiedPrediction,
  total: number,
  leader: UnifiedPredictionOutcome | null,
  style: Style,
): React.ReactNode {
  if (!leader || total <= 0) return null;
  if (style === "kick-native") {
    const a = prediction.outcomes[0];
    const b = prediction.outcomes[1];
    if (!a || !b) return null;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#53FC18]" aria-hidden />
        <span className="text-white">{short(a.totalAmount)}</span>
        <span className="text-zinc-500">vs</span>
        <span className="inline-block h-2 w-2 rounded-full bg-[#ff4f8c]" aria-hidden />
        <span className="text-white">{short(b.totalAmount)}</span>
      </span>
    );
  }
  // Twitch + unified: "<icon> {amount} go to {user} and {N} others"
  const topUser = leader.topPredictors?.[0]?.userName;
  if (topUser) {
    const others = (leader.topPredictors?.length ?? 1) - 1;
    return (
      <span className="inline-flex items-center gap-1.5">
        <ChannelPointsIcon size={14} />
        <span className="text-white">{short(total)}</span>
        <span>go to {topUser}</span>
        {others > 0 && <span>and {others} others</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <ChannelPointsIcon size={14} />
      <span className="text-white">{short(total)}</span>
      <span>contributed</span>
    </span>
  );
}

function endedTeaser(prediction: UnifiedPrediction, total: number): React.ReactNode {
  const winner = prediction.outcomes.find((o) => o.id === prediction.winningOutcomeId);
  if (winner) {
    return (
      <span>
        Winner: <span className="text-white">{winner.title}</span> · {short(total)} pool
      </span>
    );
  }
  if (prediction.status === "CANCELED") return "Refunded to predictors";
  return `${short(total)} pool`;
}

// ────────────────────────────────────────────────────────────────────────────
// EXPANDED — ACTIVE / LOCKED (read-only)
// ────────────────────────────────────────────────────────────────────────────

interface ActivePanelProps {
  prediction: UnifiedPrediction;
  style: Style;
  isLocked: boolean;
  onCollapse: () => void;
  onDismiss?: () => void;
}

const ActivePanel: React.FC<ActivePanelProps> = ({
  prediction,
  style,
  isLocked,
  onCollapse,
  onDismiss,
}) => {
  const { locksAtMs, windowMs } = predictionCountdown(prediction);

  return (
    <div className="px-2.5 pt-2 pb-3">
      <ExpandedHeader
        prediction={prediction}
        style={style}
        onCollapse={onCollapse}
        onDismiss={onDismiss}
      />

      <ul
        className="mt-3 mb-2 flex flex-col"
        data-testid="prediction-outcomes"
      >
        {prediction.outcomes.map((o, i) => (
          <ActiveOutcomeRow
            key={o.id}
            outcome={o}
            index={i}
            isWinner={o.id === prediction.winningOutcomeId}
            isViewerPick={o.id === prediction.viewerOutcomeId}
            style={style}
          />
        ))}
      </ul>

      <TimeRemainingBar
        style={style}
        isLocked={isLocked}
        thick={false}
        locksAtMs={locksAtMs}
        windowMs={windowMs}
      />

      {isLocked && (
        <div className="mt-3">
          <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Voting locked
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * One outcome row in the read-only expanded card. Mirrors twitch.tv's compact
 * layout: "{n}. {title}" on the left, "[icon] {amount}" on the right — at
 * 14px / #efeff1, with no per-row percentage. A check badge marks the winner
 * (only reachable from the resolved view) and the viewer's on-platform pick is
 * highlighted with a faint purple ring.
 */
const ActiveOutcomeRow: React.FC<{
  outcome: UnifiedPredictionOutcome;
  index: number;
  isWinner: boolean;
  isViewerPick: boolean;
  style: Style;
}> = ({ outcome, index, isWinner, isViewerPick, style }) => {
  return (
    <li
      data-testid={`prediction-outcome-${outcome.id}`}
      data-viewer-pick={isViewerPick || undefined}
      className={
        "flex items-center justify-between rounded text-[14px] leading-[1.4] " +
        (isViewerPick ? "bg-[#9147ff]/15 ring-1 ring-[#9147ff]/40" : "")
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex-shrink-0 text-[14px] text-[#efeff1]">
          {index + 1}.
        </span>
        <span className="truncate text-[#efeff1]">
          {outcome.title}
        </span>
        {isWinner && (
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white" aria-label="Winner">
            <CheckIcon size={10} />
          </span>
        )}
        {style === "kick-native" && (
          <span
            className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: kickDotColor(index) }}
            aria-hidden
          />
        )}
      </span>
      <span className="flex flex-shrink-0 items-center gap-[3px] tabular-nums text-[#efeff1]">
        <ChannelPointsIcon size={12} />
        <span>{short(outcome.totalAmount)}</span>
      </span>
    </li>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// EXPANDED — ENDED (RESOLVED / CANCELED)
// ────────────────────────────────────────────────────────────────────────────

const EndedPanel: React.FC<{
  prediction: UnifiedPrediction;
  style: Style;
  onCollapse: () => void;
  onDismiss?: () => void;
}> = ({ prediction, style, onCollapse, onDismiss }) => {
  const total = sumAmount(prediction);
  const endedAtLabel = endedRelativeLabel(prediction.endedAt);
  // Single accent for the resolved list, mirroring twitch.tv's "Prediction"
  // results panel: every outcome shares the prediction-blue, and the numbered
  // circles + "Winner" badge distinguish them rather than per-outcome colors.
  const accent = resolvedAccent(style);

  return (
    <div className="px-2.5 pt-2 pb-3">
      <ExpandedHeader
        prediction={prediction}
        style={style}
        onCollapse={onCollapse}
        onDismiss={onDismiss}
      />

      <div className="mt-2 text-[12px] text-[#adadb8]">
        {prediction.status === "CANCELED"
          ? "Prediction canceled — refunded"
          : `Prediction ended ${endedAtLabel}`}
      </div>

      {/* All outcomes in declaration order — supports 3+ results like twitch.tv. */}
      <div className="mt-3 flex flex-col gap-3" data-testid="prediction-outcomes">
        {prediction.outcomes.map((o, i) => (
          <EndedOutcomeRow
            key={o.id}
            outcome={o}
            index={i}
            total={total}
            isWinner={o.id === prediction.winningOutcomeId}
            accent={accent}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * One resolved-outcome row, mirroring twitch.tv's "Prediction" results panel:
 * a numbered circle + title on the left, a large percentage with the points
 * total beneath it on the right, a trailing chevron, and a full-width progress
 * bar underneath. The broadcaster-chosen winner (winningOutcomeId — not the
 * highest percentage) carries the "✓ Winner" badge above its row.
 */
const EndedOutcomeRow: React.FC<{
  outcome: UnifiedPredictionOutcome;
  index: number;
  total: number;
  isWinner: boolean;
  accent: string;
}> = ({ outcome, index, total, isWinner, accent }) => {
  const pct = total > 0 ? Math.round((outcome.totalAmount / total) * 100) : 0;
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid={`prediction-outcome-${outcome.id}`}
      data-winner={isWinner || undefined}
    >
      {isWinner && (
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-white text-[#0e0e10]">
            <CheckIcon size={11} />
          </span>
          Winner
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white tabular-nums"
            style={{ backgroundColor: accent }}
          >
            {index + 1}
          </span>
          <span
            className="truncate text-[16px] font-medium"
            style={{ color: accent }}
            title={outcome.title}
          >
            {outcome.title}
          </span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1.5">
          <span className="flex flex-col items-end leading-tight">
            <span className="text-[20px] font-semibold tabular-nums" style={{ color: accent }}>
              {pct}%
            </span>
            <span className="flex items-center gap-1 text-[12px] text-[#adadb8] tabular-nums">
              <ChannelPointsIcon size={12} />
              {short(outcome.totalAmount)}
            </span>
          </span>
          {ChevronRightIcon}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: TW_TRACK }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: accent }}
        />
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// SHARED — HEADER, PROGRESS BAR, ICONS
// ────────────────────────────────────────────────────────────────────────────

const ExpandedHeader: React.FC<{
  prediction: UnifiedPrediction;
  style: Style;
  onCollapse: () => void;
  onDismiss?: () => void;
}> = ({ prediction, style, onCollapse, onDismiss }) => {
  const subtitle = headerSubtitle(prediction, style);
  return (
    <header className="flex items-start gap-2">
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse prediction panel"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[#adadb8] transition-colors hover:bg-white/10 hover:text-white"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="truncate text-[12px] leading-[1.4] text-[#efeff1]">
          {subtitle}
        </p>
        <div
          className="mt-0.5 text-[18px] font-medium leading-[1.1] tracking-[-0.18px] text-[#efeff1]"
          title={prediction.title}
        >
          {prediction.title}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss prediction"
            title="Dismiss"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#adadb8] transition-colors hover:bg-white/10 hover:text-white"
            data-testid="prediction-dismiss-expanded"
          >
            {VerticalDotsIcon}
          </button>
        )}
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Close prediction panel"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#adadb8] transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  );
};

/**
 * Twitch-style time-remaining strip. Counts down from full to empty over the
 * prediction window using `locksAtMs` (the epoch ms when voting locks) and
 * `windowMs` (total window). When those anchors are unavailable (a payload
 * without `createdAt`) the bar falls back to a static full-when-active /
 * empty-when-locked indicator.
 */
const TimeRemainingBar: React.FC<{
  style: Style;
  isLocked: boolean;
  thick: boolean;
  locksAtMs: number | null;
  windowMs: number | null;
}> = ({ style, isLocked, thick, locksAtMs, windowMs }) => {
  const fillColor =
    style === "kick-native" ? "#53FC18" : style === "unified" ? "#dc143c" : TW_PURPLE_LIGHT;

  // Live countdown only when we have a real start anchor + window and voting is
  // still open. Otherwise the bar is static (full active / empty locked).
  const canCountdown =
    !isLocked && locksAtMs !== null && windowMs !== null && windowMs > 0;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!canCountdown) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [canCountdown, locksAtMs, windowMs]);

  let widthPct: number;
  if (isLocked) {
    widthPct = 0;
  } else if (canCountdown && locksAtMs !== null && windowMs !== null) {
    const remainingMs = Math.max(0, locksAtMs - now);
    widthPct = Math.min(100, Math.max(0, (remainingMs / windowMs) * 100));
  } else {
    widthPct = 100;
  }

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(widthPct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={"mt-2 w-full overflow-hidden rounded-full " + (thick ? "h-2" : "h-1")}
      style={{ backgroundColor: TW_TRACK }}
    >
      <div
        className={
          "h-full transition-[width] duration-500 " + (canCountdown ? "ease-linear" : "")
        }
        style={{ width: `${widthPct}%`, backgroundColor: fillColor }}
      />
    </div>
  );
};

const VerticalDotsIcon = (
  <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 5a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm0 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm2 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  </svg>
);

// Decorative trailing chevron on resolved-outcome rows (matches twitch.tv's
// results panel). Read-only — purely visual, hence aria-hidden.
const ChevronRightIcon = (
  <svg
    aria-hidden
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#adadb8"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const CheckIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12l5 5L20 7" />
  </svg>
);

/**
 * Twitch's prediction widget renders the channel-points icon as a CDN PNG that
 * comes from a per-channel asset URL. We don't have that asset on hand and
 * loading remote channel images for chrome would slow render. Instead, we draw
 * the recognizable filled-circle "P" mark Twitch uses as the generic
 * channel-points / KCP fallback.
 */
const ChannelPointsIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden focusable="false">
    <circle cx="10" cy="10" r="9" fill={TW_PURPLE} />
    <path
      d="M7.5 5.5h3.7c1.7 0 2.9 1.05 2.9 2.65 0 1.6-1.2 2.65-2.9 2.65H9.4v3.7H7.5v-9Zm3.5 4c.85 0 1.4-.5 1.4-1.35 0-.85-.55-1.35-1.4-1.35H9.4v2.7H11Z"
      fill="white"
    />
  </svg>
);

function ctaPillClass(style: Style): string {
  if (style === "twitch-native") {
    return "flex h-8 items-center justify-center rounded-full bg-[#9147ff] px-2 text-[14px] font-semibold text-white transition-colors hover:bg-[#772ce8]";
  }
  if (style === "kick-native") {
    return "flex h-8 items-center justify-center rounded-full bg-[#53FC18] px-2 text-[14px] font-semibold text-black transition-colors hover:bg-[#3dd912]";
  }
  return "flex h-8 items-center justify-center rounded-full bg-[#dc143c] px-2 text-[14px] font-semibold text-white transition-colors hover:opacity-90";
}

/**
 * Derive the countdown anchors for the time-remaining bar. `locksAtMs` is the
 * epoch ms when voting locks (`createdAt + window`); `windowMs` is the total
 * window in ms. `locksAtMs` is null when the prediction lacks a parseable
 * `createdAt` anchor — the bar then renders static instead of counting down.
 */
function predictionCountdown(prediction: UnifiedPrediction): {
  locksAtMs: number | null;
  windowMs: number | null;
} {
  const windowSeconds = prediction.predictionWindowSeconds;
  if (windowSeconds === null || windowSeconds <= 0) {
    return { locksAtMs: null, windowMs: null };
  }
  const windowMs = windowSeconds * 1000;
  const createdMs = prediction.createdAt ? Date.parse(prediction.createdAt) : Number.NaN;
  if (!Number.isFinite(createdMs)) {
    return { locksAtMs: null, windowMs };
  }
  return { locksAtMs: createdMs + windowMs, windowMs };
}

function sumAmount(prediction: UnifiedPrediction): number {
  return prediction.outcomes.reduce((sum, o) => sum + o.totalAmount, 0);
}

function topOutcome(prediction: UnifiedPrediction): UnifiedPredictionOutcome | null {
  if (prediction.outcomes.length === 0) return null;
  return prediction.outcomes.reduce(
    (a, b) => (b.totalAmount > a.totalAmount ? b : a),
    prediction.outcomes[0],
  );
}

function short(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function endedRelativeLabel(endedAt: string | null): string {
  if (!endedAt) return "moments ago";
  const t = Date.parse(endedAt);
  if (Number.isNaN(t)) return "moments ago";
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/**
 * Accent for the resolved-results list. Mirrors twitch.tv, whose "Prediction"
 * results panel renders every outcome in the prediction-blue (#4a8eff) — the
 * numbered circles and "Winner" badge carry the distinction, not per-outcome
 * colors. Kick and unified styles swap in their own brand accent.
 */
function resolvedAccent(style: Style): string {
  if (style === "kick-native") return "#53FC18";
  if (style === "unified") return "#dc143c";
  return "#4a8eff";
}

function kickDotColor(index: number): string {
  if (index === 0) return "#53FC18";
  if (index === 1) return "#ff4f8c";
  return "#6b7280";
}
