/**
 * Twitch Helix retry-on-401 wrapper.
 *
 * The standalone Helix client functions (getPolls, getPredictions,
 * getModerators, getVips, getUnbanRequests, getChatSettings, getBannedList,
 * the moderation-mutation pair) accept `accessToken` as input and don't
 * refresh on 401 — they just surface the failure to the caller. Compared to
 * TwitchRequestor (which auto-refreshes via getValidAccessToken before every
 * call AND retries once on 401), every standalone client is one stale-token
 * window away from a user-visible failure.
 *
 * This wrapper closes that gap. Pass it a result-discriminated-union Helix
 * function and its args; on `kind: "unauthorized"` it calls the main-process
 * IPC for a guaranteed-fresh token and retries once. Other failure kinds
 * (forbidden, missing-scopes, not-found, rate-limited, network) pass through
 * unchanged — those reflect genuine app state or transient infra issues, not
 * token staleness.
 */

type UnauthorizedKind = { ok: false; kind: "unauthorized" };

type HelixCallResult =
  | { ok: true; payload?: unknown }
  | UnauthorizedKind
  | { ok: false; kind: string; message?: string };

type HasAccessToken = { accessToken: string };

/**
 * Run a Helix call. On `ok: false, kind: "unauthorized"`, refresh the Twitch
 * token via `electronAPI.auth.getValidTwitchToken()` and retry once with the
 * fresh token. Returns the second attempt's result on retry, or the first
 * result if retry is skipped (token didn't change, refresh returned null,
 * different failure kind).
 *
 * @param args A Helix-function args object containing `accessToken`.
 * @param fn The Helix function — for example `getPolls`, `getModerators`.
 */
export async function withTwitchHelixRetry<A extends HasAccessToken, R extends HelixCallResult>(
  args: A,
  fn: (a: A) => Promise<R>,
): Promise<R> {
  const first = await fn(args);
  if (first.ok) return first;
  if (first.kind !== "unauthorized") return first;

  const fresh = await window.electronAPI.auth.getValidTwitchToken();
  if (!fresh || fresh === args.accessToken) return first;

  return fn({ ...args, accessToken: fresh });
}
