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
import { toast } from "sonner";

import {
  cancelPrediction,
  createPrediction,
  getPredictions,
  lockPrediction,
  resolvePrediction,
  type PredictionPayload,
  type PredictionsListPayload,
} from "@/backend/api/platforms/twitch/twitch-helix-predictions";
import type { HelixModResult } from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import { modLogWriter } from "@/backend/services/mod-log-writer";
import { useHelixPoll } from "@/hooks/useHelixPoll";
import { useAuthStore } from "@/store/auth-store";

import { ModActionConfirmDialog } from "../ModActionConfirmDialog";

const POLL_INTERVAL_MS = 5_000;
const MAX_TITLE = 45;
const MIN_OUTCOMES = 2;
const MAX_OUTCOMES = 10;
const DEFAULT_DURATION_S = 120;
const DURATION_TICKS: Array<{ value: number; label: string }> = [
  { value: 30, label: "30s" },
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
  { value: 1800, label: "30m" },
];

export interface EngagementPredictionsProps {
  channelId: string;
}

type PendingAction =
  | { kind: "lock" }
  | { kind: "cancel" }
  | { kind: "resolve"; outcomeId: string; outcomeTitle: string };

function isActive(p: PredictionPayload | null | undefined): boolean {
  return p?.status === "ACTIVE";
}
function isLocked(p: PredictionPayload | null | undefined): boolean {
  return p?.status === "LOCKED";
}

async function getToken(): Promise<string | null> {
  const token = await window.electronAPI.auth.getToken("twitch");
  return token?.accessToken ?? null;
}

export function EngagementPredictions({ channelId }: EngagementPredictionsProps) {
  const twitchUser = useAuthStore((s) => s.twitchUser);

  const fetcher = useCallback(async (): Promise<PredictionsListPayload | null> => {
    const accessToken = await getToken();
    if (!accessToken) return null;
    const result = await getPredictions({ accessToken, broadcasterId: channelId });
    if (!result.ok) {
      // Surface as fetch error so the hook shows it.
      throw new Error(result.message);
    }
    return result.payload;
  }, [channelId]);

  const { data, refresh } = useHelixPoll<PredictionsListPayload | null>({
    fetcher,
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
  });

  const current: PredictionPayload | null = useMemo(() => {
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

  async function withMissingScopeHandling<T>(
    run: (token: string) => Promise<HelixModResult<T>>,
  ): Promise<HelixModResult<T> | null> {
    const accessToken = await getToken();
    if (!accessToken) {
      toast.error("Sign in to Twitch to take this action");
      return null;
    }
    return run(accessToken);
  }

  const handleCreate = async () => {
    const title = formTitle.trim();
    if (title.length === 0) {
      toast.error("Title is required");
      return;
    }
    const cleanedOutcomes = formOutcomes
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (cleanedOutcomes.length < MIN_OUTCOMES) {
      toast.error("At least 2 outcomes are required");
      return;
    }
    setBusy(true);
    try {
      const result = await withMissingScopeHandling((t) =>
        createPrediction({
          accessToken: t,
          broadcasterId: channelId,
          title,
          outcomes: cleanedOutcomes.map((o) => ({ title: o })),
          predictionWindow: formDuration,
        }),
      );
      if (!result) return;
      if (!result.ok) {
        toast.error(`Could not create prediction: ${result.message}`);
        return;
      }
      modLogWriter.record({
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
      toast.success("Prediction created");
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
      let result: HelixModResult<PredictionPayload> | null = null;
      let logAction: "prediction-lock" | "prediction-resolve" | "prediction-cancel";

      if (pending.kind === "lock") {
        logAction = "prediction-lock";
        result = await withMissingScopeHandling((t) =>
          lockPrediction({
            accessToken: t,
            broadcasterId: channelId,
            predictionId: current.id,
          }),
        );
      } else if (pending.kind === "cancel") {
        logAction = "prediction-cancel";
        result = await withMissingScopeHandling((t) =>
          cancelPrediction({
            accessToken: t,
            broadcasterId: channelId,
            predictionId: current.id,
          }),
        );
      } else {
        logAction = "prediction-resolve";
        result = await withMissingScopeHandling((t) =>
          resolvePrediction({
            accessToken: t,
            broadcasterId: channelId,
            predictionId: current.id,
            winningOutcomeId: pending.outcomeId,
          }),
        );
      }
      if (!result) return;
      if (!result.ok) {
        toast.error(`Action failed: ${result.message}`);
        return;
      }
      modLogWriter.record({
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
          ? "Prediction locked"
          : pending.kind === "cancel"
            ? "Prediction canceled"
            : `Resolved — ${pending.outcomeTitle} won`,
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

  const showCreateForm =
    !current || current.status === "RESOLVED" || current.status === "CANCELED";

  return (
    <section
      className="rounded border border-[var(--color-border)] bg-white/5 p-3"
      data-testid="engagement-predictions"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Predictions</h3>
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
            aria-label="Prediction title"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
            placeholder="What's happening?"
            className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
          />
          <div className="flex flex-col gap-1">
            {formOutcomes.map((value, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label={`Outcome ${idx + 1}`}
                  value={value}
                  onChange={(e) => {
                    const next = [...formOutcomes];
                    next[idx] = e.target.value.slice(0, 25);
                    setFormOutcomes(next);
                  }}
                  placeholder={`Outcome ${idx + 1}`}
                  className="flex-1 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
                />
                {formOutcomes.length > MIN_OUTCOMES ? (
                  <button
                    type="button"
                    onClick={() =>
                      setFormOutcomes(formOutcomes.filter((_, i) => i !== idx))
                    }
                    className="text-xs text-[var(--color-foreground-muted)] hover:text-white"
                  >
                    Remove
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
                + Add outcome
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-foreground-muted)]">
              Duration: {formDuration < 60
                ? `${formDuration}s`
                : `${Math.floor(formDuration / 60)}m`}
            </label>
            <input
              type="range"
              min={1}
              max={1800}
              value={formDuration}
              onChange={(e) => setFormDuration(parseInt(e.target.value, 10))}
              className="w-full"
              aria-label="Prediction duration"
            />
            <div className="flex justify-between text-[10px] text-[var(--color-foreground-muted)]">
              {DURATION_TICKS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFormDuration(t.value)}
                  className="hover:text-white"
                >
                  {t.label}
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
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-white">{current?.title}</div>
          <ul className="flex flex-col gap-1" data-testid="prediction-outcomes">
            {current?.outcomes.map((o) => {
              const pct = totalPoints > 0
                ? Math.round((o.channel_points / totalPoints) * 100)
                : 0;
              return (
                <li
                  key={o.id}
                  className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm"
                  data-testid={`prediction-outcome-${o.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{o.title}</span>
                    <span className="text-xs text-[var(--color-foreground-muted)]">
                      {o.channel_points.toLocaleString()} pts · {o.users} viewers
                      {totalPoints > 0 ? ` · ${pct}%` : ""}
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
                      Choose winner
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
                Lock
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPending({ kind: "cancel" })}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-600/90"
            >
              Cancel
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
              <div className="font-medium">{current?.title ?? "(no prediction)"}</div>
              {pending.kind === "resolve" ? (
                <div className="mt-1 text-xs text-[var(--color-foreground-muted)]">
                  Winning outcome: <span className="text-white">{pending.outcomeTitle}</span>
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
