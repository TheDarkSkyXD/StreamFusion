export interface Env {
    KICK_CLIENT_ID: string;
    KICK_CLIENT_SECRET: string;
    KICK_AUTH_IP_RATE_LIMITER: RateLimit;
    KICK_AUTH_SUBJECT_RATE_LIMITER: RateLimit;
}

type KickAuthorizationCodeGrant = {
    kind: "authorization_code";
    code: string;
    redirectUri: string;
    codeVerifier: string;
};

type KickRefreshGrant = {
    kind: "refresh_token";
    refreshToken: string;
};

type KickGrant = KickAuthorizationCodeGrant | KickRefreshGrant;

type KickTokenSuccess = {
    access_token: string;
    token_type: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string | string[];
};

const ALLOWED_KICK_OAUTH_ERRORS = {
    access_denied: true,
    invalid_client: true,
    invalid_grant: true,
    invalid_request: true,
    invalid_scope: true,
    server_error: true,
    temporarily_unavailable: true,
    unauthorized_client: true,
    unsupported_grant_type: true
} satisfies Record<string, true>;

type KickOAuthError = keyof typeof ALLOWED_KICK_OAUTH_ERRORS;

type KickUpstreamOutcome =
    | { kind: "token_success"; status: number; token: KickTokenSuccess }
    | { kind: "oauth_failure"; status: number; error: KickOAuthError }
    | { kind: "invalid_response" }
    | { kind: "timeout" }
    | { kind: "transport_failure" };

const AUTH_PATHS = new Set(["/auth/kick/token", "/auth/kick/refresh"]);
const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_TOKEN_TIMEOUT_MS = 10_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const path = new URL(request.url).pathname;

        if (path === "/auth/kick/token" && request.method === "POST") {
            const limited = await enforceKickAuthIpLimit(request, env);
            if (limited) return limited;

            const grant = await readKickAuthorizationCodeGrant(request);
            if (!grant) return invalidRequest();

            const subjectLimited = await enforceKickAuthSubjectLimit(grant.code, env);
            if (subjectLimited) return subjectLimited;

            return exchangeKickGrant(grant, env);
        }

        if (path === "/auth/kick/refresh" && request.method === "POST") {
            const limited = await enforceKickAuthIpLimit(request, env);
            if (limited) return limited;

            const grant = await readKickRefreshGrant(request);
            if (!grant) return invalidRequest();

            const subjectLimited = await enforceKickAuthSubjectLimit(grant.refreshToken, env);
            if (subjectLimited) return subjectLimited;

            return exchangeKickGrant(grant, env);
        }

        if (AUTH_PATHS.has(path)) return authNotFound();

        return new Response("Not Found", { status: 404 });
    }
};

async function enforceKickAuthIpLimit(request: Request, env: Env): Promise<Response | null> {
    const ip = request.headers.get("CF-Connecting-IP") || "missing";
    return enforceLimit(env.KICK_AUTH_IP_RATE_LIMITER, `kick-auth:ip:${ip}`);
}

async function enforceKickAuthSubjectLimit(subject: string, env: Env): Promise<Response | null> {
    const digest = await sha256Hex(subject);
    return enforceLimit(env.KICK_AUTH_SUBJECT_RATE_LIMITER, `kick-auth:subject:${digest}`);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
    if (!hasJsonContentType(request)) return null;

    try {
        const body: unknown = await request.json();
        return isRecord(body) ? body : null;
    } catch {
        return null;
    }
}

async function readKickAuthorizationCodeGrant(
    request: Request
): Promise<KickAuthorizationCodeGrant | null> {
    const body = await readJsonObject(request);
    if (!body) return null;

    const { code, redirect_uri, code_verifier } = body;
    if (!isBoundedString(code, 4096)) return null;
    if (!isAllowedKickRedirect(redirect_uri)) return null;
    if (!isValidCodeVerifier(code_verifier)) return null;

    return {
        kind: "authorization_code",
        code,
        redirectUri: redirect_uri,
        codeVerifier: code_verifier
    };
}

async function readKickRefreshGrant(request: Request): Promise<KickRefreshGrant | null> {
    const body = await readJsonObject(request);
    if (!body || !isBoundedString(body.refresh_token, 8192)) return null;

    return { kind: "refresh_token", refreshToken: body.refresh_token };
}

async function enforceLimit(limiter: RateLimit | undefined, key: string): Promise<Response | null> {
    try {
        const outcome = await limiter?.limit({ key });
        if (!outcome) return rateLimitUnavailable();
        if (outcome.success) return null;
    } catch {
        return rateLimitUnavailable();
    }

    return rateLimitDenied();
}

