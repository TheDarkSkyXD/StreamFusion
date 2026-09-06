import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";
import { useAuthStore } from "@/store/auth-store";

const AUTOMOD_SCOPES = ["moderator:manage:automod"];

type ConnectionState = "connecting" | "connected" | "reconnecting" | "permission" | "error";
type ResolveAction = "ALLOW" | "DENY";

interface HeldMessage {
  id: string;
  user: string;
  text: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageId(value: unknown): string | null {
  return isRecord(value) && typeof value.message_id === "string" ? value.message_id : null;
}

function heldMessage(value: unknown): HeldMessage | null {
  const id = messageId(value);
  if (!id || !isRecord(value) || !isRecord(value.message)) return null;
  if (typeof value.message.text !== "string" || typeof value.user_name !== "string") return null;
  return {
    id,
    user: value.user_name,
    text: value.message.text,
    reason: typeof value.reason === "string" ? value.reason : "AutoMod",
  };
}

function connectionState(value: string): ConnectionState {
  if (
    value === "connected" ||
    value === "connecting" ||
    value === "reconnecting" ||
    value === "permission"
  )
    return value;
  return "error";
}

export function AutoModQueue({ channelId, channel }: { channelId: string; channel: string }) {
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.twitchUser?.id);
  const [messages, setMessages] = useState<HeldMessage[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = () => setRevision((current) => current + 1);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setActionError(null);
    if (!userId) {
      setState("permission");
      return;
    }
    setState("connecting");
    const feedId = `automod:${channelId}:${userId}`;
    const stopEvents = window.electronAPI.twitch.eventSub.onEvent(
      ({ feedId: received, payload }) => {
        if (
          cancelled ||
          received !== feedId ||
          !isRecord(payload) ||
          !isRecord(payload.subscription)
        )
          return;
        if (payload.subscription.type === "automod.message.hold") {
          const event = heldMessage(payload.event);
          if (!event) return;
          setMessages((current) =>
            current.some((message) => message.id === event.id) ? current : [...current, event]
          );
        } else if (payload.subscription.type === "automod.message.update") {
          const id = messageId(payload.event);
          if (id) setMessages((current) => current.filter((message) => message.id !== id));
        }
      }
    );
    const stopState = window.electronAPI.twitch.eventSub.onState(
      ({ feedId: received, state: next }) => {
        if (!cancelled && received === feedId) setState(connectionState(next));
      }
    );
    void window.electronAPI.twitch.eventSub
      .start({
        feedId,
        userId,
        channelId,
        eventTypes: ["automod.message.hold", "automod.message.update"],
      })
      .then((result) => {
        if (!cancelled && !result.ok)
          setState(result.error.code === "unauthorized" ? "permission" : "error");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      stopEvents();
      stopState();
      void window.electronAPI.twitch.eventSub.stop(feedId);
    };
  }, [channelId, userId, revision]);

  const resolve = async (message: HeldMessage, action: ResolveAction) => {
    if (!userId || busyIds.has(message.id)) return;
    setActionError(null);
    setBusyIds((current) => new Set(current).add(message.id));
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "manage-held-automod",
        moderatorId: userId,
        messageId: message.id,
        action,
      });
      if (result.ok)
        setMessages((current) =>
          current.filter((currentMessage) => currentMessage.id !== message.id)
        );
      else {
        setActionError(result.error.message);
        if (result.error.code === "unauthorized") setState("permission");
      }
    } catch {
      setActionError(t("moderation.autoMod.actionFailed"));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };

  const reconnect = () =>
    useReconnectDialogStore
      .getState()
      .open({ platform: "twitch", missingScopes: AUTOMOD_SCOPES, onReconnected: retry });
  if (state === "permission")
    return (
      <div className="space-y-2 p-3 text-sm text-neutral-400">
        <p>{t("moderation.autoMod.permissionRequired")}</p>
        <button
          type="button"
          className="text-[var(--mod-accent,#9146ff)] underline"
          onClick={reconnect}
        >
          {t("moderation.autoMod.reconnect")}
        </button>
      </div>
    );
  if (messages.length === 0) {
    const status =
      state === "connected"
        ? t("moderation.autoMod.empty")
        : state === "reconnecting"
          ? t("moderation.autoMod.reconnecting", { channel })
          : state === "error"
            ? t("moderation.autoMod.connectionFailed")
            : t("moderation.autoMod.connecting", { channel });
    return (
      <div className="space-y-2 p-3 text-sm text-neutral-400">
        <p role="status">{status}</p>
        {state === "error" && (
          <button
            type="button"
            className="text-[var(--mod-accent,#9146ff)] underline"
            onClick={retry}
          >
            {t("moderation.retry")}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-48 flex-col">
      {state !== "connected" && (
        <div className="shrink-0 px-2 py-1 text-xs text-amber-200" role="status">
          {state === "error"
            ? t("moderation.autoMod.connectionFailed")
            : t("moderation.autoMod.reconnecting", { channel })}
          {state === "error" && (
            <button type="button" className="ml-2 underline" onClick={retry}>
              {t("moderation.retry")}
            </button>
          )}
        </div>
      )}
      {actionError ? (
        <p role="alert" className="px-2 pt-2 text-sm text-red-300">
          {actionError}
        </p>
      ) : null}
      <Virtuoso
        className="min-h-0 flex-1"
        data={messages}
        aria-label={t("moderation.autoMod.queueTitle")}
        computeItemKey={(_, message) => message.id}
        itemContent={(_, message) => {
          const busy = busyIds.has(message.id);
          return (
            <article className="mb-2 rounded bg-white/5 p-2 text-sm">
              <strong>{message.user}</strong>
              <p>{message.text}</p>
              <p className="text-xs text-neutral-400">{message.reason}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-[#9146ff] px-3 py-1 text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void resolve(message, "ALLOW")}
                >
                  {t("moderation.autoMod.allow")}
                </button>
                <button
                  type="button"
                  className="rounded bg-white/10 px-3 py-1 text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void resolve(message, "DENY")}
                >
                  {t("moderation.autoMod.deny")}
                </button>
              </div>
            </article>
          );
        }}
      />
    </div>
  );
}
