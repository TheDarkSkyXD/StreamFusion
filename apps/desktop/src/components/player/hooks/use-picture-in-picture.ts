import { type RefObject, useCallback, useEffect, useState } from "react";

import { logger } from "@/renderer/logging/logger";

export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>) {
  const [isPip, setIsPip] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);

    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);

    return () => {
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, [videoRef]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      logger.error("Player:Hook:PiP", "failed to toggle picture-in-picture", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }, [videoRef]);

  return { isPip, togglePip };
}
