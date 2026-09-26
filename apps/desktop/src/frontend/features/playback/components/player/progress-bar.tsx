import { useMemo } from "react";

import { useProgressScrubbing } from "./hooks/use-progress-scrubbing";
import { SeekPreview } from "./seek-preview";

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onSeekHover?: (time: number | null) => void;
  previewImage?: string;
  buffered?: TimeRanges;
  className?: string;
  color?: string; // Optional accent color class
}

export function ProgressBar({
  currentTime,
  duration,
  onSeek,
  onSeekHover,
  previewImage,
  buffered,
  className = "",
  color = "bg-white",
}: ProgressBarProps) {
  const {
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
  } = useProgressScrubbing({ duration, onSeek, onSeekHover });

  const progress = useMemo(() => {
    if (!duration || duration === 0) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  return (
    <div
      className={`group relative flex h-4 w-full cursor-pointer touch-none select-none items-center max-lg:h-11 ${className}`}
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Background Track */}
      <div className="relative w-full h-1 bg-white/20 rounded-full overflow-hidden">
        {/* Buffered Regions */}
        {buffered &&
          Array.from({ length: buffered.length }).map((_, i) => {
            const start = buffered.start(i);
            const end = buffered.end(i);
            const widthPct = ((end - start) / duration) * 100;
            const startPct = (start / duration) * 100;

            if (!Number.isFinite(widthPct) || !Number.isFinite(startPct)) return null;

            return (
              <div
                key={i}
                className="absolute top-0 bottom-0 bg-white/30 h-full"
                style={{
                  left: `${startPct}%`,
                  width: `${widthPct}%`,
                }}
              />
            );
          })}

        {/* Current Progress */}
        <div
          className={`absolute top-0 bottom-0 left-0 h-full ${color}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div
        className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 scale-0 rounded-full bg-white shadow-xl transition-transform duration-100 group-hover:scale-100 max-lg:scale-100`}
        style={{ left: `${progress}%`, marginLeft: `-${(progress / 100) * 12}px` }} // slight visual fix
      />

      {/* Seek Preview Component */}
      {isHovering && duration > 0 && (
        <SeekPreview
          time={hoverPosition * duration}
          position={hoverPosition}
          previewImage={previewImage}
        />
      )}
    </div>
  );
}
