/**
 * U26 — Engagement → Polls section.
 *
 * 5s-polled view of the broadcaster's most recent poll.
 *
 *   - Empty / ARCHIVED / COMPLETED → "Create poll" form.
 *   - ACTIVE → live state with Terminate button.
 *   - TERMINATED → Archive button.
 *
 * Terminate / Archive route through `ModActionConfirmDialog`. Successful
 * actions write a row to `mod_log` via `modLogWriter.record({ source:
 * "local", ... })`.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { modLogWriter } from "@backend/services/mod-log-writer";
import { useHelixPoll } from "@/hooks/useHelixPoll";
import type { TwitchPoll } from "@shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

import { ModActionConfirmDialog } from "../ModActionConfirmDialog";

const POLL_INTERVAL_MS = 5_000;
const MAX_TITLE = 60;
const MIN_CHOICES = 2;
const MAX_CHOICES = 5;
const MAX_CHOICE_LEN = 25;
const MIN_DURATION_S = 15;
const MAX_DURATION_S = 1800;
const DEFAULT_DURATION_S = 60;

export interface EngagementPollsProps {
  channelId: string;
}

type PendingAction = { kind: "terminate" } | { kind: "archive" };

function isActive(p: TwitchPoll | null | undefined): boolean {
  return p?.status === "ACTIVE";
}

function isTerminated(p: TwitchPoll | null | undefined): boolean {
  return p?.status === "TERMINATED";
}

export function EngagementPolls({ channelId }: EngagementPollsProps) {
  const { t } = useTranslation();
  const twitchUser = useAuthStore((s) => s.twitchUser);

  const fetcher = useCallback(async (): Promise<{ data: TwitchPoll[] } | null> => {
    const result = await window.electronAPI.twitch.execute({
      operation: "get-polls",
      broadcasterId: channelId,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.data as { data: TwitchPoll[] };
  }, [channelId]);

  const { data, refresh } = useHelixPoll<{ data: TwitchPoll[] } | null>({
    fetcher,
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
  });

  const current: TwitchPoll | null = useMemo(() => {
    const first = data?.data?.[0];
    return first ?? null;
  }, [data]);

  const [formTitle, setFormTitle] = useState("");
  const [formChoices, setFormChoices] = useState<string[]>(["", ""]);
  const [formDuration, setFormDuration] = useState<number>(DEFAULT_DURATION_S);
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
    const cleaned = formChoices.map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleaned.length < MIN_CHOICES) {
      toast.error(t("chatModeration.minChoicesRequired", { count: MIN_CHOICES }));
      return;
    }
    setBusy(true);
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "create-poll",
        broadcasterId: channelId,
        title,
        choices: cleaned,
        duration: formDuration,
      });
      if (!result.ok) {
        toast.error(t("chatModeration.couldNotCreatePoll", { error: result.error.message }));
        return;
      }
      modLogWriter.record({
        platform: "twitch",
        source: "local",
        channelId,
        channelSlug,
        action: "poll-start",
        targetUserId: channelId,
        targetUsername: channelSlug,
        moderatorUserId,
        moderatorUsername,
        reason: title,
      });
      toast.success(t("chatModeration.pollCreated"));
      setFormTitle("");
      setFormChoices(["", ""]);
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
      const result = await window.electronAPI.twitch.execute({
        operation: "end-poll",
        broadcasterId: channelId,
        pollId: current.id,
        status: pending.kind === "terminate" ? "TERMINATED" : "ARCHIVED",
      });
      if (!result.ok) {
        toast.error(t("chatModeration.actionFailed", { error: result.error.message }));
        return;
      }
      // Only the terminate path writes to mod_log per plan (action set:
      // "poll-start" | "poll-terminate"). Archive is a UI-only state move.
      if (pending.kind === "terminate") {
        modLogWriter.record({
          platform: "twitch",
          source: "local",
          channelId,
          channelSlug,
          action: "poll-terminate",
          targetUserId: channelId,
          targetUsername: channelSlug,
          moderatorUserId,
          moderatorUsername,
          reason: current.title,
        });
      }
      toast.success(
        pending.kind === "terminate"
          ? t("chatModeration.pollTerminated")
          : t("chatModeration.pollArchived")
      );
      setPending(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const totalVotes = useMemo(() => {
    if (!current) return 0;
    return current.choices.reduce((sum, c) => sum + c.votes, 0);
  }, [current]);

  const showCreateForm =
    !current ||
    current.status === "ARCHIVED" ||
    current.status === "COMPLETED" ||
    current.status === "MODERATED" ||
    current.status === "INVALID";

  return (
    <section
      className="rounded border border-[var(--color-border)] bg-white/5 p-3"
      data-testid="engagement-polls"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{t("chatModeration.polls")}</h3>
        {current ? (
          <span
            className="text-xs uppercase tracking-wide text-[var(--color-foreground-muted)]"
            data-testid="poll-status"
          >
            {current.status}
          </span>
        ) : null}
      </header>

      {showCreateForm ? (
        <div className="flex flex-col gap-2" data-testid="poll-create-form">
          <input
            type="text"
            aria-label={t("chatModeration.pollTitle")}
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
            placeholder={t("chatModeration.askChat")}
            className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
          />
          <div className="flex flex-col gap-1">
            {formChoices.map((value, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label={t("chatModeration.choice", { index: idx + 1 })}
                  value={value}
                  onChange={(e) => {
                    const next = [...formChoices];
                    next[idx] = e.target.value.slice(0, MAX_CHOICE_LEN);
                    setFormChoices(next);
                  }}
                  placeholder={t("chatModeration.choice", { index: idx + 1 })}
                  className="flex-1 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
                />
                {formChoices.length > MIN_CHOICES ? (
                  <button
                    type="button"
                    onClick={() => setFormChoices(formChoices.filter((_, i) => i !== idx))}
                    className="text-xs text-[var(--color-foreground-muted)] hover:text-white"
                  >
                    {t("chatModeration.remove")}
                  </button>
                ) : null}
              </div>
            ))}
            {formChoices.length < MAX_CHOICES ? (
              <button
                type="button"
                onClick={() => setFormChoices([...formChoices, ""])}
                className="self-start text-xs text-[var(--color-storm-primary)] hover:underline"
              >
                {t("chatModeration.addChoice")}
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
              min={MIN_DURATION_S}
              max={MAX_DURATION_S}
              value={formDuration}
              onChange={(e) => setFormDuration(parseInt(e.target.value, 10))}
              className="w-full"
              aria-label={t("chatModeration.pollDuration")}
            />
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
          <ul className="flex flex-col gap-1" data-testid="poll-choices">
            {current?.choices.map((c) => {
              const pct = totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0;
              return (
                <li
                  key={c.id}
                  className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm"
                  data-testid={`poll-choice-${c.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{c.title}</span>
                    <span className="text-xs text-[var(--color-foreground-muted)]">
                      {totalVotes > 0
                        ? t("chatModeration.votesWithPercentage", {
                            votes: t("chatModeration.votes", { count: c.votes }),
                            percent: pct,
                          })
                        : t("chatModeration.votes", { count: c.votes })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2">
            {isActive(current) ? (
              <button
                type="button"
                onClick={() => setPending({ kind: "terminate" })}
                className="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-600/90"
              >
                {t("chatModeration.terminate")}
              </button>
            ) : null}
            {isTerminated(current) ? (
              <button
                type="button"
                onClick={() => setPending({ kind: "archive" })}
                className="rounded bg-[#9146FF] px-3 py-1 text-sm text-white hover:bg-[#9146FF]/90"
              >
                {t("chatModeration.archive")}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {pending ? (
        <ModActionConfirmDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setPending(null);
          }}
          actionType={pending.kind === "terminate" ? "pollTerminate" : "pollArchive"}
          targetPreview={
            <div className="font-medium">{current?.title ?? t("chatModeration.noPoll")}</div>
          }
          onConfirm={() => void runPending()}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
