import type { CSSProperties } from "react";

import { DEFAULT_CAPTION_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import type { TimedTextCue } from "./types";

const CONTROL_SAFE_BOTTOM = "clamp(5rem, 12%, 8rem)";
const ACTIVE_WORD_STYLE: CSSProperties = {
  color: "#dc143c",
  textDecorationLine: "underline",
  textDecorationThickness: "0.12em",
  textUnderlineOffset: "0.12em",
};
const COMPLETED_WORD_STYLE: CSSProperties = { color: "#fff" };

interface CaptionOverlayProps {
  cues: TimedTextCue[];
  localHighlightColor?: string;
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function cueTextAlign(cue: TimedTextCue): CSSProperties["textAlign"] {
  if (cue.align === "start" || cue.align === "left") return "left";
  if (cue.align === "end" || cue.align === "right") return "right";
  return "center";
}

function cueAnchor(cue: TimedTextCue): string {
  if (cue.positionAlign === "line-left") return "0%";
  if (cue.positionAlign === "line-right") return "-100%";
  if (cue.positionAlign === "center") return "-50%";
  if (cue.align === "start" || cue.align === "left") return "0%";
  if (cue.align === "end" || cue.align === "right") return "-100%";
  return "-50%";
}

function cueLineTransform(cue: TimedTextCue): string {
  if (cue.lineAlign === "center") return " translateY(-50%)";
  if (cue.lineAlign === "end") return " translateY(-100%)";
  return "";
}

function cueLayout(cue: TimedTextCue): CSSProperties | null {
  const hasPosition = cue.position !== undefined && cue.position !== "auto";
  const hasLine = cue.line !== undefined && cue.line !== "auto";
  const invalidPosition = hasPosition && !isPercentage(cue.position);
  const percentageLine = hasLine && cue.snapToLines === false && isPercentage(cue.line);
  const snappedLine =
    hasLine &&
    cue.snapToLines !== false &&
    typeof cue.line === "number" &&
    Number.isInteger(cue.line) &&
    cue.line >= -15 &&
    cue.line <= 15;
  const invalidLine = hasLine && !percentageLine && !snappedLine;
  const invalidSize = cue.size !== undefined && !isPercentage(cue.size);
  if (invalidPosition || invalidLine || invalidSize) return null;
  if (!hasPosition && !hasLine) return null;

  const style: CSSProperties = {
    left: `${isPercentage(cue.position) ? cue.position : 50}%`,
    width: `${isPercentage(cue.size) ? cue.size : 85}%`,
    maxWidth: "85%",
    textAlign: cueTextAlign(cue),
    transform: `translateX(${cueAnchor(cue)})${
      percentageLine || snappedLine ? cueLineTransform(cue) : ""
    }`,
  };
  if (percentageLine) {
    style.top = `${cue.line}%`;
  } else if (snappedLine && typeof cue.line === "number") {
    const lineOffset = cue.line >= 0 ? cue.line * 1.5 : (Math.abs(cue.line) - 1) * 1.5;
    if (cue.line >= 0) style.top = lineOffset === 0 ? "5%" : `calc(5% + ${lineOffset}em)`;
    else {
      style.top = `calc(100% - ${CONTROL_SAFE_BOTTOM}${lineOffset ? ` - ${lineOffset}em` : ""})`;
    }
  } else {
    style.bottom = CONTROL_SAFE_BOTTOM;
  }
  return style;
}

function CueText({ cue, highlightColor }: { cue: TimedTextCue; highlightColor?: string }) {
  const local = cue.localLive;
  if (!local) return cue.text;
  if (!local.wordTimingValid && !local.fallbackHighlight) return cue.text;
  const activeStyle = highlightColor
    ? { ...ACTIVE_WORD_STYLE, color: highlightColor }
    : ACTIVE_WORD_STYLE;
  if (local.fallbackHighlight) {
    return (
      <span data-testid="local-caption-active-phrase" style={activeStyle}>
        {cue.text}
      </span>
    );
  }
  return local.words.map((word, index) => {
    const active = index === local.activeWordIndex;
    return (
      <span
        key={`${word.startTime}:${word.endTime}:${index}`}
        data-testid={active ? "local-caption-active-word" : `local-caption-word-${index}`}
        style={active ? activeStyle : COMPLETED_WORD_STYLE}
      >
        {index > 0 ? " " : ""}
        {word.text}
      </span>
    );
  });
}

export function CaptionOverlay({ cues, localHighlightColor }: CaptionOverlayProps) {
  const preferences =
    useAuthStore((state) => state.preferences?.captions) ?? DEFAULT_CAPTION_PREFERENCES;
  if (cues.length === 0) return null;

  const textSizePercent = Math.min(200, Math.max(75, preferences.textSizePercent));
  const backgroundOpacityPercent = Math.min(100, Math.max(0, preferences.backgroundOpacityPercent));
  const cueStyle: CSSProperties = {
    color: "#fff",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: `${(1.25 * textSizePercent) / 100}rem`,
    backgroundColor: `rgba(0, 0, 0, ${backgroundOpacityPercent / 100})`,
  };
  const positionedCues = cues.flatMap((cue) => {
    const layout = cueLayout(cue);
    return layout ? [{ cue, layout }] : [];
  });
  const fallbackCues = cues.filter((cue) => cueLayout(cue) === null);
  const finalLocalCue = [...cues].reverse().find((cue) => cue.localLive?.isFinal === true);

  return (
    <>
      <div
        role="status"
        aria-label="Captions"
        aria-live="off"
        className="pointer-events-none absolute inset-4 z-20"
      >
        {fallbackCues.length > 0 && (
          <div
            className="absolute inset-x-0 flex flex-col items-center gap-1 text-center"
            style={{ bottom: CONTROL_SAFE_BOTTOM }}
          >
            {fallbackCues.map((cue) => (
              <span
                key={cue.localLive?.cueId ?? `${cue.startTime}:${cue.endTime}:${cue.text}`}
                aria-hidden={cue.localLive ? true : undefined}
                data-caption-layout="fallback"
                className="max-w-[85%] whitespace-pre-line rounded-md px-3 py-1 font-semibold leading-snug"
                style={cueStyle}
              >
                <CueText cue={cue} highlightColor={localHighlightColor} />
              </span>
            ))}
          </div>
        )}
        {positionedCues.map(({ cue, layout }) => (
          <span
            key={cue.localLive?.cueId ?? `${cue.startTime}:${cue.endTime}:${cue.text}`}
            aria-hidden={cue.localLive ? true : undefined}
            data-caption-layout="positioned"
            className="absolute whitespace-pre-line rounded-md px-3 py-1 font-semibold leading-snug"
            style={{ ...cueStyle, ...layout }}
          >
            <CueText cue={cue} highlightColor={localHighlightColor} />
          </span>
        ))}
      </div>
      {finalLocalCue && (
        <span
          key={finalLocalCue.localLive?.cueId}
          aria-label="Final caption announcement"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {finalLocalCue.text}
        </span>
      )}
    </>
  );
}
