export interface Env {
    TWITCH_CLIENT_ID: string;
    TWITCH_CLIENT_SECRET: string;
    KICK_CLIENT_ID: string;
    KICK_CLIENT_SECRET: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS Headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Client-Id",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // Health Check
        if (path === "/health") {
            return Response.json({
                status: "ok",
                secrets_configured: {
                    twitch: !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET),
                    kick: !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET)
                },
                timestamp: new Date().toISOString()
            }, { headers: corsHeaders });
        }

        // Twitch Auth (Token Exchange)
        if (path === "/auth/twitch/token" && request.method === "POST") {
            return handleTwitchTokenExchange(request, env, corsHeaders);
        }

        // Twitch Auth (Token Refresh)
        if (path === "/auth/twitch/refresh" && request.method === "POST") {
            return handleTwitchTokenRefresh(request, env, corsHeaders);
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


async function handleKickProxy(request: Request, env: Env, subPath: string, corsHeaders: any) {
    const url = `https://api.kick.com/public/v1${subPath}${new URL(request.url).search}`;

    const headers = new Headers(request.headers);
    // Kick might require specific headers or handle auth differently
    // Since we are proxying, we pass through the Authorization header from the client

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
