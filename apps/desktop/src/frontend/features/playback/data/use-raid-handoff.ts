import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { watchRaidHandoffs } from "@backend/services/chat/raid-handoff-source";
import { channelByUsernameQueryOptions } from "@/features/discovery/data/queries/useChannels";
import { getStreamByChannelQueryOptions } from "@/features/discovery/data/queries/useStreams";
import { preloadStreamExperience } from "@/features/playback/routes/stream-route-preload";
import { useInterval } from "@/hooks/useInterval";
import {
  normalizeRaidChannelSlug,
  raidSourcesMatch,
  type RaidHandoffEvent,
  type RaidHandoffState,
  type RaidOffer,
  type RaidParticipation,
  type RaidSource,
  type RaidTarget,
} from "@shared/raid-handoff-types";

export interface UseRaidHandoffOptions {
  source: RaidSource | null;
  onJoin: (target: RaidTarget) => void | Promise<void>;
  isSourceCurrent: (source: RaidSource) => boolean;
  now?: () => number;
}

export interface RaidHandoffPopupModel {
  offer: RaidOffer;
  participation: RaidParticipation;
  audienceText?: string;
  remainingMs?: number;
  progressPercent?: number;
  stayHere: () => void;
  joinRaid: () => void;
}

export type RaidHandoffAction =
  | { type: "provider"; event: RaidHandoffEvent }
  | { type: "participation"; value: RaidParticipation }
  | { type: "deadline"; sessionId: string; occurredAt: number }
  | { type: "source-changed" };

const IDLE_RAID_HANDOFF_STATE: RaidHandoffState = { status: "idle" };

export function reduceRaidHandoff(
  state: RaidHandoffState,
  action: RaidHandoffAction
): RaidHandoffState {
  if (action.type === "source-changed") {
    return state.status === "pending"
      ? {
          status: "settled",
          sessionId: state.offer.sessionId,
          outcome: "source-changed",
        }
      : IDLE_RAID_HANDOFF_STATE;
  }

  if (action.type === "participation") {
    return state.status === "pending" ? { ...state, participation: action.value } : state;
  }

  if (action.type === "deadline") {
    if (
      state.status !== "pending" ||
      state.offer.sessionId !== action.sessionId ||
      state.offer.launchAuthority.kind !== "deadline" ||
      action.occurredAt < state.offer.launchAuthority.deadlineAt
    ) {
      return state;
    }
    return settlePending(state);
  }

  const event = action.event;
  if (event.phase === "offer") {
    if (
      state.status === "pending" &&
      state.offer.sessionId === event.offer.sessionId &&
      raidSourcesMatch(state.offer.source, event.offer.source)
    ) {
      return { ...state, offer: event.offer };
    }
    return { status: "pending", offer: event.offer, participation: "joining" };
  }

  if (state.status !== "pending" || !raidSourcesMatch(state.offer.source, event.source)) {
    return state;
  }
  if (event.phase === "signal-lost") {
    return {
      status: "settled",
      sessionId: state.offer.sessionId,
      outcome: "signal-lost",
    };
  }
  if (event.sessionId !== state.offer.sessionId) return state;
  if (event.phase === "cancel") {
    return { status: "settled", sessionId: event.sessionId, outcome: "cancelled" };
  }
  if (state.offer.launchAuthority.kind !== "provider-go") return state;
  return settlePending(state);
}

function settlePending(state: Extract<RaidHandoffState, { status: "pending" }>): RaidHandoffState {
  return state.participation === "joining"
    ? {
        status: "settled",
        sessionId: state.offer.sessionId,
        outcome: "joined",
        target: state.offer.target,
      }
    : { status: "settled", sessionId: state.offer.sessionId, outcome: "stayed" };
}

export function useRaidHandoff({
  source,
  onJoin,
  isSourceCurrent,
  now = Date.now,
}: UseRaidHandoffOptions): { popup: RaidHandoffPopupModel | null } {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reduceRaidHandoff, IDLE_RAID_HANDOFF_STATE);
  const [clockNow, setClockNow] = useState(now);
  const handledSessions = useRef(new Set<string>());
  const sourceIdentity = source ? raidSourceIdentity(source) : "none";

  useEffect(() => {
    dispatch({ type: "source-changed" });
    if (!source) return;
    return watchRaidHandoffs(source, (event) => dispatch({ type: "provider", event }));
  }, [source, sourceIdentity]);

  const offer = state.status === "pending" ? state.offer : null;
  const deadlineAt =
    offer?.launchAuthority.kind === "deadline" ? offer.launchAuthority.deadlineAt : null;

  useInterval(
    () => {
      const current = now();
      setClockNow(current);
      if (offer && deadlineAt !== null && current >= deadlineAt) {
        dispatch({ type: "deadline", sessionId: offer.sessionId, occurredAt: current });
      }
    },
    offer?.progress.kind === "timed" ? 100 : null
  );

  useEffect(() => {
    if (!offer) return;
    const target = offer.target;
    void queryClient.prefetchQuery(
      channelByUsernameQueryOptions(target.channelSlug, target.platform)
    );
    void queryClient.prefetchQuery(
      getStreamByChannelQueryOptions(target.channelSlug, target.platform)
    );
    void preloadStreamExperience(target.platform);
  }, [offer, queryClient]);

  useEffect(() => {
    if (state.status !== "settled" || state.outcome !== "joined") return;
    if (handledSessions.current.has(state.sessionId)) return;
    if (!source || !isSourceCurrent(source)) return;
    handledSessions.current.add(state.sessionId);
    void onJoin(state.target);
  }, [isSourceCurrent, onJoin, source, state]);

  const stayHere = useCallback(() => dispatch({ type: "participation", value: "staying" }), []);
  const joinRaid = useCallback(() => dispatch({ type: "participation", value: "joining" }), []);

  const popup = useMemo<RaidHandoffPopupModel | null>(() => {
    if (!offer || state.status !== "pending") return null;
    const timing = getRaidProgress(offer, clockNow);
    return {
      offer,
      participation: state.participation,
      audienceText: formatRaidAudience(offer),
      ...timing,
      stayHere,
      joinRaid,
    };
  }, [clockNow, joinRaid, offer, state, stayHere]);

  return { popup };
}

function getRaidProgress(
  offer: RaidOffer,
  currentTime: number
): Pick<RaidHandoffPopupModel, "remainingMs" | "progressPercent"> {
  if (offer.progress.kind !== "timed") return {};
  const duration = Math.max(1, offer.progress.endsAt - offer.progress.startedAt);
  const remainingMs = Math.max(0, offer.progress.endsAt - currentTime);
  return {
    remainingMs,
    progressPercent: Math.max(0, Math.min(100, (remainingMs / duration) * 100)),
  };
}

function formatRaidAudience(offer: RaidOffer): string | undefined {
  if (offer.audience.kind === "unknown") return undefined;
  const count = new Intl.NumberFormat().format(offer.audience.count);
  return offer.audience.kind === "raid-party"
    ? `${count} joining the raid`
    : `${count} watching ${offer.target.displayName} now`;
}

function raidSourceIdentity(source: RaidSource): string {
  const providerId = source.platform === "twitch" ? source.channelId : source.broadcasterUserId;
  return `${source.platform}:${providerId}:${normalizeRaidChannelSlug(source.channelSlug)}`;
}
