import type React from "react";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";

import { SeekPreview } from "../seek-preview";

interface KickProgressBarProps {
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  onSeekHover?: (time: number | null) => void;
  previewImage?: string;
  buffered?: TimeRanges;
  seekableRange?: { start: number; end: number } | null;
  className?: string;
  isLive?: boolean;
}

export interface KickProgressBarHandle {
  /**
   * Imperatively push fresh time values into the bar without triggering React
   * reconciliation. Used by `UptimeReadout` (live player) at 1Hz so the
   * player tree never re-renders for time updates. VOD callers pass
   * `currentTime`/`duration` as props instead and don't attach a ref.
   */
  update: (input: {
    currentTime: number;
    duration: number;
    seekableRange: { start: number; end: number } | null;
  }) => void;
}

// Kick brand green
const KICK_GREEN = "#53fc18";

export const KickProgressBar = forwardRef<KickProgressBarHandle, KickProgressBarProps>(
  function KickProgressBar(
    {
      currentTime = 0,
      duration = 0,
      onSeek,
      onSeekHover,
      previewImage,
      buffered: _buffered,
      seekableRange = null,
      className = "",
      isLive = false,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const progressFillRef = useRef<HTMLDivElement>(null);
    const seekableRangeRef = useRef<HTMLDivElement>(null);
    const [isHovering, setIsHovering] = useState(false);
    const [hoverPosition, setHoverPosition] = useState(0); // 0 to 1

    // Live state mirrors the most recent prop OR ref.update() values. Reads
    // from these refs (handleClick, handleMouseMove) avoid closure staleness
    // when the parent drives updates imperatively.
    const currentTimeRef = useRef(currentTime);
    const durationRef = useRef(duration);
    const seekableRangeStateRef = useRef(seekableRange);
    currentTimeRef.current = currentTime;
    durationRef.current = duration;
    seekableRangeStateRef.current = seekableRange;

    const computeProgressPct = useCallback((current: number, dur: number, live: boolean) => {
      if (live) return 100;
      if (!dur) return 0;
      return Math.min(100, (current / dur) * 100);
    }, []);

    const applyToDom = useCallback(
      (
        ct: number,
        dur: number,
        sr: { start: number; end: number } | null
      ) => {
        const fill = progressFillRef.current;
        if (fill) {
          const pct = computeProgressPct(ct, dur, isLive);
          fill.style.width = `${pct}%`;
        }
        const seek = seekableRangeRef.current;
        if (seek) {
          if (!dur || !sr) {
            seek.style.left = "0%";
            seek.style.width = "0%";
          } else {
            const startPct = Math.max(0, (sr.start / dur) * 100);
            const endPct = Math.min(100, (sr.end / dur) * 100);
            seek.style.left = `${startPct}%`;
            seek.style.width = `${Math.max(0, endPct - startPct)}%`;
          }
        }
      },
      [computeProgressPct, isLive]
    );

    useImperativeHandle(
      ref,
      () => ({
        update: ({ currentTime: ct, duration: dur, seekableRange: sr }) => {
          currentTimeRef.current = ct;
          durationRef.current = dur;
          seekableRangeStateRef.current = sr;
          applyToDom(ct, dur, sr);
        },
      }),
      [applyToDom]
    );

    // Prop-driven render path (VOD callers). The live caller doesn't pass
    // changing currentTime/duration, so this useMemo is stable for them and
    // the ref.update() path drives DOM mutations.
    const progress = useMemo(
      () => computeProgressPct(currentTime, duration, isLive),
      [currentTime, duration, isLive, computeProgressPct]
    );

    const seekableStyle = useMemo(() => {
      if (!duration || !seekableRange) return { left: "0%", width: "0%" };
      const startPct = Math.max(0, (seekableRange.start / duration) * 100);
      const endPct = Math.min(100, (seekableRange.end / duration) * 100);
      return {
        left: `${startPct}%`,
        width: `${Math.max(0, endPct - startPct)}%`,
      };
    }, [duration, seekableRange]);

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width === 0) return;
        const pos = (e.clientX - rect.left) / rect.width;
        const boundedPos = Math.max(0, Math.min(1, pos));
        setHoverPosition(boundedPos);
        onSeekHover?.(boundedPos * durationRef.current);
      },
      [onSeekHover]
    );

    const handleMouseLeave = useCallback(() => {
      setIsHovering(false);
      onSeekHover?.(null);
    }, [onSeekHover]);

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current || !onSeek) return;
        if (isLive) return;

        const dur = durationRef.current;
        if (!dur) return;

        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width === 0) return;
        const pos = (e.clientX - rect.left) / rect.width;
        let time = Math.max(0, Math.min(1, pos)) * dur;

        const sr = seekableRangeStateRef.current;
        if (sr) {
          if (time < sr.start) time = sr.start;
          if (time > sr.end) time = sr.end;
        }

        onSeek(time);
      },
      [onSeek, isLive]
    );

    return (
      <div
        className={`group relative w-full h-4 cursor-pointer flex items-center select-none touch-none ${className}`}
        ref={containerRef}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      >
        {/* Background Track - Darker */}
        <div className="relative w-full h-1 bg-white/10 rounded-full overflow-hidden">
          {/* Seekable Range - White/20 */}
          <div
            ref={seekableRangeRef}
            className="absolute top-0 bottom-0 h-full bg-white/20"
            style={seekableStyle}
          />

          {/* Current Progress - Kick Green */}
          <div
            ref={progressFillRef}
            className="absolute top-0 bottom-0 left-0 h-full"
            style={{ width: `${progress}%`, backgroundColor: KICK_GREEN }}
          />
        </div>

        {/* Thumb (only visible on hover/group-hover) - White */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full scale-0 group-hover:scale-100 transition-transform duration-100 shadow-xl pointer-events-none"
          style={{
            left: `${progress}%`,
            marginLeft: `-${(progress / 100) * 12}px`,
          }}
        />

        {/* Seek Preview Component */}
        {isHovering && durationRef.current > 0 && (
          <SeekPreview
            time={hoverPosition * durationRef.current}
            position={hoverPosition}
            previewImage={previewImage}
            className="border-kick-green/30"
          />
        )}
      </div>
    );
  }
);
