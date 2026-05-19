/**
 * Viewer-side prediction widget (read-only) for both Twitch and Kick chats.
 *
 * Consumes a normalized `UnifiedPrediction` (typically emitted via
 * `twitchChatService` / `kickChatService` `predictionUpdate` event) and
 * renders three sequential states:
 *
 *   COLLAPSED — small banner above chat input, title + tally summary + CTA
 *   EXPANDED  — detail panel overlaying chat content, full outcome list +
 *               "Vote on twitch.tv / kick.com" deeplink CTA (read-only;
 *                vote submission lives on the platform's own site)
 *   ENDED     — winning outcome surfaced + final tally; auto-dismisses
 *
 * Three visual style variants, picked from `useAuthStore.preferences.predictions.style`
 * crossed with `prediction.platform`:
 *
 *   twitch-native — purple primary, color-keyed left-side blocks on outcomes
 *   kick-native   — green/pink dot pair on outcomes 1-2; no side blocks
 *   unified       — storm-accent neutral, numbered tag badges
 */

import React, { useEffect, useMemo, useState } from "react";

import type { UnifiedPrediction, UnifiedPredictionOutcome } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

// Per-platform ended-state display window. Twitch and Kick both keep the
// resolved card visible briefly before dismissing — exact native windows
// will be confirmed during the first live-capture but ~60s matches the
// observed behavior in both clients today.
const ENDED_AUTO_DISMISS_MS = 60_000;

/**
 * Platform color name → Tailwind class lookup for outcome side-blocks
 * (Twitch native) and dot pairs (Kick native). Multi-outcome (3-10) Twitch
 * predictions cycle through the sequential palette below.
 */
const TWITCH_OUTCOME_COLOR_CLASS: Record<string, string> = {
  blue: "bg-twitch-blue",
  pink: "bg-twitch-pink",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
  orange: "bg-orange-500",
  purple: "bg-twitch",
  red: "bg-red-500",
  cyan: "bg-cyan-500",
  brown: "bg-amber-700",
  gray: "bg-gray-500",
};

type Style = "twitch-native" | "kick-native" | "unified";

interface PredictionBannerProps {
  prediction: UnifiedPrediction;
  /** Fired when the widget self-dismisses (ended-state window elapses, or
   *  parent should clear state). Parent controls the underlying data —
   *  the widget only reports its intent to unmount. */
  onAutoDismiss?: () => void;
}

