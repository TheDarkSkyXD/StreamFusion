import { useTranslation } from "react-i18next";
import { useChatStore } from "../../state/chat-store";

export function KickChatConnectionStatus({
  channel,
  startup,
  retry,
}: {
  channel: string;
  startup: "loading" | "ready" | "failed";
  retry: () => void;
}) {
  const { t } = useTranslation();
  const state = useChatStore((store) => store.connectionStatus.kick.state);
  const joined = useChatStore((store) =>
    store.connectionStatus.kick.channels.includes(channel.trim().toLowerCase())
  );
  if (startup === "ready" && state === "connected" && joined) return null;
  const message =
    startup === "failed"
      ? t("chat.kickConnection.failed", { defaultValue: "Could not connect to Kick chat." })
      : state === "reconnecting" || (startup === "ready" && state === "disconnected")
        ? t("chat.kickConnection.reconnecting", {
            defaultValue: "Kick chat is unavailable. Reconnecting…",
          })
        : state === "connected" && joined
          ? t("chat.kickConnection.loading", { defaultValue: "Loading recent Kick chat…" })
          : t("chat.kickConnection.connecting", { defaultValue: "Connecting to Kick chat…" });
  return (
    <div
      className="shrink-0 space-y-2 border-b border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-300"
      data-testid="kick-chat-connection-status"
    >
      <p role={startup === "failed" ? "alert" : "status"}>{message}</p>
      <button
        type="button"
        className="rounded border border-white/20 px-2 py-1 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#53fc18]"
        onClick={retry}
      >
        {t("chat.kickConnection.retry", { defaultValue: "Retry chat" })}
      </button>
    </div>
  );
}
