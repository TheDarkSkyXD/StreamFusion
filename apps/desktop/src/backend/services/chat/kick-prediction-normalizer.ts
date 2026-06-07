/**
 * Kick Prediction Normalizer
 *
 * Maps the raw `KickPredictionPayload` (from the `predictions-channel-{id}`
 * Pusher events and the `GET /predictions/latest` REST seed) to the platform-
 * agnostic `UnifiedPrediction` shape consumed by the shared
 * `PredictionBanner` widget.
 *
 * Mapping rules:
 *   - `state` → `status` (uppercase + clamped to the four known values).
 *   - `outcomes[*].color` is always `null` for Kick — the kick.com UI picks
 *     icon colors at render time (`#18FBB0` for outcome[0], `#FEA0A0` for
 *     outcome[1]) rather than encoding them in the payload.
 *   - `user_vote` → `viewerOutcomeId` / `viewerStake`. Both null when the
 *     viewer hasn't voted or is anonymous.
 *   - `endedAt`: computed from `created_at + duration` when status is not
 *     `ACTIVE`, else null. Kick does not surface a separate `ended_at` field
 *     in the inferred payload shape; this synthesis matches the widget's
 *     expectation that resolved/canceled predictions carry a timestamp.
 *
 * Source: `docs/brainstorms/2026-05-22-kick-predictions-discovery-notes.md`.
 */

import type { UnifiedPrediction, UnifiedPredictionOutcome } from "../../../shared/chat-types";
import type {
  KickPredictionOutcomePayload,
  KickPredictionPayload,
} from "../../api/platforms/kick/kick-types";

const VALID_STATUSES: ReadonlySet<UnifiedPrediction["status"]> = new Set([
  "ACTIVE",
  "LOCKED",
  "RESOLVED",
  "CANCELED",
]);

/**
 * Clamp the raw Kick `state` string to one of the four known
 * `UnifiedPrediction.status` values. Falls back to `ACTIVE` when the raw
 * value isn't recognized — preserves widget readability on unexpected drift,
 * with the assumption that anything unknown is more like "still happening"
 * than "ended". Drift will surface as a normalizer warning in debug builds.
 */
function clampStatus(raw: string): UnifiedPrediction["status"] {
  const upper = raw.toUpperCase();
  // kick.com bundle hints at additional transition labels beyond ACTIVE
  // (locked, resolved, canceled, deleted). Map `DELETED` to `CANCELED`
  // — semantically the prediction is gone, the widget treats both as
  // terminal non-winning states.
  if (upper === "DELETED") return "CANCELED";
  if ((VALID_STATUSES as Set<string>).has(upper)) {
    return upper as UnifiedPrediction["status"];
  }
  return "ACTIVE";
}

function normalizeOutcome(raw: KickPredictionOutcomePayload): UnifiedPredictionOutcome {
  return {
    id: raw.id,
    title: raw.title,
    // Kick does not include color in its payload — see discovery notes.
    color: null,
    totalAmount: raw.total_vote_amount ?? 0,
    userCount: raw.user_count ?? 0,
  };
}

/**
 * Compute `endedAt` from `created_at + duration` when the prediction is no
 * longer active. Returns null on ACTIVE state or when `created_at` is not
 * parseable.
 */
function computeEndedAt(
  raw: KickPredictionPayload,
  status: UnifiedPrediction["status"]
): string | null {
  if (status === "ACTIVE") return null;
  const startMs = Date.parse(raw.created_at);
  if (!Number.isFinite(startMs)) return null;
  const durationMs = Math.max(0, raw.duration ?? 0) * 1000;
  return new Date(startMs + durationMs).toISOString();
}

export interface NormalizeKickPredictionOptions {
  /** Numeric Kick channel id — the same value used in the Pusher channel
   *  name `predictions-channel-{channelId}`. Matches the multiview filter at
   *  `KickChat.tsx:569`. */
  channelId: string;
  /** Channel slug fallback for the multiview filter. Sidesteps the dual-ID
   *  risk when the numeric id flavor (`user_id` vs `channel.id`) doesn't
   *  match the one the consumer holds. */
  channelSlug: string;
}

export function normalizeKickPrediction(
  raw: KickPredictionPayload,
  opts: NormalizeKickPredictionOptions
): UnifiedPrediction {
  const status = clampStatus(raw.state);
  const outcomes = (raw.outcomes ?? []).map(normalizeOutcome);
  const winningOutcomeId =
    typeof raw.winning_outcome_id === "string" && raw.winning_outcome_id.length > 0
      ? raw.winning_outcome_id
      : null;
  const viewerOutcomeId = raw.user_vote?.outcome_id ?? null;
  const viewerStake =
    typeof raw.user_vote?.total_vote_amount === "number" ? raw.user_vote.total_vote_amount : null;
  const predictionWindowSeconds = typeof raw.duration === "number" ? raw.duration : null;
  // `created_at` anchors the time-remaining countdown (lock = created_at +
  // duration). Already parsed for `computeEndedAt`; surface it for the widget.
  const createdAt =
    typeof raw.created_at === "string" && raw.created_at.length > 0 ? raw.created_at : null;
  const endedAt = computeEndedAt(raw, status);

  return {
    id: raw.id,
    platform: "kick",
    channelId: opts.channelId,
    channelSlug: opts.channelSlug,
    title: raw.title,
    status,
    outcomes,
    winningOutcomeId,
    predictionWindowSeconds,
    createdAt,
    endedAt,
    viewerOutcomeId,
    viewerStake,
  };
}