export const PredictionBanner: React.FC<PredictionBannerProps> = ({
  prediction,
  onAutoDismiss,
}) => {
  const styleSetting = useAuthStore((s) => s.preferences?.predictions?.style ?? "native");
  const [expanded, setExpanded] = useState(false);

  const style: Style = useMemo(() => {
    if (styleSetting === "unified") return "unified";
    return prediction.platform === "twitch" ? "twitch-native" : "kick-native";
  }, [styleSetting, prediction.platform]);

  const totalAmount = useMemo(
    () => prediction.outcomes.reduce((sum, o) => sum + o.totalAmount, 0),
    [prediction.outcomes],
  );

  const isEnded = prediction.status === "RESOLVED" || prediction.status === "CANCELED";
  const isLocked = prediction.status === "LOCKED";

  // Auto-dismiss ended state after the native window. Resets when a new
  // prediction with a different id arrives.
  useEffect(() => {
    if (!isEnded || !onAutoDismiss) return;
    const t = setTimeout(onAutoDismiss, ENDED_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [isEnded, onAutoDismiss, prediction.id]);

  // Channel switch / new prediction collapses the panel — never carry
  // expanded state across predictions.
  useEffect(() => {
    setExpanded(false);
  }, [prediction.id]);

  const platformCta =
    prediction.platform === "twitch"
      ? "See Details"
      : prediction.platform === "kick"
        ? "Predict"
        : "View Prediction";

  return (
    <section
      data-testid="prediction-banner"
      data-status={prediction.status}
      data-style={style}
      data-platform={prediction.platform}
      className={containerClass(style)}
    >
      {!expanded ? (
        <CollapsedView
          prediction={prediction}
          totalAmount={totalAmount}
          style={style}
          isEnded={isEnded}
          isLocked={isLocked}
          ctaLabel={platformCta}
          onExpand={() => setExpanded(true)}
        />
      ) : (
        <ExpandedView
          prediction={prediction}
          totalAmount={totalAmount}
          style={style}
          isEnded={isEnded}
          isLocked={isLocked}
          onCollapse={() => setExpanded(false)}
        />
      )}
    </section>
  );
};

function containerClass(style: Style): string {
  const base =
    "flex flex-col border-b border-[var(--color-border)] text-sm overflow-hidden";
  if (style === "twitch-native") {
    return `${base} bg-twitch/10`;
  }
  if (style === "kick-native") {
    return `${base} bg-kick/10`;
  }
  return `${base} bg-storm-accent/10`;
}

interface ViewProps {
  prediction: UnifiedPrediction;
  totalAmount: number;
  style: Style;
  isEnded: boolean;
  isLocked: boolean;
}

const CollapsedView: React.FC<
  ViewProps & { ctaLabel: string; onExpand: () => void }
> = ({ prediction, totalAmount, style, isEnded, isLocked, ctaLabel, onExpand }) => {
  const top2 = prediction.outcomes.slice(0, 2);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-foreground-muted)]">
            {isEnded ? (prediction.status === "RESOLVED" ? "Resolved" : "Canceled") : isLocked ? "Locked" : "Predict"}
          </span>
          <span className="truncate text-sm font-semibold text-white" title={prediction.title}>
            {prediction.title}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-foreground-muted)]">
          {top2.map((o, i) => (
            <React.Fragment key={o.id}>
              {i > 0 && <span aria-hidden>/</span>}
              <span className="inline-flex items-center gap-1">
                <span className={outcomeMarkerClass(o, i, style)} aria-hidden />
                <span className={i === winningIndex(prediction) ? "text-white" : ""}>
                  {percentLabel(o, totalAmount)}
                </span>
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onExpand}
        className={ctaButtonClass(style)}
        aria-label={ctaLabel}
      >
        {ctaLabel} ▸
      </button>
    </div>
  );
};

