/**
 * Viewer-side vote form for the prediction widget.
 *
 * Renders inside `PredictionBanner.tsx`'s active panel when:
 *   - prediction.status === "ACTIVE"
 *   - prediction.viewerOutcomeId === null (viewer has not voted yet)
 *   - a platform OAuth token is available for the current prediction's
 *     platform (caller branches between this form and the deeplink chip)
 *
 * Auth token retrieval happens at submit time only via
 * `window.electronAPI.auth.getToken(platform)`. Per the auth-state coverage
 * matrix in the plan, the token is NEVER cached in component state — the
 * renderer runs with `webSecurity: false` (window-manager.ts:132) so caching
 * tokens in renderer-visible state is a hardening regression.
 *
 * The in-flight gate (`prediction-vote-gate.ts`) is acquired right before
 * the mutation fires and released in `finally`. The submit button's
 * disabled-during-pending state is the first defense; the gate is the
 * belt-and-suspenders backstop against React commit lag and rapid double-
 * clicks.
 */

import React, { useState } from "react";

import { voteOnPrediction } from "@/backend/api/platforms/kick/kick-prediction-mutations";
import { makePrediction } from "@/backend/api/platforms/twitch/twitch-gql-prediction-mutations";
import {
  acquire as acquireGate,
  predictionVoteGateKey,
  release as releaseGate,
} from "@/lib/prediction-vote-gate";
import type { UnifiedPrediction } from "@/shared/chat-types";

export type PredictionVoteFormBalance =
  | { state: "loaded"; value: number }
  | { state: "loading" }
  | { state: "failed"; reason: string };

export interface PredictionVoteFormProps {
  prediction: UnifiedPrediction;
  /** Twitch login (lowercased) or Kick slug — passed by parent. */
  channelLogin: string;
  balance: PredictionVoteFormBalance;
  onVoteSuccess?: (outcomeId: string, amount: number) => void;
}

/** Twitch documents 250k as the max channel-points per vote; Kick matches. */
const MAX_STAKE = 250_000;

/**
 * Per-`kind` user-facing copy. `unknown` collapses to a generic line and the
 * raw message is logged at warn level only — never echoed to the UI (doc-
 * review SEC-005).
 */
type ErrorKind =
  | "insufficientBalance"
  | "outcomeLocked"
  | "predictionGone"
  | "unauthenticated"
  | "auth"
  | "integrity"
  | "network"
  | "invalidInput"
  | "unknown"
  | "forbidden";

function errorCopy(
  platform: "twitch" | "kick",
  kind: ErrorKind,
): string {
  switch (kind) {
    case "insufficientBalance":
      return platform === "twitch" ? "Not enough points" : "Not enough KCP";
    case "outcomeLocked":
      return "Voting closed before your vote registered";
    case "predictionGone":
      return "Prediction ended";
    case "unauthenticated":
    case "auth":
      return platform === "twitch" ? "Reconnect Twitch to vote" : "Reconnect Kick to vote";
    case "integrity":
      return "Twitch is rate-limiting — try again in a moment";
    case "network":
      return "Network error — try again";
    case "invalidInput":
      return "Invalid input — please try again";
    case "forbidden":
      return "Voting not allowed for this prediction";
    case "unknown":
    default:
      return "Unexpected error — please try again";
  }
}

