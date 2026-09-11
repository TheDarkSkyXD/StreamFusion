import {
  kickAccountId,
  type KickAccountLookupResult,
  type KickAuthorizationGateway,
  type KickCancellationSignal,
  type KickRefreshDispatchResult,
  type KickTokenExchangeResult,
} from "@streamfusion/core/auth";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const KICK_USERS_URL = "https://api.kick.com/public/v1/users";
const DEFAULT_WORKER_BASE =
  "https://streamfusion.leveluptogetherbiz.workers.dev";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`Kick omitted ${name}.`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0)
    throw new Error(`Kick returned an invalid ${name}.`);
  return Number(value);
}

function scopes(value: unknown): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value;
  if (typeof value === "string")
    return value.split(/\s+/).filter((scope) => scope.length > 0);
  throw new Error("Kick returned invalid scopes.");
}

function parseTokenBody(value: unknown): {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
} {
  if (!isRecord(value)) throw new Error("Kick returned an invalid token body.");
  return {
    accessToken: text(value.access_token, "access_token"),
    expiresInSeconds: positiveInteger(value.expires_in, "expires_in"),
    refreshToken: text(value.refresh_token, "refresh_token"),
    scopes: scopes(value.scope),
  };
}

async function withResponse<T>(options: {
  readonly cancellation: KickCancellationSignal;
  readonly consume: (response: Response) => Promise<T>;
  readonly fetcher: Fetcher;
  readonly init?: RequestInit;
  readonly timeoutMilliseconds: number;
  readonly url: string;
}): Promise<T> {
  const controller = new AbortController();
  const removeListener = options.cancellation.onCancel(() => controller.abort());
  const timeout = setTimeout(() => controller.abort(), options.timeoutMilliseconds);
  if (options.cancellation.aborted) controller.abort();
  try {
    const response = await options.fetcher(options.url, {
      ...options.init,
      signal: controller.signal,
    });
    return await options.consume(response);
  } finally {
    clearTimeout(timeout);
    removeListener();
  }
}

export function createKickOAuthApi(options: {
  readonly fetcher?: Fetcher;
  readonly workerBaseUrl?: string;
}): KickAuthorizationGateway {
  const fetcher = options.fetcher ?? fetch;
  const workerBase = (options.workerBaseUrl ?? DEFAULT_WORKER_BASE).replace(/\/$/, "");
  return {
    async exchange(input): Promise<KickTokenExchangeResult> {
      try {
        return await withResponse({
          cancellation: input.signal,
          fetcher,
          timeoutMilliseconds: 15_000,
          url: `${workerBase}/auth/kick/token`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: input.code,
              redirect_uri: input.redirectUri,
              code_verifier: input.codeVerifier,
            }),
          },
          consume: async (response) => {
            if (response.status === 400 || response.status === 401)
              return { kind: "rejected" as const };
            if (!response.ok)
              return { kind: "transient-failure" as const, cause: response.status };
            return { kind: "exchanged" as const, ...parseTokenBody(await response.json()) };
          },
        });
      } catch (cause) {
        return { kind: "transient-failure", cause };
      }
    },
    async refresh(refreshToken, signal): Promise<KickRefreshDispatchResult> {
      try {
        return await withResponse({
          cancellation: signal,
          fetcher,
          timeoutMilliseconds: 15_000,
          url: `${workerBase}/auth/kick/refresh`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
          },
          consume: async (response) => {
            if (response.status === 400 || response.status === 401)
              return { kind: "rejected" as const };
            if (!response.ok)
              return { kind: "outcome-unknown" as const, cause: response.status };
            return { kind: "refreshed" as const, ...parseTokenBody(await response.json()) };
          },
        });
      } catch (cause) {
        return { kind: "not-sent", cause };
      }
    },
    async loadAccount(accessToken, signal): Promise<KickAccountLookupResult> {
      try {
        return await withResponse({
          cancellation: signal,
          fetcher,
          timeoutMilliseconds: 15_000,
          url: KICK_USERS_URL,
          init: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          },
          consume: async (response) => {
            if (response.status === 401) return { kind: "revoked" as const };
            if (!response.ok)
              return { kind: "transient-failure" as const, cause: response.status };
            const body: unknown = await response.json();
            if (!isRecord(body) || !Array.isArray(body.data) || !isRecord(body.data[0]))
              throw new Error("Kick returned an invalid user.");
            const user = body.data[0];
            const id = String(user.user_id ?? "");
            const login = text(user.name, "name");
            return {
              kind: "found" as const,
              account: {
                id: kickAccountId(id),
                login,
                displayName: login,
                profileImageUrl:
                  typeof user.profile_picture === "string" ? user.profile_picture : null,
              },
            };
          },
        });
      } catch (cause) {
        return { kind: "transient-failure", cause };
      }
    },
  };
}
