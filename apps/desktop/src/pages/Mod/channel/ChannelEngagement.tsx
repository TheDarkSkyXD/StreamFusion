/**
 * ChannelEngagement — active predictions + polls for a single channel.
 *
 * Replaces the cross-channel EngagementAggregate page. Renders only when
 * the signed-in user IS the broadcaster of this channel — the underlying
 * Helix endpoints reject non-broadcaster tokens.
 *
 * Polling cadence stays at 30s, mirroring the prior aggregate page.
 */

import { useCallback, useEffect, useState } from "react";

import {
  getPolls,
  type PollPayload,
} from "@/backend/api/platforms/twitch/twitch-helix-polls";
import {
  getPredictions,
  type PredictionPayload,
} from "@/backend/api/platforms/twitch/twitch-helix-predictions";

const POLL_INTERVAL_MS = 30_000;

interface ChannelEngagementProps {
  broadcasterId: string;
  /** Bumped by parent's refresh button. */
  refreshCounter?: number;
}

export function ChannelEngagement({
  broadcasterId,
  refreshCounter,
}: ChannelEngagementProps) {
  const [prediction, setPrediction] = useState<PredictionPayload | null>(null);
  const [poll, setPoll] = useState<PollPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!broadcasterId) return;
    setLoading(true);
    try {
      const token = await window.electronAPI.auth.getToken("twitch");
      if (!token?.accessToken) return;
      const [predResult, pollResult] = await Promise.all([
        getPredictions({ accessToken: token.accessToken, broadcasterId }),
        getPolls({ accessToken: token.accessToken, broadcasterId }),
      ]);
      setPrediction(
        predResult.ok
          ? predResult.payload.data.find(
              (p) => p.status === "ACTIVE" || p.status === "LOCKED",
            ) ?? null
          : null,
      );
      setPoll(
        pollResult.ok
          ? pollResult.payload.data.find((p) => p.status === "ACTIVE") ?? null
          : null,
      );
    } finally {
      setLoading(false);
    }
  }, [broadcasterId]);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshCounter]);

  useEffect(() => {
    if (!broadcasterId) return;
    const handle = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [broadcasterId, refetch]);

  const hasActivity = prediction || poll;

  return (
    <section data-testid="channel-engagement">
      <h2 className="text-xl font-semibold mb-3 text-white">Active engagement</h2>
      <div className="rounded border border-[var(--color-border)] bg-white/5 p-3">
        {loading && !hasActivity ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : null}
        {prediction ? (
          <div className="mb-2" data-testid="channel-engagement-prediction">
            <div className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]">
              Prediction · {prediction.status}
            </div>
            <div className="text-sm text-white">{prediction.title}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-foreground-muted)]">
              {prediction.outcomes.map((o) => (
                <li key={o.id}>
                  • {o.title} — {o.channel_points.toLocaleString()} pts
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {poll ? (
          <div data-testid="channel-engagement-poll">
            <div className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]">
              Poll · {poll.status}
            </div>
            <div className="text-sm text-white">{poll.title}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-foreground-muted)]">
              {poll.choices.map((c) => (
                <li key={c.id}>
                  • {c.title} — {c.votes.toLocaleString()} votes
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!hasActivity && !loading ? (
          <p className="text-sm text-gray-400" data-testid="channel-engagement-empty">
            No active prediction or poll.
          </p>
        ) : null}
      </div>
    </section>
  );
}
