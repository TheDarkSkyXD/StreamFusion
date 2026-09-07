import { type QueryResponseMap } from "twitch-gql-queries";
import type { PlatformFailureClass } from "@backend/api/unified/platform-health";
import { recordPlatformFailure, recordPlatformSuccess } from "@backend/api/unified/platform-health";

import type { GqlError } from "@backend/api/platforms/twitch/twitch-types";

function classifyGqlErrorForHealth(
  error: unknown,
  httpStatus?: number
): PlatformFailureClass | null {
  if (httpStatus !== undefined) {
    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404 || httpStatus === 429)
      return null;
    if (httpStatus >= 500) return "server-5xx";
  }

  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("timeout")) return "timeout";
    if (/gql request failed: 5\d{2}/.test(msg)) return "server-5xx";
    if (/gql request failed: (401|403|404|429)/.test(msg)) return null;
  }

  if (
    error instanceof TypeError ||
    (error instanceof Error && error.message.toLowerCase().includes("fetch"))
  ) {
    return "net-error";
  }

  return null;
}

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";

// Anonymous public-data Client-Id. Twitch's web Client-Id (kimne78…) pairs
// with an integrity token in real browser traffic — without it, anonymous
// requests (especially persisted queries) trip the integrity check. The
// Android-app Client-Id (same one Xtra uses) doesn't enforce that pairing,
// so it's the right default for every anonymous GQL call in this client.
// (The playback / ad-block / manifest-proxy paths still use the web ID
// because they simulate the web client with paired Client-Integrity headers.)
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";

export const MAX_QUERIES_PER_REQUEST = 35;

// Hard timeout on every gql.twitch.tv POST. Without this, a hung Twitch
// endpoint freezes pagination indefinitely — React Query's isFetchingNextPage
// stays true, the dropdown's skeleton flickers stick, and stale queries
// accumulate hung promises in the main process. AbortSignal.timeout throws
// a DOMException("TimeoutError") on expiry, which propagates as a normal
// fetch rejection — useInfiniteQuery surfaces it as query error.
const GQL_REQUEST_TIMEOUT_MS = 10_000;

type GqlQuery = { operationName: keyof QueryResponseMap } | { __response: unknown };

type GqlResponses<TQueries extends readonly GqlQuery[]> = {
  [TIndex in keyof TQueries]: TQueries[TIndex] extends {
    operationName: infer TOperationName;
  }
    ? TOperationName extends keyof QueryResponseMap
      ? QueryResponseMap[TOperationName]
      : never
    : TQueries[TIndex] extends { __response: infer TResponse }
      ? TResponse
      : never;
};

type ValidGqlEnvelope =
  | { data: object | null; errors?: GqlError[] }
  | { data?: never; errors: [GqlError, ...GqlError[]] };

function isGqlError(value: unknown): value is GqlError {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function hasValidGqlEnvelope(value: unknown): value is ValidGqlEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const hasData = "data" in value;
  if (
    hasData &&
    value.data !== null &&
    (typeof value.data !== "object" || Array.isArray(value.data))
  ) {
    return false;
  }
  if (!("errors" in value) || value.errors === undefined) return hasData;
  return Array.isArray(value.errors) && value.errors.length > 0 && value.errors.every(isGqlError);
}

/**
 * Custom gqlRequest that works within Electron (uses global fetch).
 * The `twitch-gql-queries` package's built-in gqlRequest uses browser fetch,
 * which works fine in Electron's main process since Electron exposes fetch.
 */
export async function gqlRequest<const TQueries extends readonly GqlQuery[]>(
  queries: [...TQueries]
): Promise<GqlResponses<TQueries>> {
  if (queries.length === 0) return [] as unknown as GqlResponses<TQueries>;
  if (queries.length > MAX_QUERIES_PER_REQUEST) {
    throw new Error(`Too many queries. Max: ${MAX_QUERIES_PER_REQUEST}`);
  }

  let res: Response;
  try {
    res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Client-Id": GQL_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(queries),
      signal: AbortSignal.timeout(GQL_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const failureClass = classifyGqlErrorForHealth(error);
    if (failureClass) recordPlatformFailure("twitch", failureClass);
    throw error;
  }

  if (!res.ok) {
    const failureClass = classifyGqlErrorForHealth(null, res.status);
    if (failureClass) recordPlatformFailure("twitch", failureClass);
    throw new Error(`GQL request failed: ${res.status} ${res.statusText}`);
  }

  const result: unknown = await res.json();
  if (
    !Array.isArray(result) ||
    result.length !== queries.length ||
    !result.every(hasValidGqlEnvelope)
  ) {
    throw new Error("GQL response did not match the requested query tuple");
  }
  recordPlatformSuccess("twitch");
  return result as GqlResponses<TQueries>;
}

/**
 * POST a single persisted query (not an array). Twitch's pre-registered
 * persisted queries bypass the integrity check that blocks paginated
 * anonymous raw queries.
 */
export async function sendPersistedQuery<T>(
  operationName: string,
  sha256Hash: string,
  variables: Record<string, unknown>
): Promise<{ data?: T; errors?: GqlError[] }> {
  const body = {
    operationName,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash } },
  };

  let res: Response;
  try {
    res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: { "Client-Id": GQL_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GQL_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const failureClass = classifyGqlErrorForHealth(error);
    if (failureClass) recordPlatformFailure("twitch", failureClass);
    throw error;
  }

  if (!res.ok) {
    const failureClass = classifyGqlErrorForHealth(null, res.status);
    if (failureClass) recordPlatformFailure("twitch", failureClass);
    throw new Error(`GQL request failed: ${res.status} ${res.statusText}`);
  }

  const result: unknown = await res.json();
  if (!hasValidGqlEnvelope(result)) {
    throw new Error("GQL response has an invalid error envelope");
  }
  recordPlatformSuccess("twitch");
  return result as { data?: T; errors?: GqlError[] };
}
