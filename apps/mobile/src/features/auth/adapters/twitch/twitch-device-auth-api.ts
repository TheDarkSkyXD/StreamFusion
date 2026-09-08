import {
  twitchAccountId,
  type TwitchAccountLookupResult,
  type TwitchCancellationSignal,
  type TwitchDeviceAuthorization,
  type TwitchDeviceAuthorizationGateway,
  type TwitchDevicePollResult,
  type TwitchRefreshDispatchResult,
  type TwitchTokenValidationResult,
} from "@streamfusion/core/auth";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Twitch returned an invalid response.");
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`Twitch omitted ${name}.`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0)
    throw new Error(`Twitch returned an invalid ${name}.`);
  return Number(value);
}

function scopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error("Twitch returned invalid scopes.");
  return value;
}

function form(values: Readonly<Record<string, string>>): string {
  return new URLSearchParams(values).toString();
}

function verificationUri(value: unknown): string {
  const uri = new URL(text(value, "verification_uri"));
  if (uri.protocol !== "https:" || uri.hostname !== "www.twitch.tv")
    throw new Error("Twitch returned an invalid verification URI.");
  return uri.toString();
}

async function withResponse<T>(options: {
  readonly cancellation: TwitchCancellationSignal;
  readonly consume: (response: Response) => Promise<T>;
  readonly fetcher: Fetcher;
  readonly init?: RequestInit;
  readonly timeoutMilliseconds: number;
  readonly url: string;
}): Promise<T> {
  const controller = new AbortController();
  const removeListener = options.cancellation.onCancel(() =>
    controller.abort(),
  );
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMilliseconds,
  );
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

