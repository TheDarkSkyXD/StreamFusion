export interface Env {
    TWITCH_CLIENT_ID: string;
    TWITCH_CLIENT_SECRET: string;
    KICK_CLIENT_ID: string;
    KICK_CLIENT_SECRET: string;
}

interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

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
        if (path === "/health") {
            return handleHealthCheck(env, corsHeaders);
        }

        // Twitch Auth (Token Exchange)
        if (path === "/auth/twitch/token" && request.method === "POST") {
            return handleTwitchTokenExchange(request, env, corsHeaders);
        }

        // Twitch Auth (Token Refresh)
        if (path === "/auth/twitch/refresh" && request.method === "POST") {
            return handleTwitchTokenRefresh(request, env, corsHeaders);
        }

        // Twitch Auth (App Token)
        if (path === "/auth/twitch/app-token" && request.method === "POST") {
            return handleTwitchAppToken(env, corsHeaders);
        }

        // Kick Auth (Token Exchange)
        if (path === "/auth/kick/token" && request.method === "POST") {
            return handleKickTokenExchange(request, env, corsHeaders);
        }

        // Kick Auth (Token Refresh)
        if (path === "/auth/kick/refresh" && request.method === "POST") {
            return handleKickTokenRefresh(request, env, corsHeaders);
        }

        // Twitch API Proxy
        if (path.startsWith("/twitch/")) {
            return handleTwitchProxy(request, env, path.replace("/twitch", ""), corsHeaders);
        }

        // Kick API Proxy
        if (path.startsWith("/kick/")) {
            return handleKickProxy(request, env, path.replace("/kick", ""), corsHeaders);
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    },
};

async function handleTwitchTokenExchange(request: Request, env: Env, corsHeaders: any) {
    try {
        const body = await request.json() as any;
        const { code, redirect_uri } = body;

        const params = new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri
        });

        const response = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            body: params
        });

        const data = await response.json();
        return Response.json(data, { status: response.status, headers: corsHeaders });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
}

async function handleTwitchTokenRefresh(request: Request, env: Env, corsHeaders: any) {
    try {
        const body = await request.json() as any;
        const { refresh_token } = body;

        const params = new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            refresh_token,
            grant_type: "refresh_token"
        });

        const response = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            body: params
        });

        const data = await response.json();
        return Response.json(data, { status: response.status, headers: corsHeaders });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
}

async function handleTwitchAppToken(env: Env, corsHeaders: any) {
    try {
        const params = new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            grant_type: "client_credentials"
        });

        const response = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            body: params
        });

        const data = await response.json();
        return Response.json(data, { status: response.status, headers: corsHeaders });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
}

async function handleTwitchProxy(request: Request, env: Env, subPath: string, corsHeaders: any) {
    const url = `https://api.twitch.tv/helix${subPath}${new URL(request.url).search}`;

    const headers = new Headers(request.headers);
    headers.set("Client-Id", env.TWITCH_CLIENT_ID);

    // If no Authorization header is present (e.g. app access token needed), 
    // we could inject one here if we stored/cached it.
    // For now, we assume the client sends a User Token or we need to implement App Token caching.
    // But purely proxying allows User Token to pass through.

    const response = await fetch(url, {
        method: request.method,
        headers: headers,
        body: request.body
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
    });
}

async function handleKickTokenExchange(request: Request, env: Env, corsHeaders: any) {
    try {
        const body = await request.json() as any;
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

async function handleKickTokenRefresh(request: Request, env: Env, corsHeaders: any) {
    try {
        const body = await request.json() as any;
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

async function handleHealthCheck(env: Env, corsHeaders: any) {
    const secretsConfigured = {
        twitch: !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET),
        kick: !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET)
    };

    const kickOfficialApi: {
        status: "healthy" | "unhealthy";
        probe: string;
        http_status?: number;
        error?: string;
    } = {
        status: "unhealthy",
        probe: "/public/v1/channels?slug[]=hennytingzz"
    };

    if (secretsConfigured.kick) {
        try {
            const token = await fetchKickAppToken(env);
            const response = await fetch("https://api.kick.com/public/v1/channels?slug[]=hennytingzz", {
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${token}`
                }
            });
            if (response.status === 401) {
                kickAppTokenCache = null;
                const freshToken = await fetchKickAppToken(env);
                const retryResponse = await fetch("https://api.kick.com/public/v1/channels?slug[]=hennytingzz", {
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${freshToken}`
                    }
                });
                kickOfficialApi.http_status = retryResponse.status;
                kickOfficialApi.status = retryResponse.status === 200 ? "healthy" : "unhealthy";
            } else {
                kickOfficialApi.http_status = response.status;
                kickOfficialApi.status = response.status === 200 ? "healthy" : "unhealthy";
            }
        } catch (err: any) {
            kickOfficialApi.error = err instanceof Error ? err.message : String(err);
        }
    } else {
        kickOfficialApi.error = "Kick client credentials are not configured";
    }

    return Response.json({
        status: kickOfficialApi.status === "healthy" ? "ok" : "degraded",
        secrets_configured: secretsConfigured,
        kick_official_api: kickOfficialApi,
        timestamp: new Date().toISOString()
    }, {
        status: kickOfficialApi.status === "healthy" ? 200 : 503,
        headers: corsHeaders
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