const ExpandedView: React.FC<ViewProps & { onCollapse: () => void }> = ({
  prediction,
  totalAmount,
  style,
  isEnded,
  isLocked,
  onCollapse,
}) => {
  const deeplinkUrl =
    prediction.platform === "twitch"
      ? "https://www.twitch.tv/"
      : "https://kick.com/";

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse prediction panel"
          className="text-xs text-[var(--color-foreground-muted)] hover:text-white"
        >
          ← Back
        </button>
        <h3 className="text-sm font-bold text-white truncate" title={prediction.title}>
          {prediction.title}
        </h3>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Close prediction panel"
          className="text-xs text-[var(--color-foreground-muted)] hover:text-white"
        >
          ✕
        </button>
      </header>

      <div className="text-xs text-[var(--color-foreground-muted)]">
        {totalAmount.toLocaleString()} {amountUnit(prediction.platform)} contributed
        {isLocked && <span className="ml-2 rounded bg-amber-600/20 px-2 py-0.5 text-amber-300">Voting locked</span>}
        {prediction.status === "RESOLVED" && (
          <span className="ml-2 rounded bg-green-600/20 px-2 py-0.5 text-green-300">Resolved</span>
        )}
        {prediction.status === "CANCELED" && (
          <span className="ml-2 rounded bg-red-600/20 px-2 py-0.5 text-red-300">Canceled — refunded</span>
        )}
      </div>

      <ul className="flex flex-col gap-2" data-testid="prediction-outcomes">
        {prediction.outcomes.map((o, i) => (
          <OutcomeRow
            key={o.id}
            outcome={o}
            index={i}
            totalAmount={totalAmount}
            isWinner={o.id === prediction.winningOutcomeId}
            style={style}
            platform={prediction.platform}
          />
        ))}
      </ul>

      {!isEnded && !isLocked && (
        <a
          href={`${deeplinkUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className={ctaButtonClass(style) + " text-center"}
          data-testid="prediction-vote-deeplink"
        >
          Vote on {prediction.platform === "twitch" ? "twitch.tv" : "kick.com"} ↗
        </a>
      )}
    </div>
  );
};

interface OutcomeRowProps {
  outcome: UnifiedPredictionOutcome;
  index: number;
  totalAmount: number;
  isWinner: boolean;
  style: Style;
  platform: "twitch" | "kick";
}

const OutcomeRow: React.FC<OutcomeRowProps> = ({
  outcome,
  index,
  totalAmount,
  isWinner,
  style,
  platform,
}) => {
  const pct = totalAmount > 0 ? (outcome.totalAmount / totalAmount) * 100 : 0;
  const odds =
    totalAmount > 0 && outcome.totalAmount > 0
      ? `1:${(totalAmount / outcome.totalAmount).toFixed(2)}`
      : null;

  return (
    <li
      data-testid={`prediction-outcome-${outcome.id}`}
      className={
        "flex flex-col rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 " +
        (isWinner ? "ring-1 ring-green-500/40" : "")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className={outcomeMarkerClass(outcome, index, style)} aria-hidden />
          <span className="truncate text-sm font-medium text-white">{outcome.title}</span>
          {isWinner && (
            <span className="rounded bg-green-600/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-300">
              Winner
            </span>
          )}
        </span>
        <span className="text-xs text-[var(--color-foreground-muted)]">
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--color-foreground-muted)]">
        <span>
          {outcome.totalAmount.toLocaleString()} {amountUnit(platform)} · {outcome.userCount} {outcome.userCount === 1 ? "voter" : "voters"}
        </span>
        {odds && style !== "kick-native" && <span>{odds}</span>}
      </div>
      {outcome.topPredictors && outcome.topPredictors.length > 0 && style === "twitch-native" && (
        <div className="mt-1 text-[10px] text-[var(--color-foreground-muted)]">
          {outcome.topPredictors[0].userName} ({outcome.topPredictors[0].amount.toLocaleString()})
          {outcome.topPredictors.length > 1 && ` and ${outcome.topPredictors.length - 1} others`}
        </div>
      )}
    </li>
  );
};

/**
 * Color-keyed side-block for Twitch-native; green/pink dot for Kick-native
 * outcomes 1-2; small storm-accent numbered tag for unified.
 */
function outcomeMarkerClass(
  outcome: UnifiedPredictionOutcome,
  index: number,
  style: Style,
): string {
  if (style === "twitch-native") {
    const cls = outcome.color
      ? TWITCH_OUTCOME_COLOR_CLASS[outcome.color]
      : TWITCH_OUTCOME_COLOR_CLASS[index === 0 ? "blue" : "pink"];
    return `inline-block w-1 self-stretch ${cls ?? "bg-twitch"}`;
  }
  if (style === "kick-native") {
    if (index === 0) return "inline-block h-2 w-2 rounded-full bg-kick";
    if (index === 1) return "inline-block h-2 w-2 rounded-full bg-twitch-pink";
    // Outcomes 3+ on Kick native — fall back to a neutral dot since Kick UI
    // doesn't define colors past 2.
    return "inline-block h-2 w-2 rounded-full bg-gray-500";
  }
  // unified
  return "inline-flex h-4 w-4 items-center justify-center rounded border border-storm-accent/40 text-[10px] font-semibold text-storm-accent";
}

function ctaButtonClass(style: Style): string {
  if (style === "twitch-native") {
    return "rounded bg-twitch px-3 py-1 text-xs font-semibold text-white hover:bg-twitch-dark";
  }
  if (style === "kick-native") {
    return "rounded bg-kick px-3 py-1 text-xs font-semibold text-black hover:bg-kick-dark";
  }
  return "rounded bg-storm-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90";
}

function amountUnit(platform: "twitch" | "kick"): string {
  return platform === "twitch" ? "points" : "KCP";
}

function percentLabel(outcome: UnifiedPredictionOutcome, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((outcome.totalAmount / total) * 100)}%`;
}

function winningIndex(prediction: UnifiedPrediction): number {
  if (!prediction.winningOutcomeId) return -1;
  return prediction.outcomes.findIndex((o) => o.id === prediction.winningOutcomeId);
}