export const PredictionVoteForm: React.FC<PredictionVoteFormProps> = ({
  prediction,
  channelLogin,
  balance,
  onVoteSuccess,
}) => {
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  const numericAmount = Number.parseInt(amount, 10);
  const amountIsValidNumber = Number.isFinite(numericAmount) && numericAmount > 0;
  const exceedsMax = amountIsValidNumber && numericAmount > MAX_STAKE;
  const exceedsBalance =
    balance.state === "loaded" && amountIsValidNumber && numericAmount > balance.value;
  const localValidationPasses =
    amountIsValidNumber && !exceedsMax && !exceedsBalance;

  const balanceLoading = balance.state === "loading";
  const submitDisabled =
    !selectedOutcomeId ||
    !localValidationPasses ||
    pending ||
    balanceLoading;

  const handleSubmit = async () => {
    if (!selectedOutcomeId) return;
    if (!localValidationPasses) return;

    const key = predictionVoteGateKey(
      prediction.platform,
      channelLogin,
      prediction.id,
    );
    if (!acquireGate(key)) return;

    setPending(true);
    setErrorKind(null);

    try {
      const tokenRec = await window.electronAPI.auth.getToken(prediction.platform);
      if (!tokenRec?.accessToken) {
        setErrorKind("auth");
        return;
      }

      const result =
        prediction.platform === "twitch"
          ? await makePrediction({
              accessToken: tokenRec.accessToken,
              eventID: prediction.id,
              outcomeID: selectedOutcomeId,
              points: numericAmount,
            })
          : await voteOnPrediction({
              accessToken: tokenRec.accessToken,
              channelSlug: channelLogin,
              predictionId: prediction.id,
              outcomeId: selectedOutcomeId,
              amount: numericAmount,
            });

      if (result.ok) {
        onVoteSuccess?.(selectedOutcomeId, numericAmount);
        return;
      }

      // Per doc-review SEC-005: only log the raw message at warn level for
      // `unknown` — never render the raw message in the UI.
      if (result.kind === "unknown") {
        console.warn(
          "[PredictionVoteForm] unknown vote error",
          result.message,
        );
      }
      setErrorKind(result.kind as ErrorKind);
    } catch (err) {
      console.warn("[PredictionVoteForm] vote submit threw", err);
      setErrorKind("network");
    } finally {
      releaseGate(key);
      setPending(false);
    }
  };

  const platformUnit = prediction.platform === "twitch" ? "points" : "KCP";

  const balanceLine = (() => {
    if (balance.state === "loaded") {
      return `Available: ${balance.value.toLocaleString()} ${platformUnit}`;
    }
    if (balance.state === "loading") return "Loading balance…";
    return "Balance unavailable";
  })();

  const preflightHint = (() => {
    if (!amountIsValidNumber) return null;
    if (exceedsMax) return `Maximum ${MAX_STAKE.toLocaleString()} per vote`;
    if (exceedsBalance && balance.state === "loaded") {
      return prediction.platform === "twitch"
        ? `Not enough points — your balance is ${balance.value.toLocaleString()}`
        : `Not enough KCP — your balance is ${balance.value.toLocaleString()}`;
    }
    return null;
  })();

  const showRetry = errorKind === "network";

  return (
    <div
      data-testid="prediction-vote-form"
      className="flex flex-col gap-2 rounded-md bg-[#18181b] px-2 py-2"
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        Cast your vote
      </div>

      {/* Outcome buttons */}
      <div
        className="flex flex-col gap-1"
        role="radiogroup"
        aria-label="Pick an outcome"
      >
        {prediction.outcomes.map((o, index) => {
          const picked = selectedOutcomeId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-testid={`vote-outcome-${o.id}`}
              onClick={() => setSelectedOutcomeId(o.id)}
              className={
                "flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] font-semibold transition-colors " +
                (picked
                  ? "bg-storm-accent/20 text-white ring-1 ring-storm-accent/60"
                  : "bg-black/30 text-zinc-300 hover:bg-black/50")
              }
            >
              <span className="truncate">
                {index + 1}. {o.title}
              </span>
              {picked && (
                <span aria-hidden className="text-[10px] text-storm-accent">
                  Picked
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stake input */}
      <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
        <span>Stake ({platformUnit})</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_STAKE}
          step={1}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            // Clear stale error as the user re-types.
            if (errorKind) setErrorKind(null);
          }}
          aria-label="Stake amount"
          data-testid="vote-stake-input"
          className="rounded bg-black/40 px-2 py-1 text-[12px] text-white outline-none focus:ring-1 focus:ring-storm-accent/60"
        />
        <span
          className="text-[10px] text-zinc-500"
          data-testid="vote-balance-line"
          data-balance-state={balance.state}
        >
          {balanceLine}
        </span>
        {preflightHint && (
          <span
            className="text-[10px] text-amber-300"
            data-testid="vote-preflight-hint"
          >
            {preflightHint}
          </span>
        )}
      </label>

      {/* Submit */}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitDisabled}
        data-testid="vote-submit"
        className="rounded bg-storm-accent px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-storm-accent/80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Submit vote"}
      </button>

      {/* Error area */}
      {errorKind && (
        <div
          role="alert"
          data-testid="vote-error"
          data-error-kind={errorKind}
          className="flex items-center justify-between gap-2 rounded bg-red-900/20 px-2 py-1 text-[11px] text-red-300"
        >
          <span>{errorCopy(prediction.platform, errorKind)}</span>
          {showRetry && (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              data-testid="vote-retry"
              className="rounded bg-red-700/40 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700/60"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
};
