import type { AppCredentials } from "../capabilities/discovery-catalog";

type CachedToken = {
  readonly expiresAtEpochMs: number;
  readonly value: string;
};

const KICK_IDENTITY_URL = "https://id.kick.com/oauth/token";
const KICK_API_URL = "https://api.kick.com";

export function createKickClient(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}) {
  let cachedToken: CachedToken | null = null;
  const now = input.now ?? Date.now;

  async function token(): Promise<string | null> {
    if (input.credentials === null) return null;
    if (cachedToken !== null && now() < cachedToken.expiresAtEpochMs)
      return cachedToken.value;
    const payload = await clientCredentialsToken(
      input.fetch,
      input.credentials
    );
    if (payload === null) return null;
    cachedToken = {
      expiresAtEpochMs: now() + payload.expiresInSeconds * 1_000,
      value: payload.value
    };
    return cachedToken.value;
  }

  return {
    async get(path: string): Promise<unknown | null> {
      const accessToken = await token();
      if (accessToken === null) return null;
      try {
        const response = await input.fetch(`${KICK_API_URL}${path}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        return payload;
      } catch {
        return null;
      }
    }
  };
}

async function clientCredentialsToken(
  fetch: typeof globalThis.fetch,
  credentials: AppCredentials
): Promise<{
  readonly value: string;
  readonly expiresInSeconds: number;
} | null> {
  try {
    const response = await fetch(KICK_IDENTITY_URL, {
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "client_credentials"
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST"
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return tokenResponse(payload);
  } catch {
    return null;
  }
}

function tokenResponse(
  value: unknown
): { readonly value: string; readonly expiresInSeconds: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const token = (value as { access_token?: unknown }).access_token;
  const expiresIn = (value as { expires_in?: unknown }).expires_in;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return null;
  }
  return { expiresInSeconds: expiresIn, value: token };
}
