import { useEffect, useState } from "react";

export function useAfterFirstPaint() {
  const [hasPainted, setHasPainted] = useState(import.meta.env.MODE === "test");

  useEffect(() => {
    if (hasPainted) return;

    const frameId = window.requestAnimationFrame(() => setHasPainted(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [hasPainted]);

  return hasPainted;
}
