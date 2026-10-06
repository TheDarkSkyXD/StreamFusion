import type {
  ChatCommands,
  ChatEmoteReader,
  ChatInteractions,
  ChatInteractionView,
  ChatCommandResult,
  ChatCosmeticsReader,
  ChatUserCosmetics,
} from "../capabilities/chat-interactions";
import type { WatchChatConnectInput } from "../capabilities/watch-chat";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";

const INITIAL: ChatInteractionView = {
  access: "checking",
  detail: "Checking chat access.",
  sending: false,
  emotes: [],
  emoteStatus: "loading",
  emoteDetail: "Loading emotes.",
};

export function createChatInteractions(
  commands: ChatCommands,
  emotes: ChatEmoteReader,
  display?: Pick<ChatDisplaySettingsSession, "load" | "peek" | "subscribe">,
  cosmetics?: ChatCosmeticsReader,
): ChatInteractions {
  let view = INITIAL;
  let target: WatchChatConnectInput | null = null;
  let recorded = false;
  let generation = 0;
  let abort = new AbortController();
  let unsubscribe: (() => void) | null = null;
  let unsubscribeDisplay: (() => void) | null = null;
  const listeners = new Set<() => void>();
  let cosmeticGeneration = 0;
  let cosmeticAbort = new AbortController();
  let cosmeticPreferenceKey = "";
  let visibleUserIds: readonly string[] = [];
  let cosmeticsTimer: ReturnType<typeof setTimeout> | undefined;
  let cosmeticsRetryTimer: ReturnType<typeof setTimeout> | undefined;
  const retryCosmetics = new Set<string>();
  const queuedCosmetics = new Set<string>();
  const loadedCosmetics = new Set<string>();
  const pendingCosmetics = new Set<string>();
  const resetCosmetics = () => {
    cosmeticGeneration += 1;
    cosmeticAbort.abort();
    cosmeticAbort = new AbortController();
    clearTimeout(cosmeticsTimer);
    cosmeticsTimer = undefined;
    clearTimeout(cosmeticsRetryTimer);
    cosmeticsRetryTimer = undefined;
    retryCosmetics.clear();
    queuedCosmetics.clear();
    loadedCosmetics.clear();
    pendingCosmetics.clear();
  };
  const update = (next: Partial<ChatInteractionView>) => {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  };
  const checkAccess = async () => {
    const current = generation;
    if (!target) return;
    if (recorded) {
      update({ access: "blocked", detail: "Recorded chat is read-only." });
      return;
    }
    try {
      const result = await commands.access(target);
      if (current === generation)
        update({
          access: result.allowed ? "ready" : "blocked",
          detail: result.detail,
        });
    } catch {
      if (current === generation)
        update({
          access: "blocked",
          detail: "Chat access could not be verified. Reconnect your account.",
        });
    }
  };
  const loadEmotes = () => {
    if (!target) return;
    const current = generation;
    void emotes
      .read(target, abort.signal)
      .then((result) => {
        if (current !== generation) return;
        update({
          emotes: result.emotes,
          emoteStatus: result.failures.length
            ? result.emotes.length
              ? "partial"
              : "failed"
            : "ready",
          emoteDetail: result.failures.length
            ? `Unavailable emotes: ${result.failures.join(", ")}.`
            : `${result.emotes.length} emotes available.`,
        });
      })
      .catch(() => {
        if (current === generation)
          update({
            emoteStatus: "failed",
            emoteDetail: "Emotes could not be loaded.",
          });
      });
  };
  const loadCosmetics = (userIds: readonly string[], updateVisible = true) => {
    if (updateVisible) {
      visibleUserIds = [...new Set(userIds)];
      const visible = new Set(visibleUserIds);
      for (const id of queuedCosmetics)
        if (!visible.has(id)) queuedCosmetics.delete(id);
      for (const id of retryCosmetics)
        if (!visible.has(id)) retryCosmetics.delete(id);
    }
    if (!cosmetics || !target) return;
    for (const id of userIds)
      if (
        id &&
        !loadedCosmetics.has(id) &&
        !pendingCosmetics.has(id) &&
        !retryCosmetics.has(id)
      )
        queuedCosmetics.add(id);
    if (
      !queuedCosmetics.size ||
      cosmeticsTimer !== undefined ||
      pendingCosmetics.size
    )
      return;
    const current = generation;
    const cosmeticRevision = cosmeticGeneration;
    cosmeticsTimer = setTimeout(() => {
      cosmeticsTimer = undefined;
      if (
        current !== generation ||
        cosmeticRevision !== cosmeticGeneration ||
        !target
      )
        return;
      const ids = [...queuedCosmetics].slice(0, 120);
      ids.forEach((id) => queuedCosmetics.delete(id));
      ids.forEach((id) => pendingCosmetics.add(id));
      void cosmetics
        .read(target, ids, cosmeticAbort.signal)
        .then((result) => {
          if (current !== generation || cosmeticRevision !== cosmeticGeneration)
            return;
          ids.forEach((id) => {
            pendingCosmetics.delete(id);
            if (result.failures.length) retryCosmetics.add(id);
            else loadedCosmetics.add(id);
          });
          const merged = new Map<string, ChatUserCosmetics>(view.cosmetics);
          for (const [id, value] of result.byUserId) merged.set(id, value);
          while (loadedCosmetics.size > 1000) {
            const oldest = loadedCosmetics.values().next().value;
            if (oldest === undefined) break;
            loadedCosmetics.delete(oldest);
            merged.delete(oldest);
          }
          while (merged.size > 1000) {
            const oldest = merged.keys().next().value;
            if (oldest === undefined) break;
            merged.delete(oldest);
            loadedCosmetics.delete(oldest);
          }
          update({
            cosmetics: merged,
            cosmeticRoleBadges: result.roleBadges ?? [],
            cosmeticsDetail: result.failures.length
              ? `Unavailable cosmetics: ${result.failures.join(", ")}.`
              : "",
          });
          if (result.failures.length) scheduleCosmeticsRetry();
          loadCosmetics([], false);
        })
        .catch(() => {
          if (current !== generation || cosmeticRevision !== cosmeticGeneration)
            return;
          ids.forEach((id) => {
            pendingCosmetics.delete(id);
            retryCosmetics.add(id);
          });
          update({ cosmeticsDetail: "Badges and paints could not be loaded." });
          scheduleCosmeticsRetry();
          loadCosmetics([], false);
        });
    }, 100);
  };
  const scheduleCosmeticsRetry = () => {
    if (cosmeticsRetryTimer !== undefined) return;
    cosmeticsRetryTimer = setTimeout(() => {
      cosmeticsRetryTimer = undefined;
      retryCosmetics.clear();
      loadCosmetics(visibleUserIds);
    }, 30_000);
  };
  const invalidate = () => {
    resetCosmetics();
    generation += 1;
    abort.abort();
    abort = new AbortController();
    update({
      access: "checking",
      sending: false,
      detail: "Checking chat access.",
      emotes: [],
      emoteStatus: "loading",
      emoteDetail: "Loading emotes.",
    });
    void checkAccess();
    loadEmotes();
  };
  return {
    attach(next, isRecorded) {
      visibleUserIds = [];
      cosmeticPreferenceKey = "";
      resetCosmetics();
      generation += 1;
      abort.abort();
      abort = new AbortController();
      unsubscribe?.();
      unsubscribeDisplay?.();
      unsubscribe = commands.subscribe(invalidate);
      target = next;
      recorded = isRecorded;
      view = INITIAL;
      if (display) {
        const revision = generation;
        const applyDisplay = () => {
          const preferences = display.peek().preferences;
          const key = JSON.stringify([
            preferences.enable7tvBadges,
            preferences.enable7tvUsernamePaints,
            preferences.enableBttvBadges,
            preferences.enableFfzBadges,
          ]);
          update({ displayPreferences: preferences });
          if (key !== cosmeticPreferenceKey) {
            cosmeticPreferenceKey = key;
            resetCosmetics();
            loadCosmetics(visibleUserIds);
          }
        };
        unsubscribeDisplay = display.subscribe(applyDisplay);
        applyDisplay();
        void display
          .load()
          .then(() => {
            if (revision === generation) applyDisplay();
          })
          .catch(() => undefined);
      }
      update({});
      void checkAccess();
      loadEmotes();
    },
    async send(text, replyId) {
      const message = text.trim();
      if (!target || recorded || view.access !== "ready")
        return { kind: "blocked", detail: view.detail };
      if (view.sending)
        return { kind: "blocked", detail: "A message is already being sent." };
      if (!message || Array.from(message).length > 500)
        return {
          kind: "blocked",
          detail: "Enter a message of at most 500 characters.",
        };
      const current = generation;
      update({ sending: true });
      let result: ChatCommandResult;
      try {
        result = await commands.send(
          target,
          message,
          replyId ?? null,
          abort.signal,
        );
      } catch {
        result = {
          kind: "uncertain",
          detail:
            "Delivery could not be confirmed. Check chat before trying again.",
        };
      }
      if (current !== generation) return result;
      update({
        sending: false,
        detail:
          result.kind === "sent"
            ? "Message sent."
            : "detail" in result
              ? result.detail
              : "Completed.",
      });
      return result;
    },
    async userAction(message, action) {
      if (!target) return { kind: "blocked", detail: "No chat is attached." };
      const current = generation;
      let result: ChatCommandResult;
      try {
        result = await commands.userAction(
          target,
          message,
          action,
          abort.signal,
        );
      } catch {
        result = {
          kind: "failed",
          detail: "The user action could not be completed.",
        };
      }
      if (current !== generation)
        return { kind: "blocked", detail: "The account or channel changed." };
      update({ detail: "detail" in result ? result.detail : "Completed." });
      return result;
    },
    loadCosmetics,
    snapshot: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      visibleUserIds = [];
      resetCosmetics();
      generation += 1;
      abort.abort();
      unsubscribe?.();
      unsubscribe = null;
      unsubscribeDisplay?.();
      unsubscribeDisplay = null;
      target = null;
      view = INITIAL;
    },
  };
}
