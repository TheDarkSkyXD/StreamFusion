import type { DownloadQueueSnapshot } from "@shared/download-types";
import type { StreamRecordingJournalV2 } from "@shared/stream-recording-types";
import { dbService } from "@backend/services/database-service";

const DOWNLOAD_QUEUE_KEY = "operational:downloadQueue";
const LAST_DOWNLOAD_DIRECTORY_KEY = "operational:lastDownloadDirectory";
const STREAM_RECORDING_JOURNAL_KEY = "operational:streamRecordingJournal";

export const mediaLibraryPersistence = {
  getDownloadQueue(): DownloadQueueSnapshot {
    return dbService.get(DOWNLOAD_QUEUE_KEY, (value) =>
      typeof value === "object" && value !== null && "jobs" in value && Array.isArray(value.jobs)
        ? (value as DownloadQueueSnapshot)
        : null
    ) ?? { jobs: [] };
  },
  saveDownloadQueue(snapshot: DownloadQueueSnapshot): void { dbService.set(DOWNLOAD_QUEUE_KEY, snapshot); },
  getLastDownloadDirectory(): string | null {
    return dbService.get(LAST_DOWNLOAD_DIRECTORY_KEY, (value) =>
      typeof value === "string" && value.length > 0 ? value : null
    ) ?? null;
  },
  saveLastDownloadDirectory(directory: string): void { dbService.set(LAST_DOWNLOAD_DIRECTORY_KEY, directory); },
  getStreamRecordingJournal(): unknown {
    const result = dbService.getJson(STREAM_RECORDING_JOURNAL_KEY);
    return result.kind === "value" ? result.value : undefined;
  },
  saveStreamRecordingJournal(journal: StreamRecordingJournalV2): void {
    dbService.set(STREAM_RECORDING_JOURNAL_KEY, journal);
  },
};
