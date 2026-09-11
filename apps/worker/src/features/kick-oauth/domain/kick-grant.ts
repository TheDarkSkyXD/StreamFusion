export type KickAuthorizationCodeGrant = { readonly kind: "authorization_code"; readonly code: string; readonly redirectUri: string; readonly codeVerifier: string };
export type KickRefreshGrant = { readonly kind: "refresh_token"; readonly refreshToken: string };
export type KickGrant = KickAuthorizationCodeGrant | KickRefreshGrant;

export async function readKickAuthorizationCodeGrant(request: Request): Promise<KickAuthorizationCodeGrant | null> {
  const body = await readJsonObject(request);
  if (!body) return null;
  const { code, redirect_uri, code_verifier } = body;
  if (!isBoundedString(code, 4096) || !isAllowedKickRedirect(redirect_uri) || !isValidCodeVerifier(code_verifier)) return null;
  return { kind: "authorization_code", code, redirectUri: redirect_uri, codeVerifier: code_verifier };
}

export async function readKickRefreshGrant(request: Request): Promise<KickRefreshGrant | null> {
  const body = await readJsonObject(request);
  if (!body || !isBoundedString(body.refresh_token, 8192)) return null;
  return { kind: "refresh_token", refreshToken: body.refresh_token };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return null;
  try { const body: unknown = await request.json(); return isRecord(body) ? body : null; } catch { return null; }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isBoundedString(value: unknown, maximumLength: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximumLength; }
const KICK_ANDROID_REDIRECT_URI =
  "https://streamfusion.leveluptogetherbiz.workers.dev/auth/kick/android/callback";

function isAllowedKickRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value === KICK_ANDROID_REDIRECT_URI) return true;
  try {
    const redirect = new URL(value); const port = Number(redirect.port);
    return redirect.protocol === "http:" && redirect.hostname === "localhost" && Number.isInteger(port) && port >= 8765 && port <= 8864 && redirect.pathname === "/auth/kick/callback" && redirect.username === "" && redirect.password === "" && redirect.search === "" && redirect.hash === "";
  } catch { return false; }
}
function isValidCodeVerifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value); }
