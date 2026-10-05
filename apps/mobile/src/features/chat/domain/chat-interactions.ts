import type {
  ChatCommands,
  ChatEmoteReader,
  ChatInteractions,
  ChatInteractionView,
  ChatCommandResult,
} from "../capabilities/chat-interactions";
import type { WatchChatConnectInput } from "../capabilities/watch-chat";

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
): ChatInteractions {
  let view = INITIAL;
  let target: WatchChatConnectInput | null = null;
  let recorded = false;
  let generation = 0;
  let abort = new AbortController();
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();
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
  const invalidate = () => {
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
      generation += 1;
      abort.abort();
      abort = new AbortController();
      unsubscribe?.();
      unsubscribe = commands.subscribe(invalidate);
      target = next;
      recorded = isRecorded;
      view = INITIAL;
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
    snapshot: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      generation += 1;
      abort.abort();
      unsubscribe?.();
      unsubscribe = null;
      target = null;
      view = INITIAL;
    },
  };
}
