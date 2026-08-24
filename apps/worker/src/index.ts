export interface Env {
    KICK_CLIENT_ID: string;
    KICK_CLIENT_SECRET: string;
    KICK_AUTH_IP_RATE_LIMITER: RateLimit;
    KICK_AUTH_SUBJECT_RATE_LIMITER: RateLimit;
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        const isKickAuthPath = path === "/auth/kick/token" || path === "/auth/kick/refresh";
        if (isKickAuthPath && request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (path === "/auth/kick/token" && request.method === "POST") {
            const limited = await enforceKickAuthIpLimit(request, env, corsHeaders);
            if (limited) return limited;
            const body = await readKickTokenExchangeBody(request);
            if (!body) return invalidRequest(corsHeaders);
            const subjectLimited = await enforceKickAuthSubjectLimit(body.code, env, corsHeaders);
            if (subjectLimited) return subjectLimited;
            return handleKickTokenExchange(body, env, corsHeaders);
        }

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
    } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 500, headers: corsHeaders });
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
    } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 500, headers: corsHeaders });
    }
}
