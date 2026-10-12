import { importPKCS8, SignJWT } from "jose";

import type {
  FcmPushSender,
  FcmSendResult
} from "../capabilities/fcm-push-sender";

const OAUTH_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type FcmServiceAccount = {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
};

type AccessToken = {
  readonly value: string;
  readonly expiresAt: number;
};

type TokenResult =
  | { readonly kind: "ready"; readonly token: AccessToken }
  | { readonly kind: "failed"; readonly result: FcmSendResult };

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export function parseFcmServiceAccount(
  json: string | undefined
): FcmServiceAccount | null {
  if (json === undefined) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value)) return null;
    const projectId = value.project_id;
    const clientEmail = value.client_email;
    const privateKey = value.private_key;
    if (
      typeof projectId !== "string" ||
      projectId.trim() === "" ||
      typeof clientEmail !== "string" ||
      clientEmail.trim() === "" ||
      typeof privateKey !== "string" ||
      !privateKey.startsWith("-----BEGIN PRIVATE KEY-----") ||
      !privateKey.trimEnd().endsWith("-----END PRIVATE KEY-----")
    ) {
      return null;
    }
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

export function createFcmHttpSender(input: {
  readonly serviceAccount: FcmServiceAccount;
  readonly fetch: Fetch;
  readonly now?: () => number;
}): FcmPushSender {
  const now = input.now ?? Date.now;
  let cachedToken: AccessToken | null = null;
  let pendingToken: Promise<TokenResult> | null = null;

  async function requestToken(): Promise<TokenResult> {
    let assertion: string;
    try {
      const key = await importPKCS8(input.serviceAccount.privateKey, "RS256");
      const issuedAt = Math.floor(now() / 1000);
      assertion = await new SignJWT({ scope: FCM_SCOPE })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(input.serviceAccount.clientEmail)
        .setAudience(OAUTH_URL)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 3600)
        .sign(key);
    } catch {
      return { kind: "failed", result: { kind: "credential-mismatch" } };
    }

    let response: Response;
    try {
      response = await input.fetch(OAUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      return { kind: "failed", result: { kind: "retryable", retryAfterMs: 0 } };
    }
    if (!response.ok) {
      return {
        kind: "failed",
        result:
          response.status === 429 || response.status >= 500
            ? retryable(response, now)
            : { kind: "credential-mismatch" }
      };
    }
    try {
      const body: unknown = await response.json();
      if (!isRecord(body)) throw new Error("Invalid OAuth response");
      const accessToken = body.access_token;
      const expiresIn = body.expires_in;
      if (
        typeof accessToken !== "string" ||
        accessToken.length === 0 ||
        typeof expiresIn !== "number" ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0
      ) {
        throw new Error("Invalid OAuth response");
      }
      const token = { value: accessToken, expiresAt: now() + expiresIn * 1000 };
      cachedToken = token;
      return { kind: "ready", token };
    } catch {
      return { kind: "failed", result: { kind: "retryable", retryAfterMs: 0 } };
    }
  }

  async function getToken(): Promise<TokenResult> {
    if (pendingToken !== null) return pendingToken;
    if (
      cachedToken !== null &&
      now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS
    ) {
      return { kind: "ready", token: cachedToken };
    }
    const pending = requestToken();
    pendingToken = pending;
    try {
      return await pending;
    } finally {
      if (pendingToken === pending) pendingToken = null;
    }
  }

  async function send(
    command: Parameters<FcmPushSender["sendDirect"]>[0],
    token: AccessToken
  ): Promise<FcmSendResult | { readonly kind: "unauthorized" }> {
    let response: Response;
    try {
      response = await input.fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(input.serviceAccount.projectId)}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.value}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: {
              token: command.nativeToken,
              data: {
                payload: JSON.stringify(command.payload),
                silent: String(command.silent)
              },
              android: {
                priority: "HIGH",
                ttl: `${command.ttlSeconds}s`
              }
            }
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        }
      );
    } catch {
      return { kind: "retryable", retryAfterMs: 0 };
    }
    if (response.ok) return { kind: "accepted" };
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 429 || response.status >= 500)
      return retryable(response, now);
    const code = await errorCode(response);
    if (code === "UNREGISTERED") return { kind: "unregistered" };
    if (
      response.status === 403 ||
      code === "SENDER_ID_MISMATCH" ||
      code === "THIRD_PARTY_AUTH_ERROR"
    ) {
      return { kind: "credential-mismatch" };
    }
    return { kind: "rejected" };
  }

  return {
    async sendDirect(command) {
      const firstToken = await getToken();
      if (firstToken.kind === "failed") return firstToken.result;
      const first = await send(command, firstToken.token);
      if (first.kind !== "unauthorized") return first;
      if (cachedToken?.value === firstToken.token.value) cachedToken = null;
      const secondToken = await getToken();
      if (secondToken.kind === "failed") return secondToken.result;
      const second = await send(command, secondToken.token);
      return second.kind === "unauthorized"
        ? { kind: "credential-mismatch" }
        : second;
    }
  };
}

function retryable(response: Response, now: () => number): FcmSendResult {
  const header = response.headers.get("Retry-After");
  if (header === null) return { kind: "retryable", retryAfterMs: 0 };
  const seconds = Number(header);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - now();
  return {
    kind: "retryable",
    retryAfterMs: Number.isFinite(delay) ? Math.max(0, Math.ceil(delay)) : 0
  };
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.error)) return null;
    const details = body.error.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (isRecord(detail) && typeof detail.errorCode === "string") {
          return detail.errorCode;
        }
      }
    }
    return typeof body.error.status === "string" ? body.error.status : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
