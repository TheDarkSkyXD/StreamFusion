/**
 * OAuth Configuration
 *
 * Contains OAuth configuration for Twitch and Kick platforms,
 * including client settings, endpoints, and PKCE helpers.
 */

import crypto from "node:crypto";

import type { Platform } from "../../shared/auth-types";

// ========== Environment Variables ==========
// These should be set in .env file
// For Confidential clients, client secret is required for Authorization Code Flow

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || "";
// Client secrets are now handled by the Cloudflare Worker
const TWITCH_CLIENT_SECRET = "";
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID || "";
const KICK_CLIENT_SECRET = "";

// ========== Worker Configuration ==========

export const WORKER_BASE_URL = "https://streamforge.leveluptogetherbiz.workers.dev";

// ========== Localhost Callback Configuration ==========
// Twitch requires HTTPS for custom protocols but allows http://localhost
// We use a local HTTP server to capture OAuth callbacks

export const DEFAULT_CALLBACK_PORT = 8765;

/**
 * Get the redirect URI for a platform using localhost
 */
export function getRedirectUri(platform: Platform, port: number = DEFAULT_CALLBACK_PORT): string {
  return `http://localhost:${port}/auth/${platform}/callback`;
}

// ========== Protocol Configuration (for fallback/future use) ==========

export const PROTOCOL_SCHEME = "streamforge";
export const PROTOCOL_PREFIX = `${PROTOCOL_SCHEME}://`;

// ========== OAuth Configuration Types ==========

export interface OAuthConfig {
  platform: Platform;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint?: string; // Revoke endpoint usually remains direct unless we proxy it too
  scopes: string[];
  usesPkce: boolean;
}

// ========== PKCE Types ==========

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

// ========== Twitch OAuth Configuration ==========

export const TWITCH_OAUTH_CONFIG: OAuthConfig = {
  platform: "twitch",
  clientId: TWITCH_CLIENT_ID,
  clientSecret: TWITCH_CLIENT_SECRET,
  authorizationEndpoint: "https://id.twitch.tv/oauth2/authorize",
  tokenEndpoint: `${WORKER_BASE_URL}/auth/twitch/token`, // Worker endpoint
  revokeEndpoint: "https://id.twitch.tv/oauth2/revoke",
  scopes: [
    "user:read:email",
    "user:read:follows",
    "user:read:subscriptions",
    // Add more scopes as needed for features
  ],
  usesPkce: true,
};

// ========== Kick OAuth Configuration ==========
// Official Kick Dev OAuth 2.1 endpoints: https://docs.kick.com/getting-started/generating-tokens-oauth2-flow
// OAuth server is hosted on id.kick.com (different from API server)

export const KICK_OAUTH_CONFIG: OAuthConfig = {
  platform: "kick",
  clientId: KICK_CLIENT_ID,
  clientSecret: KICK_CLIENT_SECRET,
  authorizationEndpoint: "https://id.kick.com/oauth/authorize",
  tokenEndpoint: `${WORKER_BASE_URL}/auth/kick/token`, // Worker endpoint
  revokeEndpoint: "https://id.kick.com/oauth/revoke",
  scopes: [
    "user:read", // View user information (username, streamer ID, etc.)
    "channel:read", // View channel information (description, category, etc.)
    // Future scopes:
    // 'chat:write',    // Send chat messages
    // 'events:subscribe', // Subscribe to channel events
  ],
  usesPkce: true,
};

// ========== Config Getter ==========

export function getOAuthConfig(platform: Platform): OAuthConfig {
  switch (platform) {
    case "twitch":
      return TWITCH_OAUTH_CONFIG;
    case "kick":
      return KICK_OAUTH_CONFIG;
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

// ========== PKCE Utilities ==========

/**
 * Generate a cryptographically random code verifier
 * Must be 43-128 characters, using unreserved characters per RFC 7636
 */
export function generateCodeVerifier(): string {
  // Generate 32 random bytes (256 bits) and encode as base64url
  const buffer = crypto.randomBytes(32);
  return base64UrlEncode(buffer);
}

/**
 * Generate a code challenge from a code verifier using SHA-256
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Generate both PKCE code verifier and challenge
 */
export function generatePkceChallenge(): PkceChallenge {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

/**
 * Encode buffer to base64url (URL-safe base64 without padding)
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ========== OAuth URL Builder ==========

export interface AuthUrlParams {
  platform: Platform;
  redirectUri: string; // Now required - passed from callback server
  pkce?: PkceChallenge;
  state?: string;
}

/**
 * Build the OAuth authorization URL for a platform
 */
export function buildAuthorizationUrl(params: AuthUrlParams): string {
  const config = getOAuthConfig(params.platform);

  const url = new URL(config.authorizationEndpoint);

  // Required parameters
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));

  // PKCE parameters
  if (config.usesPkce && params.pkce) {
    url.searchParams.set("code_challenge", params.pkce.codeChallenge);
    url.searchParams.set("code_challenge_method", params.pkce.codeChallengeMethod);
  }

  // State parameter for CSRF protection
  if (params.state) {
    url.searchParams.set("state", params.state);
  } else {
    // Generate random state if not provided
    url.searchParams.set("state", crypto.randomBytes(16).toString("hex"));
  }

  // Platform-specific parameters
  if (params.platform === "twitch") {
    // Force re-approve if user wants to switch accounts
    url.searchParams.set("force_verify", "true");
  }

  return url.toString();
}

// ========== State Management ==========

/**
 * Generate a random state string for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Validate OAuth configuration
 * Returns array of error messages, or empty array if valid
 *
 * Note: Client secret is NOT required for Device Code Flow (public clients)
 */
export function validateOAuthConfig(platform: Platform): string[] {
  const errors: string[] = [];
  const config = getOAuthConfig(platform);

  if (!config.clientId) {
    errors.push(`${platform.toUpperCase()}_CLIENT_ID is not set`);
  }

  // Note: Client secret is NOT required for Device Code Flow
  // Only check it if your app uses authorization code flow with server-side token exchange

  return errors;
}

/**
 * Check if OAuth is configured for a platform
 */
export function isOAuthConfigured(platform: Platform): boolean {
  return validateOAuthConfig(platform).length === 0;
}
