import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { showErrorToast } from "@/lib/error-toast";
import type {
  ClipDownloadRequest,
  DownloadJobKind,
  VideoDownloadRequest,
} from "@shared/download-types";
import { requestDuplicateDownloadConfirmation } from "@/features/media-library/components/state/download-duplicate-confirmation-store";
import { getDownloadController } from "@/features/media-library/composition/download-controller";

async function shouldAddDuplicate(
  kind: DownloadJobKind,
  platform: string,
  sourceId: string,
  title: string
) {
  const snapshot = await getDownloadController()?.getQueue();
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

function showDownloadResult(
  result: { success: boolean; cancelled?: boolean; error?: string },
  t: (key: "mediaLibrary.downloadAdded" | "mediaLibrary.couldNotStartDownload") => string
) {
  if (result.success) {
    toast.success(t("mediaLibrary.downloadAdded"));
    return;
  }
  if (result.cancelled) return;
  showErrorToast(t("mediaLibrary.couldNotStartDownload"), {
    description: result.error,
  });
}

export function useDownloadActions() {
  const { t } = useTranslation();
  const downloadClip = useCallback(
    async (request: ClipDownloadRequest) => {
      const downloads = getDownloadController();
      if (!downloads) {
        showErrorToast(t("mediaLibrary.downloadsUnavailable"));
        return;
      }
      if (!(await shouldAddDuplicate("clip", request.platform, request.clipId, request.title)))
        return;
      showDownloadResult(await downloads.downloadClip(request), t);
    },
    [t]
  );

  const downloadVideo = useCallback(
    async (request: VideoDownloadRequest) => {
      const downloads = getDownloadController();
      if (!downloads) {
        showErrorToast(t("mediaLibrary.downloadsUnavailable"));
        return;
      }
      if (!(await shouldAddDuplicate("video", request.platform, request.videoId, request.title)))
        return;
      showDownloadResult(await downloads.downloadVideo(request), t);
    },
    [t]
  );

  return { downloadClip, downloadVideo };
}
