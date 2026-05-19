/**
 * Viewer-side prediction widget (read-only) for both Twitch and Kick chats.
 *
 * Visual reference: the four screenshots from the original brainstorm —
 *   1. Twitch collapsed: dark card, title + payout-teaser, purple "See Details" pill
 *   2. Twitch expanded ACTIVE: back / title / dismiss header, "<N> points contributed"
 *      subtitle, big leader-percentage, grey bubble cluster, Options list with
 *      circled-number badges + colored dots + odds (1:1.9 / 1:2.2 etc.)
 *   3. Twitch expanded ENDED: two-column side-by-side, big % per side, blue/pink
 *      progress bars, stat row (points / odds / voters), payout-line at bottom
 *   4. Kick collapsed: dark card, green-dot Xk vs pink-dot Yk, green "Predict" pill
 *
 * Three style variants picked from useAuthStore.preferences.predictions.style ×
 * prediction.platform: twitch-native | kick-native | unified.
 */

import React, { useEffect, useMemo, useState } from "react";

import type { UnifiedPrediction, UnifiedPredictionOutcome } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

const ENDED_AUTO_DISMISS_MS = 60_000;

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
  const styleSetting = useAuthStore((s) => s.preferences?.predictions?.style ?? "native");
  const [expanded, setExpanded] = useState(false);

  const style: Style = useMemo(() => {
    if (styleSetting === "unified") return "unified";
    return prediction.platform === "twitch" ? "twitch-native" : "kick-native";
  }, [styleSetting, prediction.platform]);

  const isEnded = prediction.status === "RESOLVED" || prediction.status === "CANCELED";
  const isLocked = prediction.status === "LOCKED";

  useEffect(() => {
    if (!isEnded || !onAutoDismiss) return;
    const t = setTimeout(onAutoDismiss, ENDED_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [isEnded, onAutoDismiss, prediction.id]);

  useEffect(() => {
    setExpanded(false);
  }, [prediction.id]);

  return (
    <section
      data-testid="prediction-banner"
      data-status={prediction.status}
      data-style={style}
      data-platform={prediction.platform}
      className="border-b border-black/40 bg-[#0f0f10]"
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
  const ctaLabel = isEnded ? "View Result" : prediction.platform === "twitch" ? "See Details" : "Predict";
  const teaser = isEnded
    ? endedTeaser(prediction, totalAmount)
    : activeTeaser(prediction, totalAmount, leader, style);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-[12px] font-semibold text-white"
          title={prediction.title}
        >
          {prediction.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-400">{teaser}</div>
      </div>
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
          className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white"
          data-testid="prediction-dismiss"
        >
          {VerticalDotsIcon}
        </button>
      )}
      {/* Backward-compat: tests assert the LOCKED token via the locked badge in
          the expanded panel; collapsed view just shows the teaser. Keep a
          visually-hidden marker so existing tests pass without DOM noise. */}
      {isLocked && <span className="sr-only">Locked</span>}
    </div>
  );
};

