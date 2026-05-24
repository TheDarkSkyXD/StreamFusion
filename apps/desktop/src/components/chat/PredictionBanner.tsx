/**
 * Viewer-side prediction widget (read-only) for both Twitch and Kick chats.
 *
 * The `twitch-native` branch mirrors the real twitch.tv community-highlight
 * card captured live from `https://www.twitch.tv/lirik` (2026-05-23): the
 * "Predict with Channel Points" subtitle, bold title, purple pill CTA,
 * vertical-dots overflow, expanded outcome rows ("1. Title  [icon] amount"),
 * and the slim purple progress bar.
 *
 * Three style variants picked from useAuthStore.preferences.predictions.style ×
 * prediction.platform: twitch-native | kick-native | unified.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  PredictionVoteForm,
  type PredictionVoteFormBalance,
} from "@/components/chat/PredictionVoteForm";
import {
  clearForChannel,
  clearForPrediction,
} from "@/lib/prediction-vote-gate";
import type { UnifiedPrediction, UnifiedPredictionOutcome } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

const ENDED_AUTO_DISMISS_MS = 60_000;
/**
 * `localVoteSubmittedAt` window — see plan U5. After a successful vote,
 * suppress incoming `viewerOutcomeId === null` updates for this many ms so
 * the just-cast vote doesn't get visually "uncast" by a poll-tick echo.
 */
const LOCAL_VOTE_SUPPRESSION_MS = 10_000;

// Twitch palette captured from live computed styles on twitch.tv/lirik.
const TW_PURPLE = "#9146ff";
const TW_PURPLE_LIGHT = "#a970ff";
const TW_TRACK = "rgba(83, 83, 95, 0.55)";

type Style = "twitch-native" | "kick-native" | "unified";

interface PredictionBannerProps {
  prediction: UnifiedPrediction;
  /**
   * Real channel slug (Kick) / login (Twitch) for the panel hosting this
   * banner. Used as the destination for vote-mutation API calls. Falls back
   * to `prediction.channelSlug`, but the dev-injection sentinel has an empty
   * channelSlug — so callers should always pass the real channel from their
   * own props to keep voting working against dev-injected predictions too.
   */
  channelLogin?: string;
  onAutoDismiss?: () => void;
  onDismiss?: () => void;
}

