import type {
  StreamRecordingJournalV2,
  StreamRecordingNotice,
  StreamRecordingSession,
  StreamRecordingSnapshot,
} from "@shared/stream-recording-types";

export interface StreamRecordingNoticeStore {
  getSnapshot(): StreamRecordingSnapshot;
  setNotice(notice: StreamRecordingNotice | null): void;
  settle(sessionId: string, notice: StreamRecordingNotice): boolean;
  dismissNotice(sessionId: string): boolean;
}

export interface StreamRecordingSessionStore extends StreamRecordingNoticeStore {
  getJournal(): StreamRecordingJournalV2;
  saveSession(session: StreamRecordingSession): void;
  clearSession(): void;
  subscribe(listener: (snapshot: StreamRecordingSnapshot) => void): () => void;
}
