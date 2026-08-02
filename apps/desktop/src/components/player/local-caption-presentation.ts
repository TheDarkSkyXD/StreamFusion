import type { LocalCaptionResult } from "@/shared/local-caption-types";

import type { TimedTextCue } from "./types";

const MAX_WORD_HISTORY_SECONDS = 30;
const MAX_WORD_FUTURE_SECONDS = 1;

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasValidWordTiming(result: LocalCaptionResult): boolean {
  if (result.words.length === 0) return false;
  if (!Number.isFinite(result.mediaTime) || result.mediaTime < 0) return false;
  if (
    normalizedText(result.words.map((word) => word.text).join(" ")) !== normalizedText(result.text)
  )
    return false;
  const firstWord = result.words[0];
  const lastWord = result.words.at(-1);
  if (
    firstWord.startTime < Math.max(0, result.mediaTime - MAX_WORD_HISTORY_SECONDS) ||
    !lastWord ||
    lastWord.endTime > result.mediaTime + MAX_WORD_FUTURE_SECONDS
  ) {
    return false;
  }

  let previousEnd = -1;
  return result.words.every((word) => {
    const valid =
      word.text.trim().length > 0 &&
      Number.isFinite(word.startTime) &&
      Number.isFinite(word.endTime) &&
      word.startTime >= 0 &&
      word.endTime > word.startTime &&
      word.startTime >= previousEnd;
    previousEnd = word.endTime;
    return valid;
  });
}

function activeWordAt(
  words: Array<{ startTime: number; endTime: number }>,
  mediaTime: number,
  retainLatestAfterEnd: boolean
): number | null {
  const index = words.findIndex((word) => mediaTime >= word.startTime && mediaTime < word.endTime);
  if (index >= 0) return index;
  const lastWord = words.at(-1);
  if (retainLatestAfterEnd && lastWord && mediaTime >= lastWord.endTime) return words.length - 1;
  return null;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function hasValidCueIdentity(
  local: TimedTextCue["localLive"] | undefined
): local is NonNullable<TimedTextCue["localLive"]> {
  return (
    !!local &&
    typeof local.cueId === "string" &&
    local.cueId.trim().length > 0 &&
    positiveSafeInteger(local.revision)
  );
}

function resultIdentity(
  current: TimedTextCue | null,
  result: LocalCaptionResult
): { cueId: string; revision: number } {
  const suppliedCueId = typeof result.cueId === "string" ? result.cueId.trim() : "";
  const sessionId =
    typeof result.sessionId === "string" && result.sessionId.trim()
      ? result.sessionId.trim()
      : "unknown";
  const generation = positiveSafeInteger(result.generation) ? result.generation : 0;
  const cueId = suppliedCueId || `legacy:${sessionId}:${generation}`;
  if (positiveSafeInteger(result.revision)) return { cueId, revision: result.revision };
  if (positiveSafeInteger(result.sequence)) return { cueId, revision: result.sequence };
  const currentLocal = current?.localLive;
  const revision =
    hasValidCueIdentity(currentLocal) && currentLocal.cueId === cueId
      ? Math.min(Number.MAX_SAFE_INTEGER, currentLocal.revision + 1)
      : 1;
  return { cueId, revision };
}

export function advanceLocalCaptionCue(cue: TimedTextCue, mediaTime: number): TimedTextCue {
  const local = cue.localLive;
  if (!local?.wordTimingValid || !Number.isFinite(mediaTime)) return cue;
  const activeWordIndex = activeWordAt(local.words, mediaTime, !local.isFinal);
  if (activeWordIndex === local.activeWordIndex) return cue;
  return { ...cue, localLive: { ...local, activeWordIndex } };
}

export function applyLocalCaptionResult(
  current: TimedTextCue | null,
  result: LocalCaptionResult
): TimedTextCue {
  const { cueId, revision } = resultIdentity(current, result);
  const currentLocal = current?.localLive;
  if (
    current &&
    hasValidCueIdentity(currentLocal) &&
    currentLocal.cueId === cueId &&
    revision <= currentLocal.revision
  ) {
    return current;
  }

  const validWordTiming = hasValidWordTiming(result);
  const safeMediaTime =
    Number.isFinite(result.mediaTime) && result.mediaTime >= 0 ? result.mediaTime : 0;
  const startTime = validWordTiming
    ? (result.words[0]?.startTime ?? safeMediaTime)
    : Math.max(0, safeMediaTime - 0.2);
  const endTime = validWordTiming
    ? Math.max(
        safeMediaTime + (result.isFinal ? 3 : 1),
        result.words.at(-1)?.endTime ?? safeMediaTime
      )
    : safeMediaTime + (result.isFinal ? 3 : 1);
  const activeWordIndex = validWordTiming
    ? activeWordAt(result.words, result.mediaTime, !result.isFinal)
    : null;
  return {
    text: result.text,
    startTime,
    endTime,
    localLive: {
      cueId,
      revision,
      isFinal: result.isFinal,
      words: result.words,
      wordTimingValid: validWordTiming,
      activeWordIndex,
      fallbackHighlight: !validWordTiming && !result.isFinal,
    },
  };
}
