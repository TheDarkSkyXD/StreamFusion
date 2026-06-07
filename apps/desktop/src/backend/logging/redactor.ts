// Last line of defence before OAuth tokens, refresh tokens, client secrets,
// OAuth `code` values, and JWTs hit disk. Every log line written by the logger
// passes through this module first. Pure functions only — no IO, no logging,
// no side effects. Bug-report log files are routinely shared by users.

const REDACTED = "[REDACTED]";

// Keys whose value is always replaced wholesale when encountered in an object
// graph (case-insensitive). `client_id` is included because Twitch/Kick treat
// it as a credential alongside the secret.
const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "client_secret",
  "client_id",
  "password",
  "authorization",
  "token",
]);

// Bearer / bearer prefix, then any run of non-whitespace (token bodies are
// opaque so we accept anything until a whitespace boundary).
const BEARER_RE = /\b(bearer)\s+([^\s,;}"']+)/gi;

// Query-string-style sensitive params. Token chars are restricted to the
// URL-safe set so we stop cleanly at `&`, whitespace, or end-of-string.
const QUERY_TOKEN_RE = /\b(access_token|refresh_token|client_secret)=([A-Za-z0-9._~-]+)/g;

// OAuth callback `code=` is matched conservatively: only when the surrounding
// string indicates an oauth2 callback context. Matching every `code=` would
// scrub HTTP status codes ("code=429") and other innocuous occurrences.
const OAUTH_CALLBACK_HINT = /oauth2?\/callback|oauth2?\/authorize|\?code=[A-Za-z0-9._~-]+&?state=/i;
const OAUTH_CODE_RE = /\bcode=([A-Za-z0-9._~-]+)/g;

// JSON-encoded sensitive fields. Tolerates whitespace around the colon. The
// value pattern stops at the next unescaped double quote.
const JSON_FIELD_RE =
  /("(?:access_token|refresh_token|client_secret|client_id)")\s*:\s*"((?:\\.|[^"\\])*)"/gi;

// JWT-style three-part dot tokens. Each part is base64url; the overall match
// must be > 40 chars to avoid hitting version strings like "1.2.3-beta.1".
// Anchored on word boundaries so we don't chew adjacent characters.
const JWT_RE = /\b([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;
const JWT_MIN_LEN = 40;

export function redactString(input: string): string {
  if (input.length === 0) return input;

  let out = input;

  out = out.replace(BEARER_RE, (_match, prefix: string) => `${prefix} ${REDACTED}`);

  out = out.replace(QUERY_TOKEN_RE, (_match, key: string) => `${key}=${REDACTED}`);

  if (OAUTH_CALLBACK_HINT.test(out)) {
    out = out.replace(OAUTH_CODE_RE, `code=${REDACTED}`);
  }

  out = out.replace(JSON_FIELD_RE, (_match, key: string) => `${key}:"${REDACTED}"`);

  out = out.replace(JWT_RE, (match) => (match.length >= JWT_MIN_LEN ? REDACTED : match));

  return out;
}

export function redactObject<T>(input: T): T {
  return redactWalk(input, new WeakSet<object>()) as T;
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return redactString(value as string);
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol" || t === "function") {
    return value;
  }

  // Opaque binary types and Date instances are passed through as-is. Walking
  // a Buffer byte-by-byte would (a) be expensive and (b) corrupt non-UTF-8
  // payloads. Dates have no nested user data worth scrubbing.
  if (value instanceof Date) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  if (value instanceof ArrayBuffer) return value;

  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactWalk(item, seen));
  }

  if (t === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const v = src[key];
      if (SENSITIVE_KEYS.has(key.toLowerCase()) && typeof v === "string" && v.length > 0) {
        out[key] = REDACTED;
      } else {
        out[key] = redactWalk(v, seen);
      }
    }
    return out;
  }

  return value;
}
