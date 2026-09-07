import { mediaLibraryPersistence } from "../data/media-library-persistence";
import {
  createDownloadQueueService,
  type DownloadQueueService,
} from "../domain/download-queue-service";

let downloadQueueService: DownloadQueueService | null = null;

export function getDownloadQueueService(): DownloadQueueService {
  downloadQueueService ??= createDownloadQueueService({ storage: mediaLibraryPersistence });
  return downloadQueueService;
}
