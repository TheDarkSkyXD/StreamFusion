import { useCallback } from "react";
import { toast } from "sonner";

import { showErrorToast } from "@/lib/error-toast";
import type {
  ClipDownloadRequest,
  DownloadJobKind,
  VideoDownloadRequest,
} from "@/shared/download-types";
import { requestDuplicateDownloadConfirmation } from "@/store/download-duplicate-confirmation-store";

async function shouldAddDuplicate(
  kind: DownloadJobKind,
  platform: string,
  sourceId: string,
  title: string
) {
  const snapshot = await window.electronAPI?.downloads?.getQueue?.();
  const duplicate = snapshot?.jobs.some(
    (job) =>
      job.kind === kind &&
      job.platform === platform &&
      job.sourceId === sourceId &&
      job.status !== "cancelled"
  );
  if (!duplicate) return true;
  return requestDuplicateDownloadConfirmation(kind, title);
}

function showDownloadResult(result: { success: boolean; cancelled?: boolean; error?: string }) {
  if (result.success) {
    toast.success("Added to Downloads");
    return;
  }
  if (result.cancelled) return;
  showErrorToast("Couldn't start download", {
    description: result.error,
  });
}

export function useDownloadActions() {
  const downloadClip = useCallback(async (request: ClipDownloadRequest) => {
    if (!window.electronAPI?.downloads?.downloadClip) {
      showErrorToast("Downloads are not available");
      return;
    }
    if (!(await shouldAddDuplicate("clip", request.platform, request.clipId, request.title)))
      return;
    showDownloadResult(await window.electronAPI.downloads.downloadClip(request));
  }, []);

  const downloadVideo = useCallback(async (request: VideoDownloadRequest) => {
    if (!window.electronAPI?.downloads?.downloadVideo) {
      showErrorToast("Downloads are not available");
      return;
    }
    if (!(await shouldAddDuplicate("video", request.platform, request.videoId, request.title)))
      return;
    showDownloadResult(await window.electronAPI.downloads.downloadVideo(request));
  }, []);

  return { downloadClip, downloadVideo };
}