export function createTwitchDeviceAuthApi(options: {
  readonly clientId: string;
  readonly fetch?: Fetcher;
  readonly timeoutMilliseconds?: number;
}): TwitchDeviceAuthorizationGateway {
  if (!options.clientId.trim())
    throw new Error("Mobile Twitch Device Code configuration is unavailable.");
  const fetcher = options.fetch ?? fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0)
    throw new Error("The Twitch request timeout is invalid.");
  const execute = <T>(input: {
    readonly cancellation: TwitchCancellationSignal;
    readonly consume: (response: Response) => Promise<T>;
    readonly init?: RequestInit;
    readonly url: string;
  }) => withResponse({ ...input, fetcher, timeoutMilliseconds });

  return {
    async loadAccount(
      accessToken,
      userId,
      cancellation,
    ): Promise<TwitchAccountLookupResult> {
      try {
        return await execute({
          cancellation,
          url: `https://api.twitch.tv/helix/users?id=${encodeURIComponent(userId)}`,
          init: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Client-Id": options.clientId,
            },
          },
          consume: async (response) => {
            if (response.status === 401) return { kind: "revoked" };
            if (!response.ok)
              return {
                kind: "transient-failure",
                cause: new Error(
                  `Twitch account lookup failed with HTTP ${response.status}.`,
                ),
              };
            try {
              const body = record(await response.json());
              if (!Array.isArray(body.data) || body.data.length !== 1)
                throw new Error("Twitch did not return the validated account.");
              const value = record(body.data[0]);
              const id = twitchAccountId(text(value.id, "user id"));
              if (id !== userId)
                throw new Error("Twitch returned a different account.");
              return {
                kind: "found",
                account: {
                  id,
                  login: text(value.login, "login"),
                  displayName: text(value.display_name, "display name"),
                  profileImageUrl:
                    typeof value.profile_image_url === "string" &&
                    value.profile_image_url
                      ? value.profile_image_url
                      : null,
                },
              };
            } catch (cause) {
              return { kind: "transient-failure", cause };
            }
          },
        });
      } catch (cause) {
        return { kind: "transient-failure", cause };
      }
    },
    request(requestedScopes, cancellation): Promise<TwitchDeviceAuthorization> {
      return execute({
        cancellation,
        url: "https://id.twitch.tv/oauth2/device",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form({
            client_id: options.clientId,
            scopes: requestedScopes.join(" "),
          }),
        },
        consume: async (response) => {
          if (!response.ok)
            throw new Error(
              `Twitch device authorization failed with HTTP ${response.status}.`,
            );
          const body = record(await response.json());
          return {
            deviceCode: text(body.device_code, "device_code"),
            userCode: text(body.user_code, "user_code"),
            verificationUri: verificationUri(body.verification_uri),
            expiresInSeconds: positiveInteger(body.expires_in, "expires_in"),
            intervalSeconds: positiveInteger(body.interval, "interval"),
          };
        },
      });
    },
    async poll(deviceCode, cancellation): Promise<TwitchDevicePollResult> {
      try {
        return await execute<TwitchDevicePollResult>({
          cancellation,
          url: "https://id.twitch.tv/oauth2/token",
          init: {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form({
              client_id: options.clientId,
              device_code: deviceCode,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          },
          consume: async (response) => {
            if (response.status === 429) {
              const seconds = Number(response.headers.get("Retry-After") ?? 5);
              return {
                kind: "slow-down",
                retryAfterSeconds:
                  Number.isInteger(seconds) && seconds > 0 ? seconds : 5,
              };
            }
            const body = record(await response.json());
            if (response.ok)
              return {
                kind: "authorized",
                accessToken: text(body.access_token, "access_token"),
                refreshToken: text(body.refresh_token, "refresh_token"),
                expiresInSeconds: positiveInteger(
                  body.expires_in,
                  "expires_in",
                ),
                scopes: scopes(body.scope),
              };
            if (body.message === "authorization_pending")
              return { kind: "pending" };
            if (body.message === "slow_down") {
              const seconds = Number(response.headers.get("Retry-After") ?? 5);
              return {
                kind: "slow-down",
                retryAfterSeconds:
                  Number.isInteger(seconds) && seconds > 0 ? seconds : null,
              };
            }
            if (body.message === "invalid device code")
              return { kind: "expired" };
            if (body.message === "access_denied") return { kind: "denied" };
            throw new Error(
              `Twitch device polling failed with HTTP ${response.status}.`,
            );
          },
        });
      } catch {
        return { kind: "transient-failure" };
      }
    },
    async refresh(
      refreshToken,
      cancellation,
    ): Promise<TwitchRefreshDispatchResult> {
      if (cancellation.aborted)
        return {
          kind: "not-sent",
          cause: new Error("Twitch refresh was cancelled before dispatch."),
        };
      try {
        return await execute({
          cancellation,
          url: "https://id.twitch.tv/oauth2/token",
          init: {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form({
              client_id: options.clientId,
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            }),
          },
          consume: async (response) => {
            const body = record(await response.json());
            if (!response.ok) return { kind: "rejected" };
            return {
              kind: "refreshed",
              accessToken: text(body.access_token, "access_token"),
              refreshToken: text(body.refresh_token, "refresh_token"),
              expiresInSeconds: positiveInteger(body.expires_in, "expires_in"),
              scopes: scopes(body.scope),
            };
          },
        });
      } catch (cause) {
        return { kind: "outcome-unknown", cause };
      }
    },
    async validate(
      accessToken,
      cancellation,
    ): Promise<TwitchTokenValidationResult> {
      try {
        return await execute({
          cancellation,
          url: "https://id.twitch.tv/oauth2/validate",
          init: { headers: { Authorization: `OAuth ${accessToken}` } },
          consume: async (response) => {
            if (response.status === 401) return { kind: "revoked" };
            if (!response.ok)
              return {
                kind: "transient-failure",
                cause: new Error(
                  `Twitch validation failed with HTTP ${response.status}.`,
                ),
              };
            const body = record(await response.json());
            return {
              kind: "valid",
              validation: {
                clientId: text(body.client_id, "client_id"),
                userId: twitchAccountId(text(body.user_id, "user_id")),
                login: text(body.login, "login"),
                scopes: scopes(body.scopes),
                expiresInSeconds: positiveInteger(
                  body.expires_in,
                  "expires_in",
                ),
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
