/**
 * U25 — Engagement → Predictions section.
 *
 * 5s-polled view of the broadcaster's most recent prediction.
 *
 *   - Empty / RESOLVED / CANCELED → "Create prediction" form.
 *   - ACTIVE  → live state with Lock / Cancel buttons.
 *   - LOCKED  → per-outcome "Choose winner" picker + Cancel.
 *
 * Lock / Resolve / Cancel each route through `ModActionConfirmDialog` so
 * irreversible actions get a confirm step. Successful actions write a row
 * to `mod_log` via U12's `modLogWriter.record({ source: "local", ... })`.
 *
 * Per the plan (decision #6) this is *polled*, not EventSub-driven — the
 * follow-up to swap is documented in the unit plan.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { modLogWriter } from "@backend/services/mod-log-writer";
import { useHelixPoll } from "@/hooks/useHelixPoll";
import type { TwitchPrediction } from "@shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

import { ModActionConfirmDialog } from "../ModActionConfirmDialog";

const POLL_INTERVAL_MS = 5_000;
const MAX_TITLE = 45;
const MIN_OUTCOMES = 2;
const MAX_OUTCOMES = 10;
const DEFAULT_DURATION_S = 120;
const DURATION_TICKS: Array<{
  value: number;
  labelKey: "chatModeration.durationSecondsShort" | "chatModeration.durationMinutesShort";
  count: number;
}> = [
  { value: 30, labelKey: "chatModeration.durationSecondsShort", count: 30 },
  { value: 60, labelKey: "chatModeration.durationMinutesShort", count: 1 },
  { value: 300, labelKey: "chatModeration.durationMinutesShort", count: 5 },
  { value: 1800, labelKey: "chatModeration.durationMinutesShort", count: 30 },
];

export interface EngagementPredictionsProps {
  channelId: string;
}

type PendingAction =
  | { kind: "lock" }
  | { kind: "cancel" }
  | { kind: "resolve"; outcomeId: string; outcomeTitle: string };

function isActive(p: TwitchPrediction | null | undefined): boolean {
  return p?.status === "ACTIVE";
}
function isLocked(p: TwitchPrediction | null | undefined): boolean {
  return p?.status === "LOCKED";
}

export function EngagementPredictions({ channelId }: EngagementPredictionsProps) {
  const { i18n, t } = useTranslation();
  const twitchUser = useAuthStore((s) => s.twitchUser);

  const fetcher = useCallback(async (): Promise<{ data: TwitchPrediction[] } | null> => {
    const result = await window.electronAPI.twitch.execute({
      operation: "get-predictions",
      broadcasterId: channelId,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.data as { data: TwitchPrediction[] };
  }, [channelId]);

  const { data, refresh } = useHelixPoll<{ data: TwitchPrediction[] } | null>({
    fetcher,
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
  });

  const current: TwitchPrediction | null = useMemo(() => {
    const first = data?.data?.[0];
    return first ?? null;
  }, [data]);

  // Form state for the create flow.
  const [formTitle, setFormTitle] = useState("");
  const [formOutcomes, setFormOutcomes] = useState<string[]>(["", ""]);
  const [formDuration, setFormDuration] = useState<number>(DEFAULT_DURATION_S);

  // Action state.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const channelSlug = twitchUser?.login ?? channelId;
  const moderatorUserId = twitchUser?.id ?? "";
  const moderatorUsername = twitchUser?.login ?? "";

  const handleCreate = async () => {
    const title = formTitle.trim();
    if (title.length === 0) {
      toast.error(t("chatModeration.titleRequired"));
      return;
    }
    const cleanedOutcomes = formOutcomes.map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleanedOutcomes.length < MIN_OUTCOMES) {
      toast.error(t("chatModeration.minOutcomesRequired", { count: MIN_OUTCOMES }));
      return;
    }
    setBusy(true);
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "create-prediction",
        broadcasterId: channelId,
        title,
        outcomes: cleanedOutcomes,
        predictionWindow: formDuration,
      });
      if (!result.ok) {
        toast.error(t("chatModeration.couldNotCreatePrediction", { error: result.error.message }));
        return;
      }
      modLogWriter.record({
        platform: "twitch",
        source: "local",
        channelId,
        channelSlug,
        action: "prediction-start",
        targetUserId: channelId,
        targetUsername: channelSlug,
        moderatorUserId,
        moderatorUsername,
        reason: title,
      });
      toast.success(t("chatModeration.predictionCreated"));
      setFormTitle("");
      setFormOutcomes(["", ""]);
      setFormDuration(DEFAULT_DURATION_S);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const runPending = async () => {
    if (!pending || !current) return;
    setBusy(true);
    try {
      let logAction: "prediction-lock" | "prediction-resolve" | "prediction-cancel";

      if (pending.kind === "lock") {
        logAction = "prediction-lock";
      } else if (pending.kind === "cancel") {
        logAction = "prediction-cancel";
      } else {
        logAction = "prediction-resolve";
      }
      const result = await window.electronAPI.twitch.execute({
        operation: "end-prediction",
        broadcasterId: channelId,
        predictionId: current.id,
        status:
          pending.kind === "lock" ? "LOCKED" : pending.kind === "cancel" ? "CANCELED" : "RESOLVED",
        ...(pending.kind === "resolve" ? { winningOutcomeId: pending.outcomeId } : {}),
      });
      if (!result.ok) {
        toast.error(t("chatModeration.actionFailed", { error: result.error.message }));
        return;
      }
      modLogWriter.record({
        platform: "twitch",
        source: "local",
        channelId,
        channelSlug,
        action: logAction,
        targetUserId: channelId,
        targetUsername: channelSlug,
        moderatorUserId,
        moderatorUsername,
        reason: pending.kind === "resolve" ? pending.outcomeTitle : current.title,
      });
      toast.success(
        pending.kind === "lock"
          ? t("chatModeration.predictionLocked")
          : pending.kind === "cancel"
            ? t("chatModeration.predictionCanceled")
            : t("chatModeration.predictionResolved", { outcome: pending.outcomeTitle })
      );
      setPending(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const totalPoints = useMemo(() => {
    if (!current) return 0;
    return current.outcomes.reduce((sum, o) => sum + o.channel_points, 0);
  }, [current]);

  const showCreateForm = !current || current.status === "RESOLVED" || current.status === "CANCELED";

  return (
    <section
      className="rounded border border-[var(--color-border)] bg-white/5 p-3"
      data-testid="engagement-predictions"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{t("chatModeration.predictions")}</h3>
        {current ? (
          <span
            className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]"
            data-testid="prediction-status"
          >
            {current.status}
          </span>
        ) : null}
      </header>

      {showCreateForm ? (
        <div className="flex flex-col gap-2" data-testid="prediction-create-form">
          <input
            type="text"
            aria-label={t("chatModeration.predictionTitle")}
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
            placeholder={t("chatModeration.whatsHappening")}
            className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
          />
          <div className="flex flex-col gap-1">
            {formOutcomes.map((value, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label={t("chatModeration.outcome", { index: idx + 1 })}
                  value={value}
                  onChange={(e) => {
                    const next = [...formOutcomes];
                    next[idx] = e.target.value.slice(0, 25);
                    setFormOutcomes(next);
                  }}
                  placeholder={t("chatModeration.outcome", { index: idx + 1 })}
                  className="flex-1 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
                />
                {formOutcomes.length > MIN_OUTCOMES ? (
                  <button
                    type="button"
                    onClick={() => setFormOutcomes(formOutcomes.filter((_, i) => i !== idx))}
                    className="text-xs text-[var(--color-foreground-muted)] hover:text-white"
                  >
                    {t("chatModeration.remove")}
                  </button>
                ) : null}
              </div>
            ))}
            {formOutcomes.length < MAX_OUTCOMES ? (
              <button
                type="button"
                onClick={() => setFormOutcomes([...formOutcomes, ""])}
                className="self-start text-xs text-[var(--color-storm-primary)] hover:underline"
              >
                {t("chatModeration.addOutcome")}
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-foreground-muted)]">
              {t("chatModeration.durationWithValue", {
                value:
                  formDuration < 60
                    ? t("chatModeration.durationSecondsShort", { count: formDuration })
                    : t("chatModeration.durationMinutesShort", {
                        count: Math.floor(formDuration / 60),
                      }),
              })}
            </label>
            <input
              type="range"
              min={1}
              max={1800}
              value={formDuration}
              onChange={(e) => setFormDuration(parseInt(e.target.value, 10))}
              className="w-full"
              aria-label={t("chatModeration.predictionDuration")}
            />
            <div className="flex justify-between text-[10px] text-[var(--color-foreground-muted)]">
              {DURATION_TICKS.map((tick) => (
                <button
                  key={tick.value}
                  type="button"
                  onClick={() => setFormDuration(tick.value)}
                  className="hover:text-white"
                >
                  {t(tick.labelKey, { count: tick.count })}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="self-end rounded bg-[#9146FF] px-3 py-1 text-sm text-white hover:bg-[#9146FF]/90 disabled:opacity-50"
          >
            {busy ? t("chatModeration.creating") : t("chatModeration.create")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-white">{current?.title}</div>
          <ul className="flex flex-col gap-1" data-testid="prediction-outcomes">
            {current?.outcomes.map((o) => {
              const pct = totalPoints > 0 ? Math.round((o.channel_points / totalPoints) * 100) : 0;
              return (
                <li
                  key={o.id}
                  className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm"
                  data-testid={`prediction-outcome-${o.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{o.title}</span>
                    <span className="text-xs text-[var(--color-foreground-muted)]">
                      {totalPoints > 0
                        ? t("chatModeration.pointsViewersWithPercentage", {
                            points: o.channel_points.toLocaleString(
                              i18n.resolvedLanguage ?? i18n.language
                            ),
                            count: o.users,
                            percent: pct,
                          })
                        : t("chatModeration.pointsAndViewers", {
                            points: o.channel_points.toLocaleString(
                              i18n.resolvedLanguage ?? i18n.language
                            ),
                            count: o.users,
                          })}
                    </span>
                  </div>
                  {isLocked(current) ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPending({
                          kind: "resolve",
                          outcomeId: o.id,
                          outcomeTitle: o.title,
                        })
                      }
                      className="mt-1 rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-600/90"
                    >
                      {t("chatModeration.chooseWinner")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2">
            {isActive(current) ? (
              <button
                type="button"
                onClick={() => setPending({ kind: "lock" })}
                className="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-600/90"
              >
                {t("chatModeration.lock")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPending({ kind: "cancel" })}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-600/90"
            >
              {t("chatModeration.cancel")}
            </button>
          </div>
        </div>
      )}

      {pending ? (
        <ModActionConfirmDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setPending(null);
          }}
          actionType={
            pending.kind === "lock"
              ? "predictionLock"
              : pending.kind === "cancel"
                ? "predictionCancel"
                : "predictionResolve"
          }
          targetPreview={
            <div>
              <div className="font-medium">
                {current?.title ?? t("chatModeration.noPrediction")}
              </div>
              {pending.kind === "resolve" ? (
                <div className="mt-1 text-xs text-[var(--color-foreground-muted)]">
                  {t("chatModeration.resolvedOutcome", { outcome: pending.outcomeTitle })}
                </div>
              ) : null}
            </div>
          }
          onConfirm={() => void runPending()}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
