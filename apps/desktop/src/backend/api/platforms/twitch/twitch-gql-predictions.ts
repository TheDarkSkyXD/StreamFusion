/**
 * Twitch GQL — Viewer-side Prediction Read (U3)
 *
 * Polled GQL read for active predictions on a channel — the post-PubSub-shutdown
 * read path the 5s `twitch-prediction-poller` rides on. Twitch's PubSub
 * `predictions-channel-v1.<channelId>` channel was retired on 2025-04-14, and
 * EventSub `channel.prediction.*` requires broadcaster-scope OAuth — viewers
 * cannot self-authorize to read another broadcaster's predictions. The Hermes
 * WebSocket (`twitch-hermes-client.ts`) carries the same payload anonymously,
 * but the GQL read is needed for two reasons:
 *
 *   1. **Authed viewer self-state.** Hermes is anonymous-only by design. The
 *      `selfPrediction` / `self` field that surfaces `viewerOutcomeId` and
 *      `viewerStake` only appears when a Bearer token is attached. This file
 *      adds the Authorization header conditionally so signed-in-to-Twitch
 *      users see the highlight; guests and StreamFusion-only users get the
 *      same payload minus the self block.
 *
 *   2. **Channel-slug threading.** The Hermes path threads `channelId` only,
 *      because the WebSocket subscription is keyed by numeric id. The GQL
 *      read takes `channelLogin` directly, so we populate `channelSlug` on
 *      the `UnifiedPrediction` result for the multiview filter.
 *
 * **Operation-name uncertainty.** The exact GQL operation name + persisted-query
 * hash for the viewer-side prediction read has not been captured from
 * twitch.tv's live network traffic (predictions are 5-10 minute windows on
 * arbitrary channels; the discovery probe in `docs/solutions/integration-issues/
 * twitch-viewer-prediction-read-discovery-2026-05-18.md` did not catch one).
 * This file ships against a best-guess `ChannelPredictionContext` operation
 * shape derived from twitch.tv's pre-PubSub-shutdown bundle naming conventions
 * and the response fields the widget needs. The document-string GQL path
 * (slower, visible in query body) is used until the live operation name and
 * hash can be verified — see the discovery doc for the verification protocol.
 *
 * TODO(2026-05-NN): Capture the live `ChannelPredictionContext` (or its
 * actual replacement) from twitch.tv DevTools on an active-prediction channel.
 * Reconcile the wire shape against this file's parser and update the
 * operation name + variables interface. Capture findings in
 * `docs/solutions/integration-issues/twitch-prediction-read-discovery-2026-05-NN.md`.
 *
 * Patterns mirrored from:
 *   - `twitch-gql-pin-mutations.ts` (Authorization header + Client-Id + timeout)
 *   - `twitch-pin-poller.ts` (document-string gqlRequest helper)
 *   - `twitch-hermes-client.ts:parsePredictionEvent` (status set, color clamp,
 *     defensive field destructure for evolving Twitch payload)
 */

import type {
  UnifiedPrediction,
  UnifiedPredictionOutcome,
} from "../../../../shared/chat-types";

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
// Android-app Client-Id — bypasses the integrity check pairing the web
// Client-Id requires. Used for ANONYMOUS GQL traffic only (matches the
// strategy at twitch-gql-client.ts:58-65). Authenticated calls must pair the
// user's OAuth token with the app's own Client-Id; otherwise Twitch returns
// 401 (see commit 5fc5a23 for the Helix-side documentation of this invariant).
const ANONYMOUS_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const REQUEST_TIMEOUT_MS = 10_000;

type Status = UnifiedPrediction["status"];

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "LOCKED",
  "RESOLVED",
  "CANCELED",
]);

const VALID_COLORS: ReadonlySet<string> = new Set([
  "blue",
  "pink",
  "yellow",
  "green",
  "orange",
  "purple",
  "red",
  "cyan",
  "brown",
  "gray",
]);

// ---------------------------------------------------------------------------
// Wire types (best-guess shape — see file-header note on operation uncertainty)
// ---------------------------------------------------------------------------

interface TwitchGqlPredictionOutcomeRaw {
  id?: unknown;
  title?: unknown;
  color?: unknown;
  /** Twitch GQL uses `totalPoints` (camelCase) where Hermes uses `total_points`. */
  totalPoints?: unknown;
  totalUsers?: unknown;
  topPredictors?: unknown;
}

interface TwitchGqlPredictionSelfRaw {
  /** Outcome id the viewer voted on. */
  outcomeID?: unknown;
  /** Points the viewer staked. */
  points?: unknown;
}

interface TwitchGqlPredictionRaw {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  outcomes?: unknown;
  winningOutcomeID?: unknown;
  predictionWindowSeconds?: unknown;
  endedAt?: unknown;
  /** Self-state block, present only when a Bearer token is supplied. */
  self?: unknown;
}

