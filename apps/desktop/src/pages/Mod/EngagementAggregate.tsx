/**
 * U32 — Engagement aggregate (broadcaster only).
 *
 * Renders active predictions + polls for every channel the signed-in user
 * owns as broadcaster. The existing app architecture treats a Twitch identity
 * as the signed-in broadcaster — so there's effectively one channel
 * (the signed-in user's own channel) to iterate over.
 *
 * Giveaways were removed in commit b15bdec along with Streamlabs OAuth; this
 * page is predictions + polls only.
 *
 * Polling cadence: 30s. This is the meta page, lower priority than the
 * in-chat Engagement tab's 5s loop.
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
import { useAuthStore } from "@/store/auth-store";

import { useModRefreshCounter } from "./index";

const POLL_INTERVAL_MS = 30_000;

interface ChannelEngagement {
  channelId: string;
  channelLogin: string;
  prediction: PredictionPayload | null;
  poll: PollPayload | null;
  error: string | null;
}

async function fetchChannelEngagement(
  channelId: string,
  channelLogin: string,
  accessToken: string,
): Promise<ChannelEngagement> {
  const [predResult, pollResult] = await Promise.all([
    getPredictions({ accessToken, broadcasterId: channelId }),
    getPolls({ accessToken, broadcasterId: channelId }),
  ]);
  let error: string | null = null;
  if (!predResult.ok && !pollResult.ok) {
    error = predResult.message;
  }
  // Only surface ACTIVE/LOCKED predictions and ACTIVE polls — the meta page
  // is about *currently running* engagement, not historical entries.
  const prediction =
    predResult.ok
      ? predResult.payload.data.find(
          (p) => p.status === "ACTIVE" || p.status === "LOCKED",
        ) ?? null
      : null;
  const poll =
    pollResult.ok
      ? pollResult.payload.data.find((p) => p.status === "ACTIVE") ?? null
      : null;
  return { channelId, channelLogin, prediction, poll, error };
}

export function EngagementAggregate() {
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const refreshCounter = useModRefreshCounter();
  const [data, setData] = useState<ChannelEngagement[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const ownsChannels = Boolean(twitchUser?.id);

  const refetch = useCallback(async () => {
    if (!twitchUser?.id) return;
    setLoading(true);
    try {
      const token = await window.electronAPI.auth.getToken("twitch");
      if (!token?.accessToken) return;
      const channel = await fetchChannelEngagement(
        twitchUser.id,
        twitchUser.login,
        token.accessToken,
      );
      setData([channel]);
    } finally {
      setLoading(false);
    }
  }, [twitchUser?.id, twitchUser?.login]);

  // Initial fetch + refresh-counter pulls.
  useEffect(() => {
    if (!ownsChannels) return;
    void refetch();
  }, [ownsChannels, refetch, refreshCounter]);

  // 30s polling.
  useEffect(() => {
    if (!ownsChannels) return;
    const handle = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [ownsChannels, refetch]);

  if (!ownsChannels) return null;

  return (
    <section data-testid="engagement-aggregate">
      <h2 className="text-xl font-semibold mb-3 text-white">
        Active engagement
      </h2>
      {data.length === 0 && loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : null}
      <div className="space-y-3">
        {data.map((ch) => {
          const hasActivity = ch.prediction || ch.poll;
          return (
            <div
              key={ch.channelId}
              className="rounded border border-[var(--color-border)] bg-white/5 p-3"
              data-testid={`engagement-channel-${ch.channelId}`}
            >
              <div className="mb-2 text-sm font-medium text-white">
                {ch.channelLogin}
              </div>

              {ch.prediction ? (
                <div
                  className="mb-2"
                  data-testid={`engagement-prediction-${ch.channelId}`}
                >
                  <div className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]">
                    Prediction · {ch.prediction.status}
                  </div>
                  <div className="text-sm text-white">
                    {ch.prediction.title}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-foreground-muted)]">
                    {ch.prediction.outcomes.map((o) => (
                      <li key={o.id}>
                        • {o.title} — {o.channel_points.toLocaleString()} pts
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {ch.poll ? (
                <div data-testid={`engagement-poll-${ch.channelId}`}>
                  <div className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]">
                    Poll · {ch.poll.status}
                  </div>
                  <div className="text-sm text-white">{ch.poll.title}</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-foreground-muted)]">
                    {ch.poll.choices.map((c) => (
                      <li key={c.id}>
                        • {c.title} — {c.votes.toLocaleString()} votes
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!hasActivity ? (
                <p
                  className="text-sm text-gray-400"
                  data-testid={`engagement-empty-${ch.channelId}`}
                >
                  No active prediction or poll.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
