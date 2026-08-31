import { useEffect, useState } from "react";

export function useAfterFirstPaint() {
  const [hasPainted, setHasPainted] = useState(import.meta.env.MODE === "test");

  useEffect(() => {
    if (hasPainted) return;

    const releaseDeferredContent = () => setHasPainted(true);
    const frameId = window.requestAnimationFrame(releaseDeferredContent);
    // timer-allowlist: Chromium can suspend animation frames for occluded Electron windows.
    const fallbackId = window.setTimeout(releaseDeferredContent, 250);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(fallbackId);
    };
  }, [hasPainted]);

  return hasPainted;
}
