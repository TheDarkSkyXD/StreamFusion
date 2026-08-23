interface StartChatSessionOptions {
  joinLive: () => Promise<void>;
  loadHistory: () => Promise<void>;
  loadDecorations: () => Promise<void>;
}

export interface StartedChatSession {
  preparation: Promise<void>;
}

export async function startChatSession(
  options: StartChatSessionOptions
): Promise<StartedChatSession> {
  const decorations = options.loadDecorations();
  const history = options.loadHistory();
  const preparationResult = Promise.all([decorations, history]).then(
    () => ({ error: undefined }),
    (error: unknown) => ({ error })
  );
  await options.joinLive();
  return {
    preparation: preparationResult.then(({ error }) => {
      if (error !== undefined) throw error;
    }),
  };
}

export interface ChatMessageGate<T> {
  accept: (message: T) => void;
  open: () => void;
  cancel: () => void;
}

export function createChatMessageGate<T>(publish: (message: T) => void): ChatMessageGate<T> {
  let state: "pending" | "open" | "cancelled" = "pending";
  const queued: T[] = [];
  return {
    accept(message) {
      if (state === "pending") queued.push(message);
      else if (state === "open") publish(message);
    },
    open() {
      if (state !== "pending") return;
      state = "open";
      for (const message of queued) publish(message);
      queued.length = 0;
    },
    cancel() {
      state = "cancelled";
      queued.length = 0;
    },
  };
}