function hasJsonContentType(request: Request): boolean {
    const contentType = request.headers.get("Content-Type");
    return contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
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

async function exchangeKickGrant(grant: KickGrant, env: Env): Promise<Response> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), KICK_TOKEN_TIMEOUT_MS);

    try {
        let response: Response;
        try {
            response = await fetch(KICK_TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: createKickTokenForm(grant, env),
                signal: controller.signal
            });
        } catch {
            return mapKickUpstreamOutcome(
                controller.signal.aborted ? { kind: "timeout" } : { kind: "transport_failure" }
            );
        }

        let data: unknown;
        try {
            data = await response.json();
        } catch {
            return mapKickUpstreamOutcome(
                controller.signal.aborted ? { kind: "timeout" } : { kind: "invalid_response" }
            );
        }

        return mapKickUpstreamOutcome(parseKickUpstreamOutcome(response, data));
    } finally {
        clearTimeout(deadline);
    }
}

function createKickTokenForm(grant: KickGrant, env: Env): URLSearchParams {
    switch (grant.kind) {
        case "authorization_code":
            return new URLSearchParams({
                client_id: env.KICK_CLIENT_ID,
                client_secret: env.KICK_CLIENT_SECRET,
                code: grant.code,
                grant_type: "authorization_code",
                redirect_uri: grant.redirectUri,
                code_verifier: grant.codeVerifier
            });
        case "refresh_token":
            return new URLSearchParams({
                client_id: env.KICK_CLIENT_ID,
                client_secret: env.KICK_CLIENT_SECRET,
                refresh_token: grant.refreshToken,
                grant_type: "refresh_token"
            });
    }

    const exhaustiveGrant: never = grant;
    return exhaustiveGrant;
}

function parseKickUpstreamOutcome(response: Response, data: unknown): KickUpstreamOutcome {
    if (response.ok) {
        const token = parseKickTokenSuccess(data);
        return token
            ? { kind: "token_success", status: response.status, token }
            : { kind: "invalid_response" };
    }

    if (isRecord(data) && isAllowedKickOAuthError(data.error)) {
        return { kind: "oauth_failure", status: response.status, error: data.error };
    }

    return { kind: "invalid_response" };
}

function parseKickTokenSuccess(value: unknown): KickTokenSuccess | null {
    if (!isRecord(value)) return null;

    const { access_token, token_type, refresh_token, expires_in, scope } = value;
    if (!isBoundedString(access_token, 8192) || !isBoundedString(token_type, 256)) return null;
    if (refresh_token !== undefined && !isBoundedString(refresh_token, 8192)) return null;
    if (
        expires_in !== undefined &&
        (typeof expires_in !== "number" || !Number.isFinite(expires_in) || expires_in < 0)
    ) {
        return null;
    }
    if (scope !== undefined && !isKickScope(scope)) return null;

    return {
        access_token,
        token_type,
        ...(refresh_token === undefined ? {} : { refresh_token }),
        ...(expires_in === undefined ? {} : { expires_in }),
        ...(scope === undefined ? {} : { scope })
    };
}

function isKickScope(value: unknown): value is string | string[] {
    return (
        (typeof value === "string" && value.length <= 4096) ||
        (Array.isArray(value) &&
            value.length <= 100 &&
            value.every((scope) => typeof scope === "string" && scope.length <= 256))
    );
}

function isAllowedKickOAuthError(value: unknown): value is KickOAuthError {
    return typeof value === "string" && Object.hasOwn(ALLOWED_KICK_OAUTH_ERRORS, value);
}

function mapKickUpstreamOutcome(outcome: KickUpstreamOutcome): Response {
    switch (outcome.kind) {
        case "token_success":
            return authJson(outcome.token, outcome.status);
        case "oauth_failure":
            return authJson({ error: outcome.error }, outcome.status);
        case "invalid_response":
            return authJson({ error: "upstream_invalid_response" }, 502);
        case "timeout":
            return authJson({ error: "upstream_timeout" }, 504);
        case "transport_failure":
            return authJson({ error: "upstream_unavailable" }, 502);
    }

    const exhaustiveOutcome: never = outcome;
    return exhaustiveOutcome;
}

function authJson(body: object, status: number): Response {
    return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function invalidRequest(): Response {
    return authJson({ error: "invalid_request" }, 400);
}

function rateLimitDenied(): Response {
    return Response.json(
        { error: "rate_limited" },
        {
            status: 429,
            headers: {
                ...NO_STORE_HEADERS,
                "Retry-After": "60"
            }
        }
    );
}

function rateLimitUnavailable(): Response {
    return authJson({ error: "rate_limit_unavailable" }, 503);
}

function authNotFound(): Response {
    return new Response("Not Found", { status: 404, headers: NO_STORE_HEADERS });
}