interface TwitchGqlChannelRaw {
  /** Numeric broadcaster id — populates UnifiedPrediction.channelId. */
  id?: unknown;
  /** The currently-active prediction, if any. */
  latestPrediction?: unknown;
}

interface TwitchGqlPredictionResponse {
  channel?: TwitchGqlChannelRaw | null;
}

export interface FetchChannelPredictionOptions {
  /**
   * OAuth user-access token from our Twitch auth flow. To attach Authorization,
   * `clientId` must ALSO be supplied — Twitch's GQL endpoint requires the
   * `Client-Id` header to match the token's owning client_id, otherwise the
   * request 401s. When `accessToken` is set but `clientId` is missing, the
   * Authorization header is dropped and the call degrades to anonymous (no
   * `self` block) instead of sending a known-bad pair.
   */
  accessToken?: string;
  /**
   * Twitch app Client-Id that minted the OAuth token (read from
   * `import.meta.env.VITE_TWITCH_CLIENT_ID` in the renderer). Defaults to the
   * Android anonymous Client-Id when omitted. The Authorization header is
   * attached only when this is supplied alongside `accessToken`.
   */
  clientId?: string;
}

/**
 * Fetch the currently-active prediction on a Twitch channel. Returns `null`
 * when:
 *   - No prediction is active (channel.latestPrediction is null)
 *   - The channel doesn't exist
 *   - The response fails defensive validation (missing id / title / unknown status)
 *
 * Throws on:
 *   - HTTP non-2xx (caller handles 401 specifically — see poller for the
 *     refresh-and-retry flow).
 *   - Network / timeout failure.
 *   - GQL `errors[]` is populated (caller logs and skips the tick).
 *
 * Auth-state coverage (per plan U3):
 *   - StreamFusion guest / no Twitch token → Client-Id only; payload parses
 *     without `self` block, banner renders without viewerOutcomeId.
 *   - Signed-in Twitch user → Client-Id + Authorization; payload includes
 *     `self`, banner renders with self-state highlight.
 */
export async function fetchChannelPrediction(
  channelLogin: string,
  opts: FetchChannelPredictionOptions = {},
): Promise<UnifiedPrediction | null> {
  const login = channelLogin.toLowerCase();
  // Authorization is attached only when BOTH a token AND its matching app
  // Client-Id are supplied. A user OAuth token paired with the anonymous
  // Android Client-Id is rejected by Twitch with 401 (Client-Id must match the
  // token's owning client_id), so we fail closed and degrade to anonymous when
  // the pair is incomplete.
  const isAuthenticated = Boolean(opts.accessToken && opts.clientId);
  const headers: Record<string, string> = {
    "Client-Id": opts.clientId ?? ANONYMOUS_CLIENT_ID,
    "Content-Type": "application/json",
  };
  if (isAuthenticated) {
    headers.Authorization = `OAuth ${opts.accessToken}`;
  }

  const body = {
    operationName: "ChannelPredictionContext",
    variables: { channelLogin: login },
    query: CHANNEL_PREDICTION_CONTEXT_QUERY,
  };

  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`ChannelPredictionContext ${res.status}`);
  }

  const json = (await res.json()) as {
    data?: TwitchGqlPredictionResponse;
    errors?: Array<{ message?: string }>;
  };

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors
      .map((e) => e.message ?? "")
      .filter((m) => m.length > 0)
      .join(", ");
    throw new Error(`ChannelPredictionContext errors: ${msg || "unknown"}`);
  }

  const channel = json.data?.channel ?? null;
  if (!channel) return null;
  const channelId = typeof channel.id === "string" ? channel.id : "";
  const rawPrediction = channel.latestPrediction;
  if (!isObject(rawPrediction)) return null;
  return normalizeTwitchPrediction(rawPrediction, {
    channelId,
    channelSlug: login,
  });
}

// ---------------------------------------------------------------------------
// Normalizer (exported for unit testing)
// ---------------------------------------------------------------------------

export interface NormalizeTwitchPredictionOptions {
  /** Broadcaster numeric id from the GQL `channel.id` field. May be empty
   *  string if the response omitted it — falls through to channelSlug for the
   *  multiview filter. */
  channelId: string;
  /** Channel login (lowercased). Always populated by the caller. */
  channelSlug: string;
}

/**
 * Map the GQL prediction shape to `UnifiedPrediction`. Defensive — every
 * destructure tolerates absence so a Twitch payload drift surfaces as
 * `null`-from-parser rather than a runtime throw.
 */
