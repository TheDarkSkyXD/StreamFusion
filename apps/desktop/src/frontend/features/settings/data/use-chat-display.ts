import { useCallback, useSyncExternalStore } from "react";

import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@shared/auth-types";
import { createCancellableSleep } from "@shared/utils/sleep";
import { useAuthStore } from "@/store/auth-store";

const PREFERENCE_HYDRATION_TIMEOUT_MS = 10_000;

let persistenceQueue: Promise<void> | undefined;
let nextRevision = 0;
let unsubscribeFromOptimisticState: (() => void) | undefined;
let optimisticSnapshot: Partial<ChatDisplayPreferences> = {};

const optimisticListeners = new Set<() => void>();

type PendingChange = {
  revision: number;
  value: ChatDisplayPreferences[keyof ChatDisplayPreferences];
};
type ChangeSnapshot = Partial<Record<keyof ChatDisplayPreferences, PendingChange>>;

const pendingChanges: ChangeSnapshot = {};

function subscribe(listener: () => void): () => void {
  optimisticListeners.add(listener);
  return () => optimisticListeners.delete(listener);
}

function getSnapshot(): Partial<ChatDisplayPreferences> {
  return optimisticSnapshot;
}

function emit(): void {
  for (const listener of optimisticListeners) listener();
}

function withField<K extends keyof ChatDisplayPreferences>(
  chatDisplay: ChatDisplayPreferences,
  field: K,
  value: ChatDisplayPreferences[K]
): ChatDisplayPreferences {
  return { ...chatDisplay, [field]: value };
}

function reconcileOptimisticState(): void {
  const preferences = useAuthStore.getState().preferences;
  if (!preferences) return;

  let reconciled = preferences.chatDisplay;
  for (const field of Object.keys(pendingChanges) as (keyof ChatDisplayPreferences)[]) {
    const pending = pendingChanges[field];
    if (pending && !Object.is(reconciled[field], pending.value)) {
      reconciled = withField(reconciled, field, pending.value);
    }
  }

  if (reconciled !== preferences.chatDisplay) {
    useAuthStore.setState({ preferences: { ...preferences, chatDisplay: reconciled } });
  }
}

function publish<K extends keyof ChatDisplayPreferences>(
  field: K,
  value: ChatDisplayPreferences[K]
): void {
  const preferences = useAuthStore.getState().preferences;
  pendingChanges[field] = { revision: ++nextRevision, value };
  if (!preferences || Object.prototype.hasOwnProperty.call(optimisticSnapshot, field)) {
    optimisticSnapshot = { ...optimisticSnapshot, [field]: value };
    emit();
  }

  if (!unsubscribeFromOptimisticState && typeof useAuthStore.subscribe === "function") {
    unsubscribeFromOptimisticState = useAuthStore.subscribe(reconcileOptimisticState);
  }
  if (preferences && typeof useAuthStore.setState === "function") {
    useAuthStore.setState({
      preferences: {
        ...preferences,
        chatDisplay: withField(preferences.chatDisplay, field, value),
      },
    });
  }
}

function snapshotPendingChanges(): ChangeSnapshot {
  const snapshot: ChangeSnapshot = {};
  for (const field of Object.keys(pendingChanges) as (keyof ChatDisplayPreferences)[]) {
    const pending = pendingChanges[field];
    if (pending) snapshot[field] = pending;
  }
  return snapshot;
}

function getChangeValues(changes: ChangeSnapshot): Partial<ChatDisplayPreferences> {
  let values: Partial<ChatDisplayPreferences> = {};
  for (const field of Object.keys(changes) as (keyof ChatDisplayPreferences)[]) {
    const change = changes[field];
    if (change) values = { ...values, [field]: change.value };
  }
  return values;
}

function clearPersistedChanges(changes: ChangeSnapshot): void {
  let nextSnapshot = optimisticSnapshot;
  for (const field of Object.keys(changes) as (keyof ChatDisplayPreferences)[]) {
    const persisted = changes[field];
    const pending = pendingChanges[field];
    if (
      !persisted ||
      pending?.revision !== persisted.revision ||
      !Object.is(pending.value, persisted.value)
    ) {
      continue;
    }
    delete pendingChanges[field];
    if (Object.prototype.hasOwnProperty.call(nextSnapshot, field)) {
      if (nextSnapshot === optimisticSnapshot) nextSnapshot = { ...optimisticSnapshot };
      delete nextSnapshot[field];
    }
  }

  if (nextSnapshot !== optimisticSnapshot) {
    optimisticSnapshot = nextSnapshot;
    emit();
  }
  if (Object.keys(pendingChanges).length === 0) {
    unsubscribeFromOptimisticState?.();
    unsubscribeFromOptimisticState = undefined;
  }
}

function waitForPreferenceHydration(): Promise<"ready" | "unavailable"> {
  const state = useAuthStore.getState();
  if (state.preferences) return Promise.resolve("ready");
  if (state.initialized) return Promise.resolve("unavailable");

  const deadline = createCancellableSleep(PREFERENCE_HYDRATION_TIMEOUT_MS);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const settle = (result: "ready" | "unavailable") => {
      if (settled) return;
      settled = true;
      unsubscribe();
      deadline.cancel();
      resolve(result);
    };

    unsubscribe = useAuthStore.subscribe((nextState) => {
      if (nextState.preferences) settle("ready");
      else if (nextState.initialized) settle("unavailable");
    });
    void deadline.result.then((result) => {
      if (result.ok) settle("unavailable");
    });

    const latestState = useAuthStore.getState();
    if (latestState.preferences) settle("ready");
    else if (latestState.initialized) settle("unavailable");
  });
}

export function useChatDisplay(onSaved?: () => void) {
  const storedChatDisplay = useAuthStore((state) => state.preferences?.chatDisplay);
  const optimisticChatDisplay = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const cd = {
    ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
    ...(storedChatDisplay ?? {}),
    ...optimisticChatDisplay,
  };
  const updatePreferences = useAuthStore((state) => state.updatePreferences);

  const set = useCallback(
    <K extends keyof ChatDisplayPreferences>(field: K, value: ChatDisplayPreferences[K]) => {
      publish(field, value);
      const changesToPersist = snapshotPendingChanges();
      const persist = async () => {
        let state = useAuthStore.getState();
        if (!state.preferences) {
          const hydration = await waitForPreferenceHydration();
          if (hydration !== "ready") return;
          state = useAuthStore.getState();
        }
        if (!state.preferences) return;

        const result = await updatePreferences({
          chatDisplay: {
            ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
            ...state.preferences.chatDisplay,
            ...getChangeValues(changesToPersist),
          },
        });
        if (result?.success === false) return;
        clearPersistedChanges(changesToPersist);
        onSaved?.();
      };

      const write = persistenceQueue ? persistenceQueue.then(persist) : persist();
      const settledWrite = write.then(
        () => undefined,
        () => undefined
      );
      persistenceQueue = settledWrite;
      void settledWrite.then(() => {
        if (persistenceQueue === settledWrite) persistenceQueue = undefined;
      });
      return write;
    },
    [onSaved, updatePreferences]
  );

  return { cd, set };
}