export const PredictionBanner: React.FC<PredictionBannerProps> = ({
  prediction,
  channelLogin,
  onAutoDismiss,
  onDismiss,
}) => {
  const styleSetting = useAuthStore((s) => s.preferences?.predictions.style ?? "native");
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const kickUser = useAuthStore((s) => s.kickUser);
  const [expanded, setExpanded] = useState(false);

  // Track the timestamp of the last successful local vote per prediction id.
  // When a `predictionUpdate` arrives with `viewerOutcomeId === null` within
  // LOCAL_VOTE_SUPPRESSION_MS of a successful vote, we suppress just that
  // field — other fields flow through unchanged.
  const localVoteSubmittedAtRef = useRef<Map<string, number>>(new Map());
  const [localViewer, setLocalViewer] = useState<{
    outcomeId: string;
    stake: number;
  } | null>(null);
  const [suppressionExpired, setSuppressionExpired] = useState(false);
  const suppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalViewer(null);
    setSuppressionExpired(false);
    if (suppressionTimerRef.current) {
      clearTimeout(suppressionTimerRef.current);
      suppressionTimerRef.current = null;
    }
  }, [prediction.id]);

  useEffect(() => {
    return () => {
      if (suppressionTimerRef.current) {
        clearTimeout(suppressionTimerRef.current);
      }
    };
  }, []);

  const effectiveViewerOutcomeId = useMemo(() => {
    if (prediction.viewerOutcomeId !== null) return prediction.viewerOutcomeId;
    if (!localViewer) return null;
    if (suppressionExpired) return null;
    const submittedAt = localVoteSubmittedAtRef.current.get(prediction.id);
    if (submittedAt && Date.now() - submittedAt < LOCAL_VOTE_SUPPRESSION_MS) {
      return localViewer.outcomeId;
    }
    return null;
  }, [prediction.id, prediction.viewerOutcomeId, localViewer, suppressionExpired]);

  const effectiveViewerStake = useMemo(() => {
    if (prediction.viewerStake !== null) return prediction.viewerStake;
    if (!localViewer) return null;
    if (suppressionExpired) return null;
    const submittedAt = localVoteSubmittedAtRef.current.get(prediction.id);
    if (submittedAt && Date.now() - submittedAt < LOCAL_VOTE_SUPPRESSION_MS) {
      return localViewer.stake;
    }
    return null;
  }, [prediction.id, prediction.viewerStake, localViewer, suppressionExpired]);

  const effectivePrediction = useMemo<UnifiedPrediction>(
    () => ({
      ...prediction,
      viewerOutcomeId: effectiveViewerOutcomeId,
      viewerStake: effectiveViewerStake,
    }),
    [prediction, effectiveViewerOutcomeId, effectiveViewerStake],
  );

  const style: Style = useMemo(() => {
    if (styleSetting === "unified") return "unified";
    return prediction.platform === "twitch" ? "twitch-native" : "kick-native";
  }, [styleSetting, prediction.platform]);

  const isEnded = prediction.status === "RESOLVED" || prediction.status === "CANCELED";
  const isLocked = prediction.status === "LOCKED";

  useEffect(() => {
    if (prediction.status === "RESOLVED" || prediction.status === "CANCELED") {
      clearForPrediction(prediction.id);
    }
  }, [prediction.status, prediction.id]);

  useEffect(() => {
    const slug = prediction.channelSlug;
    return () => {
      clearForChannel(slug);
    };
  }, [prediction.channelSlug]);

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

  const hasPlatformToken =
    prediction.platform === "twitch" ? !!twitchUser : !!kickUser;

  const handleVoteSuccess = (outcomeId: string, amount: number) => {
    localVoteSubmittedAtRef.current.set(prediction.id, Date.now());
    setLocalViewer({ outcomeId, stake: amount });
    setSuppressionExpired(false);
    if (suppressionTimerRef.current) clearTimeout(suppressionTimerRef.current);
    suppressionTimerRef.current = setTimeout(() => {
      setSuppressionExpired(true);
      suppressionTimerRef.current = null;
    }, LOCAL_VOTE_SUPPRESSION_MS);
  };

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
          prediction={effectivePrediction}
          style={style}
          isEnded={isEnded}
          isLocked={isLocked}
          onExpand={() => setExpanded(true)}
          onDismiss={onDismiss}
        />
      ) : isEnded ? (
        <EndedPanel
          prediction={effectivePrediction}
          style={style}
          onCollapse={() => setExpanded(false)}
          onDismiss={onDismiss}
        />
      ) : (
        <ActivePanel
          prediction={effectivePrediction}
          style={style}
          isLocked={isLocked}
          hasPlatformToken={hasPlatformToken}
          channelLogin={channelLogin}
          onCollapse={() => setExpanded(false)}
          onDismiss={onDismiss}
          onVoteSuccess={handleVoteSuccess}
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
      {!isEnded && <TimeRemainingBar style={style} isLocked={isLocked} thick />}
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
      <p className="truncate text-[12px] leading-tight text-[#adadb8]">
        {subtitle}
      </p>
      <div
        className="mt-0.5 truncate text-[15px] font-semibold leading-tight text-white"
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
// EXPANDED — ACTIVE / LOCKED
// ────────────────────────────────────────────────────────────────────────────

interface ActivePanelProps {
  prediction: UnifiedPrediction;
  style: Style;
  isLocked: boolean;
  hasPlatformToken: boolean;
  channelLogin?: string;
  onCollapse: () => void;
  onDismiss?: () => void;
  onVoteSuccess: (outcomeId: string, amount: number) => void;
}

const ActivePanel: React.FC<ActivePanelProps> = ({
  prediction,
  style,
  isLocked,
  hasPlatformToken,
  channelLogin,
  onCollapse,
  onDismiss,
  onVoteSuccess,
}) => {
  const total = sumAmount(prediction);
  const leader = topOutcome(prediction);
  const deeplink = prediction.platform === "twitch" ? "https://www.twitch.tv/" : "https://kick.com/";

  // Form-vs-deeplink branch rules (plan U5, unchanged):
  //   - Active + viewer hasn't voted + token present + real channel + Twitch → in-app form
  //   - Active + viewer hasn't voted + no token                              → deeplink
  //   - Active + viewer hasn't voted + token present + no real channel       → deeplink
  //   - Active + viewer hasn't voted + Kick                                  → deeplink
  //   - Active + viewer already voted                                        → neither
  //   - Locked                                                               → neither
  const KICK_IN_APP_VOTING_SUPPORTED = false;
  const viewerHasVoted = prediction.viewerOutcomeId !== null;
  const resolvedChannelLogin = (channelLogin ?? "").trim() || prediction.channelSlug.trim();
  const hasRealChannel = resolvedChannelLogin.length > 0;
  const platformSupportsInAppVote =
    prediction.platform === "twitch" || KICK_IN_APP_VOTING_SUPPORTED;
  const showVoteForm =
    !isLocked &&
    !viewerHasVoted &&
    hasPlatformToken &&
    hasRealChannel &&
    platformSupportsInAppVote;
  const showDeeplink = !isLocked && !viewerHasVoted && !showVoteForm;

  // TODO(predictions-backend U5): wire real balance fetches once U3 / U1 land.
  const balance: PredictionVoteFormBalance = {
    state: "failed",
    reason: "not implemented",
  };

  return (
    <div className="px-2.5 pt-2 pb-3">
      <ExpandedHeader
        prediction={prediction}
        style={style}
        onCollapse={onCollapse}
        onDismiss={onDismiss}
      />

      <ul
        className="mt-3 mb-2 flex flex-col gap-1"
        data-testid="prediction-outcomes"
      >
        {prediction.outcomes.map((o, i) => (
          <ActiveOutcomeRow
            key={o.id}
            outcome={o}
            index={i}
            total={total}
            isLeader={o.id === leader?.id}
            isWinner={o.id === prediction.winningOutcomeId}
            isViewerPick={o.id === prediction.viewerOutcomeId}
            style={style}
          />
        ))}
      </ul>

      <TimeRemainingBar style={style} isLocked={isLocked} thick={false} />

      {isLocked && (
        <div className="mt-3">
          <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Voting locked
          </span>
        </div>
      )}

      {showVoteForm && (
        <div className="mt-3">
          <PredictionVoteForm
            prediction={prediction}
            channelLogin={resolvedChannelLogin}
            balance={balance}
            onVoteSuccess={onVoteSuccess}
          />
        </div>
      )}

      {showDeeplink && (
        <a
          href={deeplink}
          target="_blank"
          rel="noopener noreferrer"
          className={"mt-3 block text-center " + ctaPillClass(style)}
          data-testid="prediction-vote-deeplink"
        >
          Vote on {prediction.platform === "twitch" ? "twitch.tv" : "kick.com"} ↗
        </a>
      )}
    </div>
  );
};

const ActiveOutcomeRow: React.FC<{
  outcome: UnifiedPredictionOutcome;
  index: number;
  total: number;
  isLeader: boolean;
  isWinner: boolean;
  isViewerPick: boolean;
  style: Style;
}> = ({ outcome, index, total, isLeader, isWinner, isViewerPick, style }) => {
  const pct = total > 0 ? Math.round((outcome.totalAmount / total) * 100) : 0;
  return (
    <li
      data-testid={`prediction-outcome-${outcome.id}`}
      data-viewer-pick={isViewerPick || undefined}
      className={
        "flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[13px] " +
        (isViewerPick ? "bg-[#9146ff]/15 ring-1 ring-[#9146ff]/40" : "")
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-4 flex-shrink-0 text-right text-[13px] font-medium text-[#adadb8]">
          {index + 1}.
        </span>
        <span className="truncate text-white">
          {outcome.title}
        </span>
        {isWinner && (
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white" aria-label="Winner">
            <CheckIcon size={10} />
          </span>
        )}
        {isLeader && !isWinner && (
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#adadb8]">
            Lead
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
      <span className="flex flex-shrink-0 items-center gap-1.5 tabular-nums text-white">
        <ChannelPointsIcon size={14} />
        <span>{short(outcome.totalAmount)}</span>
        <span className="ml-1 w-9 text-right text-[11px] text-[#adadb8]">{pct}%</span>
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
  const winner = prediction.outcomes.find((o) => o.id === prediction.winningOutcomeId) ?? null;
  // Hoist the winner into the visible pair for 3+ outcome predictions.
  let pair: UnifiedPredictionOutcome[] = prediction.outcomes.slice(0, 2);
  if (winner && !pair.some((o) => o.id === winner.id)) {
    pair = [pair[0], winner].filter(Boolean) as UnifiedPredictionOutcome[];
  }
  const [a, b] = pair;

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

      <div
        className="mt-3 grid grid-cols-2 gap-3"
        data-testid="prediction-outcomes"
      >
        {a && (
          <EndedOutcomeColumn
            outcome={a}
            index={0}
            total={total}
            isWinner={a.id === winner?.id}
            style={style}
          />
        )}
        {b && (
          <EndedOutcomeColumn
            outcome={b}
            index={1}
            total={total}
            isWinner={b.id === winner?.id}
            style={style}
          />
        )}
      </div>
    </div>
  );
};

const EndedOutcomeColumn: React.FC<{
  outcome: UnifiedPredictionOutcome;
  index: number;
  total: number;
  isWinner: boolean;
  style: Style;
}> = ({ outcome, index, total, isWinner, style }) => {
  const pct = total > 0 ? Math.round((outcome.totalAmount / total) * 100) : 0;
  const color =
    style === "kick-native"
      ? kickDotColor(index)
      : twitchColorHex(outcome.color ?? (index === 0 ? "blue" : "pink"));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[12px]">
        {isWinner ? (
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckIcon size={10} />
          </span>
        ) : (
          <span className="h-4 w-4 flex-shrink-0" aria-hidden />
        )}
        <span className="truncate font-semibold" style={{ color }} title={outcome.title}>
          {outcome.title}
        </span>
        {isWinner && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
            Winner
          </span>
        )}
      </div>
      <div
        className="text-[32px] font-bold leading-none tabular-nums"
        style={{ color }}
      >
        {pct}%
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-white tabular-nums">
        <ChannelPointsIcon size={12} />
        <span>{short(outcome.totalAmount)}</span>
        <span className="text-[#adadb8]">·</span>
        <span className="text-[#adadb8]">
          {outcome.userCount.toLocaleString()} predictor{outcome.userCount === 1 ? "" : "s"}
        </span>
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
        <p className="truncate text-[12px] leading-tight text-[#adadb8]">
          {subtitle}
        </p>
        <div
          className="mt-0.5 truncate text-[15px] font-semibold leading-tight text-white"
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
 * Twitch-style time-remaining strip. We don't have a real countdown timestamp
 * in `UnifiedPrediction` today (only `predictionWindowSeconds`), so the bar is
 * a visual indicator: full purple when active, drained when locked, hidden on
 * ended. When the backend grows a `lockedAt` / `windowEndsAt` field this can
 * animate the actual remaining ratio.
 */
const TimeRemainingBar: React.FC<{
  style: Style;
  isLocked: boolean;
  thick: boolean;
}> = ({ style, isLocked, thick }) => {
  const fillColor =
    style === "kick-native" ? "#53FC18" : style === "unified" ? "#dc143c" : TW_PURPLE_LIGHT;
  const widthPct = isLocked ? 0 : 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={widthPct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={"mt-2 w-full overflow-hidden rounded-full " + (thick ? "h-2" : "h-1")}
      style={{ backgroundColor: TW_TRACK }}
    >
      <div
        className="h-full transition-[width] duration-500"
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
    return "flex h-8 items-center justify-center rounded-full bg-[#9146ff] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#772ce8]";
  }
  if (style === "kick-native") {
    return "flex h-8 items-center justify-center rounded-full bg-[#53FC18] px-4 text-[13px] font-semibold text-black transition-colors hover:bg-[#3dd912]";
  }
  return "flex h-8 items-center justify-center rounded-full bg-[#dc143c] px-4 text-[13px] font-semibold text-white transition-colors hover:opacity-90";
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

function kickDotColor(index: number): string {
  if (index === 0) return "#53FC18";
  if (index === 1) return "#ff4f8c";
  return "#6b7280";
}
