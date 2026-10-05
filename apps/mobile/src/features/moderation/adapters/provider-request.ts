import type {
  ProviderCredential,
  ProviderResult,
} from "../capabilities/moderation";

export function createProviderRequest(fetcher: typeof globalThis.fetch) {
  return async function request({
    credential,
    path,
    method = "GET",
    body,
    signal,
  }: {
    readonly credential: ProviderCredential;
    readonly path: string;
    readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
    readonly body?: unknown;
    readonly signal: AbortSignal;
  }): Promise<ProviderResult<unknown>> {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential.accessToken}`,
      };
      if (credential.platform === "twitch")
        headers["Client-Id"] = credential.clientId;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const base =
        credential.platform === "twitch"
          ? "https://api.twitch.tv/helix"
          : "https://api.kick.com/public/v1";
      const response = await fetcher(`${base}${path}`, {
        method,
        headers,
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const reason =
          response.status === 401
            ? "auth"
            : response.status === 403
              ? "permission"
              : response.status === 429
                ? "rate-limit"
                : response.status === 400
                  ? "invalid"
                  : "provider";
        const guidance =
          reason === "auth"
            ? "Reconnect this account before trying again."
            : reason === "permission"
              ? "The provider denied this role or scope. Verify your account permissions."
              : reason === "rate-limit"
                ? "The provider rate limit was reached. Wait before trying again."
                : "The provider rejected this request. Refresh the channel before trying again.";
        return {
          kind: "failure",
          reason,
          detail: `${credential.platform === "twitch" ? "Twitch" : "Kick"} returned ${response.status}. ${guidance}`,
        };
      }
      if (response.status === 204) return { kind: "success", value: null };
      const value: unknown = await response.json();
      return { kind: "success", value };
    } catch {
      return {
        kind: "failure",
        reason: "network",
        detail:
          method === "GET"
            ? "Could not reach the provider. Check your connection."
            : "The request was interrupted. The provider may have applied the action. Refresh before retrying.",
      };
    }
  };
}

export function object(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function rows(value: unknown): readonly unknown[] | null {
  const envelope = object(value);
  return envelope && Array.isArray(envelope.data) ? envelope.data : null;
}
export function malformed(): {
  readonly kind: "failure";
  readonly reason: "provider";
  readonly detail: string;
} {
  return {
    kind: "failure",
    reason: "provider",
    detail:
      "The provider returned an unexpected response. No action was confirmed.",
  };
}
