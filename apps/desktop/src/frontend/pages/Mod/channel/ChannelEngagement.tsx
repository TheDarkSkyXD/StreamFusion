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
import { useTranslation } from "react-i18next";
import { useInterval } from "@/hooks/useInterval";
import type { TwitchPoll, TwitchPrediction } from "@shared/twitch-api-types";

const POLL_INTERVAL_MS = 30_000;

interface ChannelEngagementProps {
  broadcasterId: string;
  /** Bumped by parent's refresh button. */
  refreshCounter?: number;
}

export function ChannelEngagement({ broadcasterId, refreshCounter }: ChannelEngagementProps) {
  const { i18n, t } = useTranslation();
  const [prediction, setPrediction] = useState<TwitchPrediction | null>(null);
  const [poll, setPoll] = useState<TwitchPoll | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!broadcasterId) return;
    setLoading(true);
    try {
      const [predResult, pollResult] = await Promise.all([
        window.electronAPI.twitch.execute({ operation: "get-predictions", broadcasterId }),
        window.electronAPI.twitch.execute({ operation: "get-polls", broadcasterId }),
      ]);
      const predictions = predResult.ok
        ? ((predResult.data as { data: TwitchPrediction[] }).data ?? [])
        : [];
      const polls = pollResult.ok ? ((pollResult.data as { data: TwitchPoll[] }).data ?? []) : [];
      setPrediction(
        predictions.find((p) => p.status === "ACTIVE" || p.status === "LOCKED") ?? null
      );
      setPoll(polls.find((p) => p.status === "ACTIVE") ?? null);
    } finally {
      setLoading(false);
    }
  }, [broadcasterId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshCounter` is the re-fetch trigger; the body doesn't read it
  useEffect(() => {
    void refetch();
  }, [refetch, refreshCounter]);

  useInterval(refetch, broadcasterId ? POLL_INTERVAL_MS : null);

  const hasActivity = prediction || poll;

  return (
    <section data-testid="channel-engagement">
      <h2 className="text-xl font-semibold mb-3 text-white">{t("moderation.activeEngagement")}</h2>
      <div className="rounded border border-[var(--color-border)] bg-white/5 p-3">
        {loading && !hasActivity ? (
          <p className="text-sm text-neutral-400">{t("moderation.loading")}</p>
        ) : null}
        {prediction ? (
          <div className="mb-2" data-testid="channel-engagement-prediction">
            <div className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]">
              {t("moderation.predictionStatus", { status: prediction.status })}
            </div>
            <div className="text-sm text-white">{prediction.title}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-foreground-muted)]">
              {prediction.outcomes.map((o) => (
                <li key={o.id}>
                  {t("moderation.predictionOutcome", {
                    title: o.title,
                    formattedCount: o.channel_points.toLocaleString(
                      i18n.resolvedLanguage ?? i18n.language
                    ),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {poll ? (
          <div data-testid="channel-engagement-poll">
            <div className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]">
              {t("moderation.pollStatus", { status: poll.status })}
            </div>
            <div className="text-sm text-white">{poll.title}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-foreground-muted)]">
              {poll.choices.map((c) => (
                <li key={c.id}>
                  {t("moderation.pollChoice", {
                    title: c.title,
                    formattedCount: c.votes.toLocaleString(i18n.resolvedLanguage ?? i18n.language),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!hasActivity && !loading ? (
          <p className="text-sm text-neutral-400" data-testid="channel-engagement-empty">
            {t("moderation.noActiveEngagement")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
