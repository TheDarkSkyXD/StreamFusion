import type React from "react";
import { useCallback, useRef, useState } from "react";

interface UseProgressScrubbingOptions {
  duration: number;
  onSeek?: (time: number) => void;
  onSeekHover?: (time: number | null) => void;
  isLive?: boolean;
  seekableRange?: { start: number; end: number } | null;
  getTimeline?: () => {
    duration: number;
    seekableRange: { start: number; end: number } | null;
  };
}

export function useProgressScrubbing({
  duration,
  onSeek,
  onSeekHover,
  isLive = false,
  seekableRange = null,
  getTimeline,
}: UseProgressScrubbingOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrubbingRef = useRef(false);
  const lastPointerCommitAtRef = useRef(Number.NEGATIVE_INFINITY);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPosition, setHoverPosition] = useState(0);

  const resolvePosition = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const timeline = getTimeline?.();
      const activeDuration = timeline?.duration ?? duration;
      const activeSeekableRange = timeline ? timeline.seekableRange : seekableRange;
      if (!rect || rect.width === 0 || activeDuration <= 0) return null;

      const rawPosition = (clientX - rect.left) / rect.width;
      const boundedPosition = Math.max(0, Math.min(1, rawPosition));
      let time = Math.round(boundedPosition * activeDuration);

      if (activeSeekableRange) {
        time = Math.max(activeSeekableRange.start, Math.min(activeSeekableRange.end, time));
      }

      return { position: time / activeDuration, time };
    },
    [duration, getTimeline, seekableRange]
  );

  const previewAt = useCallback(
    (clientX: number) => {
      const resolved = resolvePosition(clientX);
      if (!resolved) return null;
      setHoverPosition(resolved.position);
      onSeekHover?.(resolved.time);
      return resolved.time;
    },
    [onSeekHover, resolvePosition]
  );

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setIsHovering(true);
      previewAt(event.clientX);
    },
    [previewAt]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      previewAt(event.clientX);
    },
    [previewAt]
  );

  const handleMouseLeave = useCallback(() => {
    if (isScrubbingRef.current) return;
    setIsHovering(false);
    onSeekHover?.(null);
  }, [onSeekHover]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isLive || !onSeek) return;
      isScrubbingRef.current = true;
      setIsHovering(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      previewAt(event.clientX);
    },
    [isLive, onSeek, previewAt]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return;
      previewAt(event.clientX);
    },
    [previewAt]
  );

  const finishPointerScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (!isScrubbingRef.current) return;
      const time = previewAt(event.clientX);
      isScrubbingRef.current = false;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (commit && time !== null) {
        lastPointerCommitAtRef.current = performance.now();
        onSeek?.(time);
      }
    },
    [onSeek, previewAt]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => finishPointerScrub(event, true),
    [finishPointerScrub]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => finishPointerScrub(event, false),
    [finishPointerScrub]
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isLive || !onSeek) return;
      if (performance.now() - lastPointerCommitAtRef.current < 100) return;
      const time = previewAt(event.clientX);
      if (time !== null) onSeek(time);
    },
    [isLive, onSeek, previewAt]
  );

  return {
    containerRef,
    isHovering,
    hoverPosition,
    handleClick,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
