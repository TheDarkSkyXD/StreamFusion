import { session, type Cookie, type Cookies } from "electron";

import { logger } from "@backend/logging/logger";

const KICK_WEB_SESSION_COOKIE_NAMES = new Set(["session_token", "kick_session"]);
const KICK_WEB_SESSION_DURABLE_TTL_SECONDS = 400 * 24 * 60 * 60;

function resolveDurableExpiration(cookie: Cookie, nowSeconds: number): number {
  const durableHorizon = nowSeconds + KICK_WEB_SESSION_DURABLE_TTL_SECONDS;
  return Math.max(cookie.expirationDate ?? 0, durableHorizon);
}

/**
 * Promotes Kick's authenticated website cookies to Chromium's maximum durable
 * horizon. Re-running this after a successful hidden-session warmup creates a
 * sliding expiration, while preserving any longer provider-managed expiry.
 */
export async function persistKickWebSessionCookies(
  cookieStore: Pick<Cookies, "get" | "set" | "flushStore">,
  cookies: Cookie[],
  nowMs = Date.now()
): Promise<number> {
  const nowSeconds = Math.floor(nowMs / 1000);
  let persisted = 0;

  for (const cookie of cookies) {
    if (!KICK_WEB_SESSION_COOKIE_NAMES.has(cookie.name) || !cookie.value) continue;

    const cookieDomain = cookie.domain ?? "";
    const domain = cookieDomain.replace(/^\./, "");
    if (!domain || (domain !== "kick.com" && !domain.endsWith(".kick.com"))) continue;

    await cookieStore.set({
      url: `${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`,
      name: cookie.name,
      value: cookie.value,
      ...(!cookie.hostOnly && cookieDomain ? { domain: cookieDomain } : {}),
      path: cookie.path || "/",
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: resolveDurableExpiration(cookie, nowSeconds),
    });
    persisted += 1;
  }

  if (persisted === 0) return 0;

  await cookieStore.flushStore();
  const stored = await cookieStore.get({ domain: "kick.com" });
  const durable = stored.filter(
    (cookie) =>
      KICK_WEB_SESSION_COOKIE_NAMES.has(cookie.name) &&
      cookie.session === false &&
      typeof cookie.expirationDate === "number"
  );
  logger.info("Kick:WebSession", "Durable web session renewed", {
    cookies: durable.map((cookie) => ({
      name: cookie.name,
      session: cookie.session,
      hasExpiration: typeof cookie.expirationDate === "number",
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      hostOnly: cookie.hostOnly,
    })),
  });
  return durable.length;
}

export async function persistDefaultKickWebSessionCookies(nowMs = Date.now()): Promise<number> {
  const cookieStore = session.defaultSession.cookies;
  const cookies = await cookieStore.get({ domain: "kick.com" });
  return persistKickWebSessionCookies(cookieStore, cookies, nowMs);
}