export function normalizeTwitchPrediction(
  raw: unknown,
  opts: NormalizeTwitchPredictionOptions,
): UnifiedPrediction | null {
  if (!isObject(raw)) return null;
  const r = raw as TwitchGqlPredictionRaw;

  const id = typeof r.id === "string" ? r.id : null;
  const title = typeof r.title === "string" ? r.title : null;
  const statusRaw = typeof r.status === "string" ? r.status.toUpperCase() : "";
  if (!id || !title || !VALID_STATUSES.has(statusRaw)) return null;
  const status = statusRaw as Status;

  const outcomesArr = Array.isArray(r.outcomes) ? r.outcomes : [];
  const outcomes: UnifiedPredictionOutcome[] = outcomesArr
    .map((o) => parseOutcome(o))
    .filter((o): o is UnifiedPredictionOutcome => o !== null);
  if (outcomes.length === 0) return null;

  const winningOutcomeId =
    typeof r.winningOutcomeID === "string" && r.winningOutcomeID.length > 0
      ? r.winningOutcomeID
      : null;
  const predictionWindowSeconds =
    typeof r.predictionWindowSeconds === "number"
      ? r.predictionWindowSeconds
      : null;
  const endedAt =
    typeof r.endedAt === "string" && r.endedAt.length > 0 ? r.endedAt : null;

  const self = isObject(r.self) ? (r.self as TwitchGqlPredictionSelfRaw) : null;
  const viewerOutcomeId =
    self && typeof self.outcomeID === "string" && self.outcomeID.length > 0
      ? self.outcomeID
      : null;
  const viewerStake =
    self && typeof self.points === "number" ? self.points : null;

  return {
    id,
    platform: "twitch",
    channelId: opts.channelId,
    channelSlug: opts.channelSlug,
    title,
    status,
    outcomes,
    winningOutcomeId,
    predictionWindowSeconds,
    endedAt,
    viewerOutcomeId,
    viewerStake,
  };
}

type TopPredictor = NonNullable<UnifiedPredictionOutcome["topPredictors"]>[number];

function parseTopPredictor(raw: unknown): TopPredictor | null {
  if (!isObject(raw)) return null;
  const r = raw as {
    user?: unknown;
    userID?: unknown;
    points?: unknown;
  };
  // Twitch's GQL `topPredictors` wraps user info in a nested object, but the
  // wire shape isn't fully verified. Accept either `user.id` / `user.displayName`
  // nesting or the flatter `userID` / `userDisplayName` shape Hermes uses.
  const userObj = isObject(r.user)
    ? (r.user as { id?: unknown; login?: unknown; displayName?: unknown })
    : null;
  const userId =
    typeof r.userID === "string"
      ? r.userID
      : userObj && typeof userObj.id === "string"
        ? userObj.id
        : null;
  const userName = userObj && typeof userObj.displayName === "string"
    ? userObj.displayName
    : userObj && typeof userObj.login === "string"
      ? userObj.login
      : null;
  const amount = typeof r.points === "number" ? r.points : null;
  if (!userId || !userName || amount === null) return null;
  return { userId, userName, amount };
}

function parseOutcome(raw: unknown): UnifiedPredictionOutcome | null {
  if (!isObject(raw)) return null;
  const r = raw as TwitchGqlPredictionOutcomeRaw;
  const id = typeof r.id === "string" ? r.id : null;
  const title = typeof r.title === "string" ? r.title : null;
  if (!id || !title) return null;
  const totalAmount = typeof r.totalPoints === "number" ? r.totalPoints : 0;
  const userCount = typeof r.totalUsers === "number" ? r.totalUsers : 0;
  // Twitch returns color as enum string — UPPERCASE on the GQL surface
  // (BLUE / PINK / sequential palette). Normalize to lowercase so the literal
  // matches our `UnifiedPredictionOutcome.color` type.
  const colorRaw = typeof r.color === "string" ? r.color.toLowerCase() : null;
  const color =
    colorRaw && VALID_COLORS.has(colorRaw)
      ? (colorRaw as UnifiedPredictionOutcome["color"])
      : null;
  const topPredictorsRaw = Array.isArray(r.topPredictors) ? r.topPredictors : null;
  const topPredictors = topPredictorsRaw
    ? topPredictorsRaw
        .map(parseTopPredictor)
        .filter((tp): tp is TopPredictor => tp !== null)
    : undefined;
  return {
    id,
    title,
    color,
    totalAmount,
    userCount,
    ...(topPredictors && topPredictors.length > 0 ? { topPredictors } : {}),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Query body (document-string until persisted-query hash is captured)
// ---------------------------------------------------------------------------

const CHANNEL_PREDICTION_CONTEXT_QUERY = `query ChannelPredictionContext($channelLogin: String!) {
  channel(name: $channelLogin) {
    id
    latestPrediction {
      id
      title
      status
      predictionWindowSeconds
      winningOutcomeID
      endedAt
      outcomes {
        id
        title
        color
        totalPoints
        totalUsers
        topPredictors {
          points
          user { id login displayName }
        }
      }
      self {
        outcomeID
        points
      }
    }
  }
}`;
