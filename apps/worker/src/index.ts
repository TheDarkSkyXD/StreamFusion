export interface Env {
    KICK_CLIENT_ID: string;
    KICK_CLIENT_SECRET: string;
    KICK_AUTH_IP_RATE_LIMITER: RateLimit;
    KICK_AUTH_SUBJECT_RATE_LIMITER: RateLimit;
    KICK_API_IP_RATE_LIMITER: RateLimit;
    KICK_API_BEARER_RATE_LIMITER: RateLimit;
}

interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

interface KickTokenExchangeBody {
    code: string;
    redirect_uri: string;
    code_verifier: string;
}

interface KickTokenRefreshBody {
    refresh_token: string;
}

type CorsHeaders = Record<string, string>;

let kickAppTokenCache: CachedToken | null = null;

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS Headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Client-Id, X-StreamFusion-Auth",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // Health Check
        if (path === "/health" && request.method === "GET") {
            return handleHealthCheck(env, corsHeaders);
        }

        // Kick Auth (Token Exchange)
        if (path === "/auth/kick/token" && request.method === "POST") {
            const limited = await enforceKickAuthIpLimit(request, env, corsHeaders);
            if (limited) return limited;
            const body = await readKickTokenExchangeBody(request);
            if (!body) return invalidRequest(corsHeaders);
            const subjectLimited = await enforceKickAuthSubjectLimit(body.code, env, corsHeaders);
            if (subjectLimited) return subjectLimited;
            return handleKickTokenExchange(body, env, corsHeaders);
        }

        // Kick Auth (Token Refresh)
        if (path === "/auth/kick/refresh" && request.method === "POST") {
            const limited = await enforceKickAuthIpLimit(request, env, corsHeaders);
            if (limited) return limited;
            const body = await readKickTokenRefreshBody(request);
            if (!body) return invalidRequest(corsHeaders);
            const subjectLimited = await enforceKickAuthSubjectLimit(
                body.refresh_token,
                env,
                corsHeaders
            );
            if (subjectLimited) return subjectLimited;
            return handleKickTokenRefresh(body, env, corsHeaders);
        }

        // Kick API Proxy
        if (path.startsWith("/kick/")) {
            const limited = await enforceKickApiIpLimit(request, env, corsHeaders);
            if (limited) return limited;
            const bearerLimited = await enforceKickApiBearerLimit(request, env, corsHeaders);
            if (bearerLimited) return bearerLimited;
            return handleKickProxy(request, env, path.replace("/kick", ""), corsHeaders);
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    },
};

async function enforceKickAuthIpLimit(
    request: Request,
    env: Env,
    corsHeaders: CorsHeaders
): Promise<Response | null> {
    const ip = request.headers.get("CF-Connecting-IP") || "missing";
    return enforceLimit(env.KICK_AUTH_IP_RATE_LIMITER, `kick-auth:ip:${ip}`, corsHeaders);
}

async function enforceKickAuthSubjectLimit(
    subject: string,
    env: Env,
    corsHeaders: CorsHeaders
): Promise<Response | null> {
    const digest = await sha256Hex(subject);
    return enforceLimit(
        env.KICK_AUTH_SUBJECT_RATE_LIMITER,
        `kick-auth:subject:${digest}`,
        corsHeaders
    );
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const body: unknown = await request.json();
        return isRecord(body) ? body : null;
    } catch {
        return null;
    }
}

async function readKickTokenExchangeBody(request: Request): Promise<KickTokenExchangeBody | null> {
    const body = await readJsonObject(request);
    if (!body) return null;

    const { code, redirect_uri, code_verifier } = body;
    if (typeof code !== "string" || code.length === 0 || code.length > 4096) return null;
    if (!isAllowedKickRedirect(redirect_uri)) return null;
    if (!isValidCodeVerifier(code_verifier)) return null;

    return { code, redirect_uri, code_verifier };
}

async function readKickTokenRefreshBody(request: Request): Promise<KickTokenRefreshBody | null> {
    const body = await readJsonObject(request);
    if (!body) return null;

    const { refresh_token } = body;
    if (typeof refresh_token !== "string" || refresh_token.length === 0 || refresh_token.length > 8192) {
        return null;
    }

    return { refresh_token };
}

async function enforceKickApiIpLimit(
    request: Request,
    env: Env,
    corsHeaders: CorsHeaders
): Promise<Response | null> {
    const ip = request.headers.get("CF-Connecting-IP") || "missing";
    return enforceLimit(env.KICK_API_IP_RATE_LIMITER, `kick-api:ip:${ip}`, corsHeaders);
}

async function enforceKickApiBearerLimit(
    request: Request,
    env: Env,
    corsHeaders: CorsHeaders
): Promise<Response | null> {
    const authorization = request.headers.get("Authorization");
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return null;

    const digest = await sha256Hex(match[1]);
    return enforceLimit(
        env.KICK_API_BEARER_RATE_LIMITER,
        `kick-api:bearer:${digest}`,
        corsHeaders
    );
}

