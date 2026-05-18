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
import { toast } from "sonner";

import {
  archivePoll,
  createPoll,
  getPolls,
  terminatePoll,
  type PollPayload,
  type PollsListPayload,
} from "@/backend/api/platforms/twitch/twitch-helix-polls";
import type { HelixModResult } from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import { modLogWriter } from "@/backend/services/mod-log-writer";
import { useHelixPoll } from "@/hooks/useHelixPoll";
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

async function getToken(): Promise<string | null> {
  const token = await window.electronAPI.auth.getToken("twitch");
  return token?.accessToken ?? null;
}

function isActive(p: PollPayload | null | undefined): boolean {
  return p?.status === "ACTIVE";
}

function isTerminated(p: PollPayload | null | undefined): boolean {
  return p?.status === "TERMINATED";
}

export function EngagementPolls({ channelId }: EngagementPollsProps) {
  const twitchUser = useAuthStore((s) => s.twitchUser);

  const fetcher = useCallback(async (): Promise<PollsListPayload | null> => {
    const accessToken = await getToken();
    if (!accessToken) return null;
    const result = await getPolls({ accessToken, broadcasterId: channelId });
    if (!result.ok) {
      throw new Error(result.message);
    }
    return result.payload;
  }, [channelId]);

  const { data, refresh } = useHelixPoll<PollsListPayload | null>({
    fetcher,
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
  });

  const current: PollPayload | null = useMemo(() => {
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
    const cleaned = formChoices
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (cleaned.length < MIN_CHOICES) {
      toast.error("At least 2 choices are required");
      return;
    }
    setBusy(true);
    try {
      const result = await withMissingScopeHandling((t) =>
        createPoll({
          accessToken: t,
          broadcasterId: channelId,
          title,
          choices: cleaned.map((c) => ({ title: c })),
          duration: formDuration,
        }),
      );
      if (!result) return;
      if (!result.ok) {
        toast.error(`Could not create poll: ${result.message}`);
        return;
      }
      modLogWriter.record({
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
      toast.success("Poll created");
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
      let result: HelixModResult<PollPayload> | null = null;
      if (pending.kind === "terminate") {
        result = await withMissingScopeHandling((t) =>
          terminatePoll({
            accessToken: t,
            broadcasterId: channelId,
            pollId: current.id,
          }),
        );
      } else {
        result = await withMissingScopeHandling((t) =>
          archivePoll({
            accessToken: t,
            broadcasterId: channelId,
            pollId: current.id,
          }),
        );
      }
      if (!result) return;
      if (!result.ok) {
        toast.error(`Action failed: ${result.message}`);
        return;
      }
      // Only the terminate path writes to mod_log per plan (action set:
      // "poll-start" | "poll-terminate"). Archive is a UI-only state move.
      if (pending.kind === "terminate") {
        modLogWriter.record({
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
        pending.kind === "terminate" ? "Poll terminated" : "Poll archived",
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
        <h3 className="text-sm font-semibold text-white">Polls</h3>
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
            aria-label="Poll title"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
            placeholder="Ask the chat…"
            className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
          />
          <div className="flex flex-col gap-1">
            {formChoices.map((value, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label={`Choice ${idx + 1}`}
                  value={value}
                  onChange={(e) => {
                    const next = [...formChoices];
                    next[idx] = e.target.value.slice(0, MAX_CHOICE_LEN);
                    setFormChoices(next);
                  }}
                  placeholder={`Choice ${idx + 1}`}
                  className="flex-1 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
                />
                {formChoices.length > MIN_CHOICES ? (
                  <button
                    type="button"
                    onClick={() =>
                      setFormChoices(formChoices.filter((_, i) => i !== idx))
                    }
                    className="text-xs text-[var(--color-foreground-muted)] hover:text-white"
                  >
                    Remove
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
                + Add choice
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
              min={MIN_DURATION_S}
              max={MAX_DURATION_S}
              value={formDuration}
              onChange={(e) => setFormDuration(parseInt(e.target.value, 10))}
              className="w-full"
              aria-label="Poll duration"
            />
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
          <ul className="flex flex-col gap-1" data-testid="poll-choices">
            {current?.choices.map((c) => {
              const pct =
                totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0;
              return (
                <li
                  key={c.id}
                  className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm"
                  data-testid={`poll-choice-${c.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{c.title}</span>
                    <span className="text-xs text-[var(--color-foreground-muted)]">
                      {c.votes.toLocaleString()} votes
                      {totalVotes > 0 ? ` · ${pct}%` : ""}
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
                Terminate
              </button>
            ) : null}
            {isTerminated(current) ? (
              <button
                type="button"
                onClick={() => setPending({ kind: "archive" })}
                className="rounded bg-[#9146FF] px-3 py-1 text-sm text-white hover:bg-[#9146FF]/90"
              >
                Archive
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
            <div className="font-medium">{current?.title ?? "(no poll)"}</div>
          }
          onConfirm={() => void runPending()}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
