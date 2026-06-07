import { type RefObject, useCallback, useEffect, useState } from "react";

import { logger } from "@/renderer/logging/logger";

export function useFullscreen(containerRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [containerRef]);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement) {
        await container.requestFullscreen();
      } else {
        // Different element is fullscreen - exit it first
        await document.exitFullscreen();
      }
    } catch (error) {
      logger.error("Player:Hook:Fullscreen", "failed to toggle fullscreen", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }, [containerRef]);

  return { isFullscreen, toggleFullscreen };
}