async function enforceLimit(
    limiter: RateLimit | undefined,
    key: string,
    corsHeaders: CorsHeaders
): Promise<Response | null> {
    try {
        const outcome = await limiter?.limit({ key });
        if (!outcome) return rateLimitUnavailable(corsHeaders);
        if (outcome.success) return null;
    } catch {
        return rateLimitUnavailable(corsHeaders);
    }

    return rateLimitDenied(corsHeaders);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedKickRedirect(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2048) return false;

    try {
        const redirect = new URL(value);
        const port = Number(redirect.port);
        return (
            redirect.protocol === "http:" &&
            redirect.hostname === "localhost" &&
            Number.isInteger(port) &&
            port >= 8765 &&
            port <= 8864 &&
            redirect.pathname === "/auth/kick/callback" &&
            redirect.username === "" &&
            redirect.password === "" &&
            redirect.search === "" &&
            redirect.hash === ""
        );
    } catch {
        return false;
    }
}

function isValidCodeVerifier(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rateLimitDenied(corsHeaders: CorsHeaders): Response {
    return Response.json(
        { error: "rate_limited" },
        {
            status: 429,
            headers: {
                ...corsHeaders,
                "Retry-After": "60",
                "Cache-Control": "no-store",
            },
        }
    );
}

function rateLimitUnavailable(corsHeaders: CorsHeaders): Response {
    return Response.json(
        { error: "rate_limit_unavailable" },
        {
            status: 503,
            headers: {
                ...corsHeaders,
                "Cache-Control": "no-store",
            },
        }
    );
}

function invalidRequest(corsHeaders: CorsHeaders): Response {
    return Response.json(
        { error: "invalid_request" },
        {
            status: 400,
            headers: {
                ...corsHeaders,
                "Cache-Control": "no-store",
            },
        }
    );
}

async function handleKickTokenExchange(
    body: KickTokenExchangeBody,
    env: Env,
    corsHeaders: CorsHeaders
) {
    try {
        const { code, redirect_uri, code_verifier } = body;

        const params = new URLSearchParams({
            client_id: env.KICK_CLIENT_ID,
            client_secret: env.KICK_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri,
            code_verifier // Kick uses PKCE
        });

        const response = await fetch("https://id.kick.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const data = await response.json();
        return Response.json(data, { status: response.status, headers: corsHeaders });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
}

async function handleKickTokenRefresh(
    body: KickTokenRefreshBody,
    env: Env,
    corsHeaders: CorsHeaders
) {
    try {
        const { refresh_token } = body;

        const params = new URLSearchParams({
            client_id: env.KICK_CLIENT_ID,
            client_secret: env.KICK_CLIENT_SECRET,
            refresh_token,
            grant_type: "refresh_token"
        });

        const response = await fetch("https://id.kick.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        const data = await response.json();
        return Response.json(data, { status: response.status, headers: corsHeaders });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
}

function handleHealthCheck(env: Env, corsHeaders: CorsHeaders): Response {
    return Response.json({
        status: "ok",
        secrets_configured: {
            kick: !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET)
        },
        timestamp: new Date().toISOString()
    }, {
        status: 200,
        headers: {
            ...corsHeaders,
            "Cache-Control": "no-store"
        }
    });
}

async function fetchKickAppToken(env: Env): Promise<string> {
    const now = Date.now();
    if (kickAppTokenCache && kickAppTokenCache.expiresAt > now + 60_000) {
        return kickAppTokenCache.accessToken;
    }

    const params = new URLSearchParams({
        client_id: env.KICK_CLIENT_ID,
        client_secret: env.KICK_CLIENT_SECRET,
        grant_type: "client_credentials"
    });

    const response = await fetch("https://id.kick.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
    });

    const data = await response.json() as any;
    if (!response.ok) {
        const message = data.error_description || data.message || data.error || `Kick app token failed: HTTP ${response.status}`;
        throw new Error(message);
    }

    const expiresInSeconds = typeof data.expires_in === "number" ? data.expires_in : 3600;
    kickAppTokenCache = {
        accessToken: data.access_token,
        expiresAt: now + expiresInSeconds * 1000
    };

    return data.access_token;
}

async function handleKickProxy(request: Request, env: Env, subPath: string, corsHeaders: any) {
    const publicPath = subPath.startsWith("/public/v1/") || subPath.startsWith("/public/v2/")
        ? subPath
        : `/public/v1${subPath}`;
    const url = `https://api.kick.com${publicPath}${new URL(request.url).search}`;

    const headers = new Headers(request.headers);
    const hasCallerBearer = headers.has("Authorization");
    const useAppToken = headers.get("X-StreamFusion-Auth") === "app" || !hasCallerBearer;
    headers.delete("X-StreamFusion-Auth");
    const body =
        request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.arrayBuffer();

    if (useAppToken) {
        try {
            headers.set("Authorization", `Bearer ${await fetchKickAppToken(env)}`);
        } catch (err: any) {
            return Response.json({ error: err.message }, { status: 502, headers: corsHeaders });
        }
    }

    let response = await fetch(url, {
        method: request.method,
        headers: headers,
        body
    });

    if (useAppToken && response.status === 401) {
        kickAppTokenCache = null;
        try {
            headers.set("Authorization", `Bearer ${await fetchKickAppToken(env)}`);
            response = await fetch(url, {
                method: request.method,
                headers,
                body
            });
        } catch (err: any) {
            return Response.json({ error: err.message }, { status: 502, headers: corsHeaders });
        }
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
    });
}