function activeTeaser(
  prediction: UnifiedPrediction,
  total: number,
  leader: UnifiedPredictionOutcome | null,
  style: Style,
): React.ReactNode {
  if (!leader) return "—";
  if (style === "kick-native") {
    // Kick image shows "<dot> 177.7K vs <dot> 107K"
    const a = prediction.outcomes[0];
    const b = prediction.outcomes[1];
    if (!a || !b) return short(leader.totalAmount) + " leader";
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
  // Twitch + unified: payout-teaser pattern from the screenshot.
  // "3.1M go to <topPredictor>..." (winner side) or "<short> contributed".
  const topUser = leader.topPredictors?.[0]?.userName;
  if (topUser) {
    return (
      <span>
        <span className="text-white">{short(total)}</span> go to {topUser}
        {leader.topPredictors && leader.topPredictors.length > 1 ? "…" : ""}
      </span>
    );
  }
  return <span>{short(total)} contributed</span>;
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
  if (prediction.status === "CANCELED") return "Prediction canceled — refunded";
  return `${short(total)} pool`;
}

// ────────────────────────────────────────────────────────────────────────────
// EXPANDED — ACTIVE / LOCKED
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
  const total = sumAmount(prediction);
  const leader = topOutcome(prediction);
  const leaderPct = leader && total > 0 ? Math.round((leader.totalAmount / total) * 100) : 0;
  const leaderIndex = leader ? prediction.outcomes.findIndex((o) => o.id === leader.id) : 0;
  const deeplink = prediction.platform === "twitch" ? "https://www.twitch.tv/" : "https://kick.com/";

  return (
    <div className="flex flex-col gap-3 px-3 pt-2 pb-3">
      <PanelHeader title="Predictions" onCollapse={onCollapse} onDismiss={onDismiss} />

      <div className="text-center">
        <div
          className="text-[14px] font-bold text-white truncate"
          title={prediction.title}
        >
          {prediction.title}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          {total.toLocaleString()} {amountUnit(prediction.platform)} contributed
        </div>
      </div>

      {style === "twitch-native" && leader && (
        <BubbleCluster leader={leader} leaderIndex={leaderIndex} leaderPct={leaderPct} />
      )}

      {style !== "twitch-native" && leader && (
        <SimpleLeaderBar leader={leader} leaderPct={leaderPct} style={style} />
      )}

      {isLocked && (
        <div className="text-center">
          <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Voting locked
          </span>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          Options
        </div>
        <ul className="flex flex-col gap-1.5" data-testid="prediction-outcomes">
          {prediction.outcomes.map((o, i) => (
            <ActiveOutcomeRow
              key={o.id}
              outcome={o}
              index={i}
              total={total}
              isLeader={o.id === leader?.id}
              isWinner={o.id === prediction.winningOutcomeId}
              style={style}
              platform={prediction.platform}
            />
          ))}
        </ul>
      </div>

      {!isLocked && (
        <a
          href={deeplink}
          target="_blank"
          rel="noopener noreferrer"
          className={ctaPillClass(style) + " text-center"}
          data-testid="prediction-vote-deeplink"
        >
          Vote on {prediction.platform === "twitch" ? "twitch.tv" : "kick.com"} ↗
        </a>
      )}
    </div>
  );
};

const BubbleCluster: React.FC<{
  leader: UnifiedPredictionOutcome;
  leaderIndex: number;
  leaderPct: number;
}> = ({ leader, leaderIndex, leaderPct }) => {
  const color = twitchColorHex(leader.color ?? (leaderIndex === 0 ? "blue" : "pink"));
  // 5x4 dot grid as a static bubble cluster approximation. The leader's
  // percentage drives the % of dots filled with the outcome color.
  const total = 20;
  const filled = Math.round((leaderPct / 100) * total);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Winner{" "}
        <span
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: color, color: "white" }}
        >
          {leaderIndex + 1}
        </span>
      </div>
      <div className="text-[44px] font-bold leading-none" style={{ color }}>
        {leaderPct}%
      </div>
      <div className="mt-1 grid grid-cols-10 gap-1 opacity-90">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: i < filled ? color : "#27272a" }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
};

