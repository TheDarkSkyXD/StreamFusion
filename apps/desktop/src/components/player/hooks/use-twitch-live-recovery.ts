import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { createCancellableSleep, type CancellableSleep } from "@/lib/sleep";

import type { PlayerError } from "../types";

const MAX_AUTOMATIC_REFRESHES = 2;
const RETRY_DELAY_BASE_MS = 1_500;
const SOURCE_CHANGE_TIMEOUT_MS = 2_500;

interface TwitchLiveRecoveryOptions {
  sessionKey: string;
  sourceRevision: string | number;
  onRefresh: () => void;
  onExhausted: (error: PlayerError) => void;
}

interface PendingRecovery {
  delay: CancellableSleep;
  sessionKey: string;
  sourceRevision: string | number;
}

function isRefreshableTwitchError(error: PlayerError): boolean {
  return (
    error.shouldRefresh === true ||
    error.code === "TOKEN_EXPIRED" ||
    error.code === "NO_FRAGMENTS" ||
    error.code === "STREAM_OFFLINE" ||
    error.code === "DECODER_STALL" ||
    error.code === "PLAYBACK_STALL"
  );
}

export function useTwitchLiveRecovery({
  sessionKey,
  sourceRevision,
  onRefresh,
  onExhausted,
}: TwitchLiveRecoveryOptions) {
  const callbacksRef = useRef({ onRefresh, onExhausted });
  const sessionKeyRef = useRef(sessionKey);
  const sourceRevisionRef = useRef(sourceRevision);
  const attemptsRef = useRef(0);
  const pendingRef = useRef<PendingRecovery | null>(null);
  const awaitingSourceRef = useRef(false);
  const exhaustedRef = useRef(false);
  const handleErrorRef = useRef<(error: PlayerError) => boolean>(() => false);

  useLayoutEffect(() => {
    callbacksRef.current = { onRefresh, onExhausted };
  }, [onExhausted, onRefresh]);

  useLayoutEffect(() => {
    if (sessionKeyRef.current === sessionKey) return;
    pendingRef.current?.delay.cancel();
    pendingRef.current = null;
    sessionKeyRef.current = sessionKey;
    sourceRevisionRef.current = sourceRevision;
    attemptsRef.current = 0;
    awaitingSourceRef.current = false;
    exhaustedRef.current = false;
  }, [sessionKey, sourceRevision]);

  useLayoutEffect(() => {
    if (sourceRevisionRef.current === sourceRevision) return;
    pendingRef.current?.delay.cancel();
    pendingRef.current = null;
    sourceRevisionRef.current = sourceRevision;
    awaitingSourceRef.current = false;
  }, [sourceRevision]);

  useEffect(
    () => () => {
      pendingRef.current?.delay.cancel();
      pendingRef.current = null;
    },
    []
  );

  const handleError = useCallback((error: PlayerError): boolean => {
    if (!isRefreshableTwitchError(error)) {
      callbacksRef.current.onExhausted(error);
      return false;
    }

    if (pendingRef.current || awaitingSourceRef.current) return true;
    if (attemptsRef.current >= MAX_AUTOMATIC_REFRESHES) {
      if (!exhaustedRef.current) {
        exhaustedRef.current = true;
        callbacksRef.current.onExhausted(error);
      }
      return false;
    }

    attemptsRef.current += 1;
    const delay = createCancellableSleep(RETRY_DELAY_BASE_MS * attemptsRef.current);
    const pending: PendingRecovery = {
      delay,
      sessionKey: sessionKeyRef.current,
      sourceRevision: sourceRevisionRef.current,
    };
    pendingRef.current = pending;

    void delay.result.then((result) => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      if (!result.ok) return;
      if (
        sessionKeyRef.current !== pending.sessionKey ||
        sourceRevisionRef.current !== pending.sourceRevision
      ) {
        return;
      }
      awaitingSourceRef.current = true;
      callbacksRef.current.onRefresh();

      const sourceChangeDelay = createCancellableSleep(SOURCE_CHANGE_TIMEOUT_MS);
      const sourcePending: PendingRecovery = {
        delay: sourceChangeDelay,
        sessionKey: pending.sessionKey,
        sourceRevision: pending.sourceRevision,
      };
      pendingRef.current = sourcePending;
      void sourceChangeDelay.result.then((sourceResult) => {
        if (pendingRef.current !== sourcePending) return;
        pendingRef.current = null;
        if (!sourceResult.ok) return;
        if (
          sessionKeyRef.current !== sourcePending.sessionKey ||
          sourceRevisionRef.current !== sourcePending.sourceRevision
        ) {
          return;
        }
        awaitingSourceRef.current = false;
        handleErrorRef.current(error);
      });
    });

    return true;
  }, []);

  const markPlaybackHealthy = useCallback(() => {
    pendingRef.current?.delay.cancel();
    pendingRef.current = null;
    attemptsRef.current = 0;
    awaitingSourceRef.current = false;
    exhaustedRef.current = false;
  }, []);

  useLayoutEffect(() => {
    handleErrorRef.current = handleError;
  }, [handleError]);

  return useMemo(
    () => ({ handleError, markPlaybackHealthy }),
    [handleError, markPlaybackHealthy]
  );
}
