import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { RECORDING_LIFECYCLE_LABELS } from "@/lib/stream-recording-presentation";
import type {
  StreamRecordingLifecycleState,
  StreamRecordingSnapshot,
} from "@/shared/stream-recording-types";

const IDLE_STATE: StreamRecordingLifecycleState = {
  phase: "idle",
  active: null,
  notice: null,
};

function toLifecycleState(snapshot: StreamRecordingSnapshot): StreamRecordingLifecycleState {
  if (snapshot.active) {
    return {
      phase: snapshot.active.status,
      active: snapshot.active,
      notice: null,
    };
  }
  if (snapshot.notice) {
    switch (snapshot.notice.outcome) {
      case "completed":
        return { phase: "completed", active: null, notice: snapshot.notice };
      case "partial":
        return { phase: "partial", active: null, notice: snapshot.notice };
      case "failed":
        return { phase: "failed", active: null, notice: snapshot.notice };
    }
  }
  return IDLE_STATE;
}

interface StreamRecordingStore {
  getSnapshot(): StreamRecordingLifecycleState;
  publish(snapshot: StreamRecordingSnapshot): void;
  subscribe(listener: () => void): () => void;
}

function createStreamRecordingStore(): StreamRecordingStore {
  let currentState: StreamRecordingLifecycleState = IDLE_STATE;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => currentState,
    publish: (snapshot) => {
      currentState = toLifecycleState(snapshot);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const fallbackStore = createStreamRecordingStore();
const StreamRecordingContext = createContext<StreamRecordingStore | null>(null);

function StreamRecordingPhaseAnnouncer() {
  const state = useStreamRecordingState();
  if (!state.active || state.phase === "interrupted") return null;
  return (
    <span
      data-testid="recording-phase-announcer"
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      Stream recording: {RECORDING_LIFECYCLE_LABELS[state.phase]}
    </span>
  );
}

function StreamRecordingQualityAnnouncer() {
  const state = useStreamRecordingState();
  const [message, setMessage] = useState("");
  const announcedKeyRef = useRef<string | null>(null);
  const active = state.active;
  const sessionId = active?.sessionId;
  const revision = active?.qualityChange?.revision;
  const fromQuality = active?.qualityChange?.fromQuality;
  const toQuality = active?.qualityChange?.toQuality;
  const interrupted = state.phase === "interrupted";

  useEffect(() => {
    if (interrupted || !sessionId || revision === undefined || !fromQuality || !toQuality) {
      announcedKeyRef.current = null;
      setMessage("");
      return;
    }
    const key = `${sessionId}:${revision}`;
    if (announcedKeyRef.current === key) return;
    announcedKeyRef.current = key;
    setMessage(`Quality changed from ${fromQuality} to ${toQuality}`);
  }, [interrupted, sessionId, revision, fromQuality, toQuality]);

  if (!message) return null;
  return (
    <span
      data-testid="recording-quality-announcer"
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </span>
  );
}

export function StreamRecordingProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StreamRecordingStore | null>(null);
  if (!storeRef.current) storeRef.current = createStreamRecordingStore();
  const store = storeRef.current;

  useEffect(() => {
    const bridge = window.electronAPI?.streamRecording;
    if (!bridge) return;
    let mounted = true;
    let receivedPush = false;
    const unsubscribe = bridge.onStateChanged((snapshot) => {
      receivedPush = true;
      store.publish(snapshot);
    });
    void bridge
      .getState()
      .then((snapshot) => {
        if (mounted && !receivedPush) store.publish(snapshot);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [store]);

  return (
    <StreamRecordingContext.Provider value={store}>
      <StreamRecordingPhaseAnnouncer />
      <StreamRecordingQualityAnnouncer />
      {children}
    </StreamRecordingContext.Provider>
  );
}

export function useStreamRecordingState(): StreamRecordingLifecycleState {
  const store = useContext(StreamRecordingContext) ?? fallbackStore;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