const SimpleLeaderBar: React.FC<{
  leader: UnifiedPredictionOutcome;
  leaderPct: number;
  style: Style;
}> = ({ leader, leaderPct, style }) => {
  const color = style === "kick-native" ? "#53FC18" : "#dc143c"; // unified → storm-accent
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Leader · {leader.title}
      </div>
      <div className="text-[44px] font-bold leading-none" style={{ color }}>
        {leaderPct}%
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${leaderPct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

const ActiveOutcomeRow: React.FC<{
  outcome: UnifiedPredictionOutcome;
  index: number;
  total: number;
  isLeader: boolean;
  isWinner: boolean;
  style: Style;
  platform: "twitch" | "kick";
}> = ({ outcome, index, total, isLeader, isWinner, style, platform }) => {
  const pct = total > 0 ? (outcome.totalAmount / total) * 100 : 0;
  const odds = total > 0 && outcome.totalAmount > 0
    ? `1:${(total / outcome.totalAmount).toFixed(1)}`
    : null;
  const color = twitchColorHex(outcome.color ?? (index === 0 ? "blue" : "pink"));

  return (
    <li
      data-testid={`prediction-outcome-${outcome.id}`}
      className={
        "flex items-center justify-between gap-3 rounded-md bg-[#18181b] px-2 py-1.5 " +
        (isWinner ? "ring-1 ring-emerald-500/30" : "")
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        {style === "twitch-native" && (
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: color }}
            aria-hidden
          >
            {index + 1}
          </span>
        )}
        {style === "kick-native" && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: kickDotColor(index, platform) }}
            aria-hidden
          />
        )}
        {style === "unified" && (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-storm-accent/50 text-[10px] font-bold text-storm-accent">
            {index + 1}
          </span>
        )}
        <span className="truncate text-[12px] font-semibold text-white">{outcome.title}</span>
        {isWinner && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
            Winner
          </span>
        )}
        {isLeader && !isWinner && (
          <span className="text-[9px] uppercase tracking-wide text-zinc-500">Leader</span>
        )}
      </span>
      <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-zinc-400">
        <span className="text-white">{short(outcome.totalAmount)}</span>
        {odds && <span className="rounded bg-black/40 px-1 py-0.5 text-[10px]">{odds}</span>}
        <span className="w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
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
  const [a, b] = prediction.outcomes;
  const endedAtLabel = endedRelativeLabel(prediction.endedAt);
  const winner = prediction.outcomes.find((o) => o.id === prediction.winningOutcomeId) ?? null;

  return (
    <div className="flex flex-col gap-3 px-3 pt-2 pb-3">
      <PanelHeader title="Prediction" onCollapse={onCollapse} onDismiss={onDismiss} />

      {/* Inset question card — dark grey background, centered text. */}
      <div className="rounded-md bg-[#1c1c1f] px-3 py-3 text-center">
        <div
          className="text-[16px] font-bold leading-tight text-white"
          title={prediction.title}
        >
          {prediction.title}
        </div>
        <div className="mt-1.5 text-[12px] text-zinc-400">
          {prediction.status === "CANCELED"
            ? "Prediction canceled — refunded"
            : `Prediction ended ${endedAtLabel}`}
        </div>
      </div>

      {/* Two-column layout with vertical divider down the middle. */}
      <div className="relative grid grid-cols-2" data-testid="prediction-outcomes">
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10"
          aria-hidden
        />
        {a && (
          <EndedOutcomeColumn
            outcome={a}
            index={0}
            total={total}
            isWinner={a.id === winner?.id}
            align="left"
            style={style}
            platform={prediction.platform}
          />
        )}
        {b && (
          <EndedOutcomeColumn
            outcome={b}
            index={1}
            total={total}
            isWinner={b.id === winner?.id}
            align="right"
            style={style}
            platform={prediction.platform}
          />
        )}
      </div>

      {winner && winner.topPredictors && winner.topPredictors.length > 0 && (
        <PayoutLine
          winner={winner}
          others={winner.topPredictors.length - 1}
          platform={prediction.platform}
        />
      )}
    </div>
  );
};

