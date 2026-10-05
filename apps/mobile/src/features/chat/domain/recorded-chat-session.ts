import type {
  ChatReplayReader,
  WatchChatAvailability,
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSession,
} from "../capabilities/watch-chat";

export function createRecordedChatSession(
  reader: ChatReplayReader,
): WatchChatSession {
  let target: WatchChatConnectInput | null = null;
  let view: WatchChatAvailability = {
    kind: "connecting",
    detail: "Loading recorded comments.",
  };
  let messages: readonly WatchChatMessage[] = [];
  let generation = 0;
  let abort = new AbortController();
  let position = 0;
  let cursor: string | null = null;
  let complete = false;
  let loading = false;
  const cursors = new Set<string>();
  const listeners = new Set<() => void>();
  const publish = (next: WatchChatAvailability) => {
    view = next;
    for (const listener of listeners) listener();
  };
  const project = () => {
    const visible = messages
      .filter((message) => (message.offsetSeconds ?? 0) <= position)
      .slice(-100);
    publish(
      visible.length
        ? {
            kind: "live",
            detail: "Recorded comments synchronized to playback.",
            messages: visible,
          }
        : {
            kind: "empty",
            detail: "No recorded comments at this playback position.",
          },
    );
  };
  const load = async () => {
    if (
      !target ||
      loading ||
      complete ||
      view.kind === "failed" ||
      view.kind === "unavailable"
    )
      return;
    loading = true;
    const current = generation;
    let pages = 0;
    try {
      do {
        const page = await reader.read(
          target,
          Math.max(0, position - 30),
          cursor,
          abort.signal,
        );
        if (current !== generation) return;
        if (page.kind === "unavailable") {
          publish({
            kind: "unavailable",
            reason: "recorded",
            detail: page.detail,
          });
          complete = true;
          return;
        }
        const unique = new Map(
          messages.map((message) => [message.id, message]),
        );
        for (const message of page.messages) unique.set(message.id, message);
        messages = [...unique.values()]
          .sort(
            (left, right) =>
              (left.offsetSeconds ?? 0) - (right.offsetSeconds ?? 0),
          )
          .slice(-1000);
        if (page.cursor && cursors.has(page.cursor))
          throw new Error("Recorded comments repeated a cursor.");
        cursor = page.cursor;
        if (cursor) {
          cursors.add(cursor);
          if (cursors.size > 256) {
            const first = cursors.values().next().value;
            if (first) cursors.delete(first);
          }
        }
        pages += 1;
        complete = cursor === null;
        project();
      } while (
        !complete &&
        pages < 10 &&
        (messages.at(-1)?.offsetSeconds ?? 0) <= position + 15 &&
        current === generation
      );
    } catch (error) {
      if (current === generation)
        publish({
          kind: "failed",
          retry: "manual",
          detail:
            error instanceof Error
              ? error.message
              : "Recorded comments could not be loaded.",
        });
    } finally {
      if (current === generation) loading = false;
    }
  };
  const seek = (seconds: number) => {
    generation += 1;
    abort.abort();
    abort = new AbortController();
    messages = [];
    cursor = null;
    complete = false;
    loading = false;
    cursors.clear();
    position = seconds;
    publish({ kind: "connecting", detail: "Loading recorded comments." });
    void load();
  };
  return {
    attach(next) {
      target = next;
      seek(next.media?.resumePositionSeconds ?? 0);
    },
    syncPlayback(positionMs) {
      const seconds = Math.max(0, positionMs / 1000);
      if (Math.abs(seconds - position) > 10 || seconds < position - 0.5) {
        seek(seconds);
        return;
      }
      position = seconds;
      if (view.kind === "live" || view.kind === "empty") project();
      if (!complete && (messages.at(-1)?.offsetSeconds ?? 0) <= position + 15)
        void load();
    },
    retry() {
      if (target) seek(position);
    },
    seekPlayback(positionMs) {
      if (target) seek(Math.max(0, positionMs / 1000));
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
      target = null;
      messages = [];
      loading = false;
    },
  };
}