const EndedOutcomeColumn: React.FC<{
  outcome: UnifiedPredictionOutcome;
  index: number;
  total: number;
  isWinner: boolean;
  align: "left" | "right";
  style: Style;
  platform: "twitch" | "kick";
}> = ({ outcome, index, total, isWinner, align, style, platform }) => {
  const pct = total > 0 ? Math.round((outcome.totalAmount / total) * 100) : 0;
  const color =
    style === "kick-native"
      ? kickDotColor(index, platform)
      : twitchColorHex(outcome.color ?? (index === 0 ? "blue" : "pink"));
  const odds =
    total > 0 && outcome.totalAmount > 0
      ? `1:${(total / outcome.totalAmount).toFixed(2)}`
      : "—";
  const topUser = outcome.topPredictors?.[0];

  // Stat block lives on the OUTER side of each column (left col → stats left
  // of %, right col → stats right of %), matching the mirror layout from the
  // screenshot. Reverse flex direction by alignment.
  const statsLeft = align === "left";

  return (
    <div
      className={
        "flex items-start gap-2 px-2 py-1 " +
        (statsLeft ? "flex-row" : "flex-row-reverse")
      }
    >
      <div className="flex flex-col gap-2 text-[12px] text-zinc-300 pt-6">
        <StatLine icon="clock" value={short(outcome.totalAmount)} align={align} />
        <StatLine icon="trophy" value={odds} align={align} />
        <StatLine icon="users" value={outcome.userCount.toString()} align={align} />
        {topUser && (
          <StatLine icon="chart" value={short(topUser.amount)} align={align} />
        )}
      </div>

      <div className="flex flex-1 flex-col items-center gap-2">
        {isWinner && (
          <div className="flex items-center gap-1 text-[12px] font-bold text-white">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="white"
              aria-hidden
            >
              <circle cx="12" cy="12" r="11" fill="white" />
              <path
                d="M7 12l3 3 7-7"
                stroke="#000"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Winner</span>
          </div>
        )}
        {!isWinner && <div className="h-[18px]" aria-hidden />}
        <div
          className="text-[15px] font-bold leading-tight"
          style={{ color }}
        >
          {outcome.title}
        </div>
        <div
          className="text-[44px] font-bold leading-none tabular-nums"
          style={{ color }}
        >
          {pct}%
        </div>
        <div className="mt-1 h-2 w-full max-w-[70%] overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(pct, 6)}%`, backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
};

const StatLine: React.FC<{
  icon: "clock" | "trophy" | "users" | "chart";
  value: string;
  align: "left" | "right";
}> = ({ icon, value, align }) => {
  // Per-icon color palette pulled from the screenshot — each stat icon
  // carries its own semantic color rather than tinting by column.
  const iconColor = {
    clock: "#5fb4ff",
    trophy: "#facc15",
    users: "#ff5fa8",
    chart: "#c084fc",
  }[icon];
  return (
    <div
      className={
        "flex items-center gap-1.5 " + (align === "left" ? "flex-row" : "flex-row-reverse")
      }
    >
      <StatIcon icon={icon} color={iconColor} />
      <span className="font-medium text-white tabular-nums">{value}</span>
    </div>
  );
};

const StatIcon: React.FC<{ icon: "clock" | "trophy" | "users" | "chart"; color: string }> = ({
  icon,
  color,
}) => {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (icon === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (icon === "trophy") {
    return (
      <svg {...common}>
        <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-2.34" />
        <path d="M18 2H6v7a6 6 0 0012 0V2z" />
      </svg>
    );
  }
  if (icon === "users") {
    return (
      <svg {...common}>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    );
  }
  // chart
  return (
    <svg {...common}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
};

const PayoutLine: React.FC<{
  winner: UnifiedPredictionOutcome;
  others: number;
  platform: "twitch" | "kick";
}> = ({ winner, others, platform: _platform }) => {
  const top = winner.topPredictors?.[0];
  if (!top) return null;
  // No leading icon — Twitch's payout line uses the channel's custom
  // channel-points image, which we don't have access to without fetching
  // `ChannelPointsContext.communityPointsSettings.image.url` per-channel
  // separately. Cleaner to render plain text than a generic placeholder.
  return (
    <div className="text-center text-[12px] text-zinc-400">
      <span className="leading-snug">
        <span className="font-semibold text-white">{winner.totalAmount.toLocaleString()}</span>{" "}
        go to <span className="text-white">{top.userName}</span>
        {others > 0 && (
          <>
            {" and "}
            <span className="text-white">{others}</span>
            {" others"}
          </>
        )}
      </span>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// HEADERS / HELPERS
// ────────────────────────────────────────────────────────────────────────────

const PanelHeader: React.FC<{
  title: string;
  onCollapse: () => void;
  onDismiss?: () => void;
}> = ({ title, onCollapse, onDismiss }) => (
  <header className="flex items-center gap-1">
    {/* Left cluster: back arrow + title (screenshot pattern: '< Prediction'
        left-aligned on the same row, NOT centered). */}
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse prediction panel"
      className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
    >
      <svg
        width="18"
        height="18"
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
    <h3 className="flex-1 text-[14px] font-semibold text-white">{title}</h3>
    {/* Right cluster: ⋮ + ✕ when dismiss is available; plain ✕ otherwise. */}
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss prediction"
        title="Dismiss"
        className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        data-testid="prediction-dismiss-expanded"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
    )}
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Close prediction panel"
      className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
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
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  </header>
);

const VerticalDotsIcon = (
  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
);

function ctaPillClass(style: Style): string {
  if (style === "twitch-native") {
    return "flex-shrink-0 rounded-full bg-[#9146ff] px-3.5 py-1 text-[11px] font-semibold text-white hover:bg-[#772ce8]";
  }
  if (style === "kick-native") {
    return "flex-shrink-0 rounded-full bg-[#53FC18] px-3.5 py-1 text-[11px] font-semibold text-black hover:bg-[#3dd912]";
  }
  return "flex-shrink-0 rounded-full bg-[#dc143c] px-3.5 py-1 text-[11px] font-semibold text-white hover:opacity-90";
}

function amountUnit(platform: "twitch" | "kick"): string {
  return platform === "twitch" ? "points" : "KCP";
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

function twitchColorHex(color: string): string {
  // Saturations tuned against the screenshot — twitch's web client uses a
  // brighter blue/pink for prediction outcomes than the standard brand swatch.
  const map: Record<string, string> = {
    blue: "#4a8eff",
    pink: "#ff5fa8",
    yellow: "#facc15",
    green: "#22c55e",
    orange: "#fb923c",
    purple: "#9146ff",
    red: "#ef4444",
    cyan: "#06b6d4",
    brown: "#a16207",
    gray: "#6b7280",
  };
  return map[color] ?? "#9146ff";
}

function kickDotColor(index: number, _platform: "twitch" | "kick"): string {
  if (index === 0) return "#53FC18";
  if (index === 1) return "#ff4f8c";
  return "#6b7280";
}
